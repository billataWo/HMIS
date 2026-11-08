/**
 * Offline mode engine (browser only): keeps the snapshot fresh and sends queued work, through
 * the web server's /offline/* routes (they add the sign-in, which scripts cannot read).
 */
import { deleteOp, getIdMap, getOps, getSnapshot, nextSeq, notifyChanged, putIdMap, putName, putOp, putSnapshot } from "./idb";
import { isTmp, type Op, type Snapshot } from "./types";

/** Downloads a fresh snapshot for the signed-in user. Returns null when offline or signed out. */
export async function refreshSnapshot(): Promise<Snapshot | null> {
  try {
    const res = await fetch("/offline/snapshot", { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    const snap = (await res.json()) as Snapshot;
    await putSnapshot(snap);
    await putName(snap.me.id, snap.me.fullName);
    // Work the server had before this snapshot was taken is in it: no need to keep it. (Both
    // times come from the server's clock, so a wrong clock on this PC can't confuse them.)
    for (const op of await getOps()) if (op.status === "done" && op.doneAt && op.doneAt < snap.at) await deleteOp(op.id);
    notifyChanged();
    return snap;
  } catch {
    return null;
  }
}

const SHELL_CACHE = "hmis-shell-v1";
const STATIC_CACHE = "hmis-static-v1";

/** Keeps the offline workspace and its files in the browser's cache (served by /sw.js offline). */
export async function cacheShell() {
  if (!("caches" in window)) return;
  try {
    const res = await fetch("/offline", { cache: "no-store" });
    if (!res.ok || res.redirected) return;
    const html = await res.clone().text();
    const shell = await caches.open(SHELL_CACHE);
    await shell.put("/offline", res);
    const assets = new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]));
    const statics = await caches.open(STATIC_CACHE);
    await Promise.all([...assets].map(async (a) => ((await statics.match(a)) ? undefined : statics.add(a).catch(() => undefined))));
    // Scripts and styles of earlier versions are no longer needed (fonts are kept: CSS refers to them).
    for (const req of await statics.keys()) {
      const path = new URL(req.url).pathname;
      if (!assets.has(path) && !path.startsWith("/_next/static/media/")) await statics.delete(req);
    }
  } catch {
    // offline right now: the cached copy stays as it is
  }
}

/** Set when work is queued while a send is under way, so it goes in the same session. */
let again = false;

export async function enqueue(op: Omit<Op, "id" | "at" | "status" | "seq">) {
  const full: Op = { ...op, id: crypto.randomUUID(), at: new Date().toISOString(), seq: await nextSeq(), status: "pending" };
  await putOp(full);
  notifyChanged();
  again = true;
  void replay(op.userId); // straight away if the connection is up
  return full;
}

const TMP = /tmp_[0-9a-f-]{36}/g;
const WHOLE_TMP = /^tmp_[0-9a-f-]{36}$/;

/** A URL: temporary ids become real ones, `$<step>.<field>` takes a field of an earlier reply. */
function resolvePath(path: string, ids: Record<string, string>, replies: unknown[]) {
  return path
    .replace(TMP, (t) => ids[t] ?? t)
    .replace(/\$(\d+)\.([A-Za-z0-9_.]+)/g, (_m, i: string, field: string) => String(pick(replies[Number(i)], field) ?? ""));
}

/** A request body: only values that *are* a temporary id change; free text is never touched. */
function resolveBody<T>(value: T, ids: Record<string, string>): T {
  if (typeof value === "string") return (WHOLE_TMP.test(value) ? (ids[value] ?? value) : value) as T;
  if (Array.isArray(value)) return value.map((v) => resolveBody(v, ids)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveBody(v, ids)])) as T;
  return value;
}

/** a.b.0.c, or items[drugId=<id>].id to find a list entry by a field. */
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    const find = /^(\w+)\[(\w+)=(.+)\]$/.exec(part);
    if (find) {
      const list = (cur as Record<string, unknown>)[find[1]];
      cur = Array.isArray(list) ? list.find((x) => String((x as Record<string, unknown>)[find[2]]) === find[3]) : undefined;
    } else {
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
}

/** Temporary ids an operation needs: in URLs, or as whole values in bodies. */
function tmpsNeeded(op: Op): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (WHOLE_TMP.test(v)) found.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const step of op.steps) {
    for (const m of step.path.matchAll(TMP)) found.add(m[0]);
    walk(step.body);
  }
  const own = new Set((op.creates ?? []).map((c) => c.tmp));
  return [...found].filter((t) => !own.has(t));
}

/**
 * When the server applied the work, by the API's clock (X-Server-Time, to the millisecond), the
 * same clock as Snapshot.at. Without it: the Date header rounded up a second; else this PC's.
 */
function serverTime(res: Response) {
  const exact = res.headers.get("x-server-time");
  if (exact && !Number.isNaN(Date.parse(exact))) return exact;
  const date = Date.parse(res.headers.get("date") ?? "");
  return Number.isNaN(date) ? new Date().toISOString() : new Date(date + 1000).toISOString();
}

export type ReplayResult = { sent: number; failed: number; stopped: "offline" | "signed-out" | "server" | null };
let running: Promise<ReplayResult> | null = null;

/**
 * Sends this user's waiting work in the order it was done. Stops at the first sign the server
 * can't be reached (and tries again later); a refusal marks that piece of work "needs attention"
 * along with anything that depends on it, and the rest carries on. Only one tab sends at a time
 * (a browser lock); the server applies each piece of work once in any case (Idempotency-Key).
 */
