/**
 * The browser's offline store (IndexedDB): the snapshot, the queue of operations waiting to be
 * sent, and the map from temporary to real ids. Everything here works without a network.
 */
import type { Op, Snapshot } from "./types";

const DB = "hmis-offline";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: "kv" | "ops", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    // An aborted transaction (e.g. the disk is full) must fail the call, not leave it hanging.
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("The browser could not save offline data"));
    };
  });
}

/**
 * The next number in this browser's sequence: queued work is sent in this order, which does not
 * depend on the PC's clock (often wrong, and it can jump). Atomic across tabs.
 */
export async function nextSeq(): Promise<number> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    let value = 0;
    const req = store.get("seq");
    req.onsuccess = () => {
      value = ((req.result as number | undefined) ?? 0) + 1;
      store.put(value, "seq");
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("The browser could not save offline data"));
    };
  });
}

/** Tells every open tab (and the status chip) that the offline data changed. */
export function notifyChanged() {
  try {
    new BroadcastChannel("hmis-offline").postMessage("changed");
  } catch {}
  window.dispatchEvent(new Event("hmis-offline-changed"));
}

export const getSnapshot = () => run<Snapshot>("kv", "readonly", (s) => s.get("snapshot"));
export async function putSnapshot(snap: Snapshot) {
  await run("kv", "readwrite", (s) => s.put(snap, "snapshot"));
  await run("kv", "readwrite", (s) => s.delete("expired"));
}

/** Left behind when an expired snapshot is deleted: enough to explain the lock, no patient data. */
export type ExpiredMarker = { userId: string; name: string; validUntil: string };
export const getExpired = () => run<ExpiredMarker>("kv", "readonly", (s) => s.get("expired"));

/**
 * The sign-in this browser's patient data came with has run out: delete that data (the queued
 * work stays, to be sent when the person signs in again). Hiding it on screen is not enough:
 * anyone at the PC could read the browser's storage. Returns true when it deleted something.
 */
export async function purgeIfExpired(): Promise<boolean> {
  const snap = await getSnapshot().catch(() => undefined);
  if (!snap?.validUntil || Date.now() <= Date.parse(snap.validUntil)) return false;
  const marker: ExpiredMarker = { userId: snap.me.id, name: snap.me.fullName, validUntil: snap.validUntil };
  await run("kv", "readwrite", (s) => s.put(marker, "expired"));
  await run("kv", "readwrite", (s) => s.delete("snapshot"));
  return true;
}
export const clearSnapshot = () => run("kv", "readwrite", (s) => s.delete("snapshot"));

/** Who each user id is, kept after sign-out so waiting work can say whose it is. */
export async function getNames(): Promise<Record<string, string>> {
  return ((await run<Record<string, string>>("kv", "readonly", (s) => s.get("names"))) ?? {}) as Record<string, string>;
}
export async function putName(id: string, name: string) {
  const names = await getNames();
  if (names[id] !== name) await run("kv", "readwrite", (s) => s.put({ ...names, [id]: name }, "names"));
}

export async function getIdMap(): Promise<Record<string, string>> {
  return ((await run<Record<string, string>>("kv", "readonly", (s) => s.get("idmap"))) ?? {}) as Record<string, string>;
}
export const putIdMap = (map: Record<string, string>) => run("kv", "readwrite", (s) => s.put(map, "idmap"));

export async function getOps(): Promise<Op[]> {
  const ops = ((await run<Op[]>("ops", "readonly", (s) => s.getAll())) ?? []) as Op[];
  return ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export const putOp = (op: Op) => run("ops", "readwrite", (s) => s.put(op));
export const deleteOp = (id: string) => run("ops", "readwrite", (s) => s.delete(id));