export function replay(userId: string): Promise<ReplayResult> {
  running ??= (async () => {
    try {
      const send = () => sendAll(userId);
      if (typeof navigator !== "undefined" && navigator.locks) {
        return (await navigator.locks.request("hmis-offline-replay", { ifAvailable: true }, (lock) => (lock ? send() : null))) ?? { sent: 0, failed: 0, stopped: null };
      }
      return await send();
    } finally {
      running = null;
      notifyChanged();
    }
  })();
  return running;
}

async function sendAll(userId: string): Promise<ReplayResult> {
  const total: ReplayResult = { sent: 0, failed: 0, stopped: null };
  do {
    again = false;
    const r = await sendPass(userId);
    total.sent += r.sent;
    total.failed += r.failed;
    total.stopped = r.stopped;
  } while (again && total.stopped === null);
  return total;
}

async function sendPass(userId: string): Promise<ReplayResult> {
  const result: ReplayResult = { sent: 0, failed: 0, stopped: null };
  const ids = await getIdMap();
  const ops = await getOps();
  const creatorOf = new Map(ops.flatMap((o) => (o.creates ?? []).map((c) => [c.tmp, o] as const)));
  const failedTmps = new Set(ops.filter((o) => o.status === "failed").flatMap((o) => (o.creates ?? []).map((c) => c.tmp)));
  const fail = async (op: Op, error: string, extra: Partial<Op> = {}) => {
    await putOp({ ...op, status: "failed", error, ...extra });
    (op.creates ?? []).forEach((c) => failedTmps.add(c.tmp));
    result.failed++;
    notifyChanged();
  };

  for (const op of ops) {
    if (op.status !== "pending" || op.userId !== userId) continue;
    const missing = tmpsNeeded(op).filter((t) => !ids[t]);
    if (missing.length) {
      const t = missing[0];
      const creator = creatorOf.get(t);
      if (failedTmps.has(t)) await fail(op, `Depends on "${creator?.label ?? "earlier work"}", which could not be saved.`);
      else if (!creator) await fail(op, "Depends on earlier work that was removed from this PC.");
      else if (creator.status === "done") await fail(op, `Depends on "${creator.label}", but the server's reply to it could not be matched. Check it in HMIS.`);
      // Otherwise its creator is still waiting (for someone else's sign-in on this PC): wait too.
      continue;
    }

    const replies: unknown[] = [];
    let doneAt = new Date().toISOString();
    let refused: { message: string; body: unknown; code?: string } | null = null;
    for (const [i, step] of op.steps.entries()) {
      let res: Response;
      try {
        res = await fetch("/offline/replay", {
          method: "POST",
          redirect: "manual", // a redirect means the sign-in expired, never success
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: step.method,
            path: resolvePath(step.path, ids, replies),
            body: resolveBody(step.body, ids),
            key: `${op.id}-${op.attempt ?? 0}-${i}`,
          }),
        });
      } catch {
        result.stopped = "offline";
        return result;
      }
      if (res.type === "opaqueredirect" || res.status === 401) {
        result.stopped = "signed-out";
        return result;
      }
      if (!res.headers.get("content-type")?.includes("json")) {
        result.stopped = "server";
        return result;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; code?: string };
      if (res.status >= 500) {
        result.stopped = "server";
        return result;
      }
      // A temporary password must be replaced first: like being signed out, nothing is refused.
      if (body.code === "PASSWORD_CHANGE_REQUIRED") {
        result.stopped = "signed-out";
        return result;
      }
      // The same work is being applied right now (another tab): its result arrives next time.
      if (body.code === "IDEMPOTENCY_IN_PROGRESS") {
        result.stopped = "server";
        return result;
      }
      if (!res.ok) {
        const msg = body.message;
        refused = { message: Array.isArray(msg) ? msg.join("; ") : (msg ?? `Refused (${res.status})`), body, code: body.code };
        break;
      }
      replies.push(body);
      doneAt = serverTime(res);
    }
    if (refused) {
      await fail(op, refused.message, { errorBody: refused.body, errorCode: refused.code });
      continue;
    }
    for (const c of op.creates ?? []) {
      const real = pick(replies[c.step], c.pick);
      if (typeof real === "string") ids[c.tmp] = real;
    }
    await putIdMap(ids);
    await putOp({ ...op, status: "done", doneAt, error: undefined, errorBody: undefined, errorCode: undefined });
    result.sent++;
    notifyChanged();
  }
  return result;
}

/** Puts a refused piece of work back in the queue, optionally with a changed request. */
export async function retryOp(op: Op, change?: (op: Op) => Op) {
  const next = change ? change(op) : op;
  // After "outcome unknown" the person has checked it was not saved: send it as a new attempt.
  const attempt = (op.attempt ?? 0) + (op.errorCode === "IDEMPOTENCY_UNKNOWN" ? 1 : 0);
  await putOp({ ...next, attempt, status: "pending", error: undefined, errorBody: undefined, errorCode: undefined });
  // Work that failed only because it depended on this goes back in the queue with it.
  const created = new Set((op.creates ?? []).map((c) => c.tmp));
  const waiting = (await getOps()).filter((o) => o.status === "failed" && o.error?.startsWith("Depends on"));
  for (let more = true; more; ) {
    more = false;
    for (const other of waiting) {
      if (other.status === "failed" && tmpsNeeded(other).some((t) => created.has(t))) {
        other.status = "pending";
        await putOp({ ...other, error: undefined });
        (other.creates ?? []).forEach((c) => created.add(c.tmp));
        more = true;
      }
    }
  }
  notifyChanged();
  again = true;
  void replay(op.userId);
}

export async function discardOp(id: string) {
  await deleteOp(id);
  notifyChanged();
}

export { getOps, getSnapshot, isTmp };
