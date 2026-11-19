"use client";

import { CircleAlert, CloudOff, CloudUpload, Lock, RefreshCw, Undo2, Wifi } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LangProvider, useT } from "@/components/lang-provider";
import { Badge, buttonClass, EmptyState, inputClass, Notice, pillClass, secondaryButtonClass } from "@/components/ui";
import type { Role } from "@/lib/api";
import type { Lang, T } from "@/lib/i18n";
import { dependentsOf, discardOp, keepStorage, refreshPatients, refreshSnapshot, replay, retryOp, undoOp } from "@/lib/offline/engine";
import type { Op } from "@/lib/offline/types";
import { Cashier } from "./cashier";
import { Doctor } from "./doctor";
import { FrontDesk } from "./front-desk";
import { Lab } from "./lab";
import { Pharmacy } from "./pharmacy";
import { useOfflineData } from "./shared";
import { Triage } from "./triage";

type Tab = "desk" | "triage" | "doctor" | "cashier" | "lab" | "pharmacy";
/** The same roles the API accepts for each kind of work (it refuses anything else on replay). */
const TABS: { id: Tab; label: string; roles: Role[] }[] = [
  { id: "desk", label: "Front desk", roles: ["ADMIN", "RECEPTIONIST", "NURSE"] },
  { id: "triage", label: "Triage", roles: ["NURSE"] },
  { id: "doctor", label: "Consultation", roles: ["DOCTOR"] },
  { id: "cashier", label: "Cashier", roles: ["ADMIN", "CASHIER"] },
  { id: "lab", label: "Lab", roles: ["ADMIN", "LAB_TECH"] },
  { id: "pharmacy", label: "Pharmacy", roles: ["ADMIN", "PHARMACIST"] },
];

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" });
/** The sign-in this PC's data came with has run out (12 hours): nobody may work as that person. */
const expired = (validUntil: string | null) => validUntil !== null && Date.now() > Date.parse(validUntil);

/** The language chosen in HMIS (the hmis_lang cookie). This page is static, so it is read here, in the browser. */
const subscribeLang = () => () => {};
const readLang = (): Lang => (/(?:^|;\s*)hmis_lang=am(?:;|$)/.test(document.cookie) ? "am" : "en");

export function OfflineWorkspace() {
  const lang = useSyncExternalStore(subscribeLang, readLang, (): Lang => "en");
  return (
    <LangProvider lang={lang}>
      <Workspace />
    </LangProvider>
  );
}

const LINE = "\n";

/** A queued operation's label in the reader's language (older ones kept only the English). */
const opText = (op: Op, t: T) => (op.labelKey ? t(op.labelKey, op.labelVars) : op.label);

function Workspace() {
  const t = useT();
  const { snap, view, loaded, ops, expired: expiredMarker, off } = useOfflineData();
  const browserOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [reachable, setReachable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const online = browserOnline && reachable;
  const userId = snap?.me.id;

  const sync = async () => {
    if (!userId || !navigator.onLine) return;
    setSyncing(true);
    try {
      const r = await replay(userId);
      setReachable(r.stopped !== "offline" && r.stopped !== "server");
      setSignedOut(r.stopped === "signed-out");
      if (r.stopped === null) {
        const fresh = await refreshSnapshot();
        setReachable(fresh !== null);
        if (fresh && fresh !== "off") await refreshPatients(fresh);
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    void keepStorage();
    const first = window.setTimeout(() => void sync(), 0);
    const every = window.setInterval(() => void sync(), 60_000);
    window.addEventListener("online", sync);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("online", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const tabs = snap ? TABS.filter((x) => x.roles.includes(snap.me.role)) : [];
  const [tab, setTab] = useState<Tab | null>(null);
  const current = tab && tabs.some((x) => x.id === tab) ? tab : (tabs[0]?.id ?? null);

  const others = ops.filter((o) => o.status !== "done" && o.userId !== userId);
  if (!loaded) return <p className="p-8 text-sm text-slate-500">{t("Loading what this PC has kept…")}</p>;
  // The sign-in ran out: its patient data has been deleted from this browser (see purgeIfExpired).
  const lockedOut = !snap && expiredMarker ? expiredMarker : snap && expired(snap.validUntil) ? { name: snap.me.fullName, validUntil: snap.validUntil! } : null;
  if (lockedOut) {
    const waiting = ops.filter((o) => o.status !== "done").length;
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState icon={Lock} title={t("The sign-in on this PC has expired")}>
          {t(
            "{name}'s sign-in ran out at {time}, so this PC no longer keeps their patients' data. Sign in again once the connection is back.",
            { name: lockedOut.name, time: time(lockedOut.validUntil) },
          )}
          {waiting
            ? ` ${t(waiting === 1 ? "The {n} offline item waiting on this PC will be sent then." : "The {n} offline items waiting on this PC will be sent then.", { n: waiting })}`
            : ""}
          {online && (
            <>
              {" "}
              <Link className="underline" href="/login">
                {t("Sign in")}
              </Link>
            </>
          )}
        </EmptyState>
      </div>
    );
  }
  // The clinic turned offline mode off: this PC keeps no patient data (work recorded earlier is still sent).
  if (!snap && off) {
    const waiting = ops.filter((o) => o.status !== "done").length;
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState icon={CloudOff} title={t("Offline mode is turned off for this clinic")}>
          {t("This PC keeps no patient data, so there is nothing to work on without a connection. An admin can turn it on in Settings.")}
          {waiting
            ? ` ${t(waiting === 1 ? "The {n} offline item waiting on this PC will be sent once HMIS is open." : "The {n} offline items waiting on this PC will be sent once HMIS is open.", { n: waiting })}`
            : ""}{" "}
          {online && (
            <Link className="underline" href="/">
              {t("Open HMIS")}
            </Link>
          )}
        </EmptyState>
      </div>
    );
  }
  if (!snap || !view) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState icon={CloudOff} title={t("Nothing is kept on this PC yet")}>
          {t("Offline mode needs one sign-in while the connection works: HMIS then keeps your day's work on this PC.")}{" "}
          {online && (
            <Link className="underline" href="/">
              {t("Open HMIS")}
            </Link>
          )}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 print:hidden">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{t("Offline workspace")}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {snap.me.tenant.name} · {snap.me.fullName} · {t("data from {time}", { time: time(snap.at) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {online ? (
            <Badge tone="success" dot>
              <Wifi aria-hidden className="size-3" /> {t("Connected")}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              <CloudOff aria-hidden className="size-3" /> {t("No connection")}
            </Badge>
          )}
          <button disabled={syncing || !browserOnline} onClick={() => void sync()} className={secondaryButtonClass}>
            <RefreshCw aria-hidden className={`size-4 ${syncing ? "animate-spin" : ""}`} /> {t("Send now")}
          </button>
          {online && (
            <Link href="/" className={buttonClass}>
              {t("Back to HMIS")}
            </Link>
          )}
        </div>
      </header>

      <Notice tone={online ? "info" : "warning"} className="mb-6">
        {t(
          online
            ? "Connected: work done here is sent to the server straight away. The full HMIS has more; use this page when the connection drops."
            : "No connection: keep working here. Everything is kept on this PC and sent, with all the usual checks, when the connection is back. Other PCs only see it after that.",
        )}
      </Notice>

      {signedOut && online && (
        <Notice tone="warning" className="mb-6">
          {t.rich("Your sign-in has expired, so the work below can't be sent yet. {link} as {name}: it is sent straight after.", {
            link: (
              <Link href="/login" className="font-medium underline underline-offset-4">
                {t("Sign in again")}
              </Link>
            ),
            name: snap.me.fullName,
          })}
        </Notice>
      )}
      {others.length > 0 && (
        <Notice tone="info" className="mb-6">
          {t(
            others.length === 1
              ? "{n} item recorded offline on this PC by another person is waiting for them to sign in here; work is only ever sent as the person who did it."
              : "{n} items recorded offline on this PC by another person are waiting for them to sign in here; work is only ever sent as the person who did it.",
            { n: others.length },
          )}
        </Notice>
      )}
      <Outbox pending={view.pending} failed={view.failed} all={ops} />

      {snap.readOnly ? (
        <EmptyState icon={Lock} title={t("This is the cloud's read-only copy of the clinic")}>
          {t("This clinic works on its own clinic server, which keeps working without internet. Records are entered there, not here.")}
        </EmptyState>
      ) : (
        <Areas tabs={tabs} current={current} setTab={setTab} view={view} userId={snap.me.id} />
      )}
    </div>
  );
}

function Areas({
  tabs,
  current,
  setTab,
  view,
  userId,
}: {
  tabs: typeof TABS;
  current: Tab | null;
  setTab: (t: Tab) => void;
  view: NonNullable<ReturnType<typeof useOfflineData>["view"]>;
  userId: string;
}) {
  const t = useT();
  return (
    <>
      {tabs.length > 1 && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label={t("Work areas")}>
          {tabs.map((x) => (
            <button key={x.id} onClick={() => setTab(x.id)} className={pillClass(current === x.id)} aria-current={current === x.id ? "page" : undefined}>
              {t(x.label)}
            </button>
          ))}
        </nav>
      )}
      {current === "desk" && <FrontDesk view={view} userId={userId} />}
      {current === "triage" && <Triage view={view} userId={userId} />}
      {current === "doctor" && <Doctor view={view} userId={userId} />}
      {current === "cashier" && <Cashier view={view} userId={userId} />}
      {current === "lab" && <Lab view={view} userId={userId} />}
      {current === "pharmacy" && <Pharmacy view={view} userId={userId} />}
      {!current && <EmptyState title={t("Your role has no offline work area")} />}
    </>
  );
}

/** Work waiting to be sent, and work the server refused (with what to do about it). */
function Outbox({ pending, failed, all }: { pending: Op[]; failed: Op[]; all: Op[] }) {
  const t = useT();
  if (!pending.length && !failed.length) return null;
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2">
      {failed.length > 0 && (
        <section className="surface border-red-200 p-4 md:col-span-2 dark:border-red-900/60">
          <h2 className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-200">
            <CircleAlert aria-hidden className="size-4" /> {t("Needs attention ({n})", { n: failed.length })}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t("The server did not accept these. Fix the cause (often online, in the full HMIS), then send again or remove them.")}</p>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {failed.map((op) => (
              <Failed key={op.id} op={op} />
            ))}
          </ul>
        </section>
      )}
      {pending.length > 0 && (
        <section className="surface p-4 md:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <CloudUpload aria-hidden className="size-4" /> {t("Waiting to be sent ({n})", { n: pending.length })}
          </h2>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm text-slate-600 dark:text-slate-400">
            {pending.map((op) => (
              <li key={op.id} className="group flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="mr-2 font-mono text-xs text-slate-500">{time(op.at)}</span>
                  {opText(op, t)}
                </span>
                <button
                  onClick={() => {
                    const also = dependentsOf(op, all);
                    const what = opText(op, t);
                    const ask = also.length
                      ? t('Take back "{what}"? It is not sent, and neither are the {n} later items that depend on it:', { what, n: also.length }) + LINE + also.map((o) => `– ${opText(o, t)}`).join(LINE)
                      : t('Take back "{what}"? It will not be sent.', { what });
                    if (window.confirm(ask)) {
                      void undoOp(op.id).then((ok) => {
                        if (!ok) window.alert(t("It was sent meanwhile: correct it in HMIS instead."));
                      });
                    }
                  }}
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <Undo2 aria-hidden className="size-3.5" /> {t("Take back")}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">{t("Recorded by mistake? Take it back before it is sent. Once sent, correct it in HMIS.")}</p>
        </section>
      )}
    </div>
  );
}

/** What to do about the refusals that happen when two PCs worked on the same patient offline. */
function hint(op: Op): string | null {
  const e = op.error ?? "";
  if (op.errorCode === "IDEMPOTENCY_UNKNOWN" || op.errorCode === "SERVER_ERROR") return "Look for it in HMIS first. Only if it is not there, send it again.";
  if (op.kind === "pay" && op.errorCode === "NOTHING_OWED") {
    return "This visit was already settled, probably on another PC. The money taken here is extra: give it back to the patient.";
  }
  if (op.kind === "pay" && op.errorCode === "MORE_THAN_OWED") {
    return "Less is owed than was taken (part was paid on another PC). Give the difference back, then record the right amount in HMIS.";
  }
  if (op.kind === "pay") return "Check the visit's invoices in HMIS before taking any more money; give back anything paid twice.";
  if (op.kind === "collect" && /already been taken/i.test(e)) return "Another PC recorded this sample already: nothing more to do.";
  if (op.kind === "dispense") return "Check the prescription in HMIS before handing over anything else.";
  if (op.kind === "verify" && op.errorCode === "CRITICAL_NOT_NOTIFIED") return "Phone the doctor, write who was told, and send it again.";
  if (op.kind === "reject" && /no sample/i.test(e)) return "The sample was already dealt with on another PC: nothing more to do.";
  if (op.kind === "prescribe" && /alert|allerg|interact/i.test(e)) return "Open the visit in HMIS, review the alert and prescribe again there.";
  return null;
}

function Failed({ op }: { op: Op }) {
  const t = useT();
  const [notified, setNotified] = useState("");
  const critical = op.kind === "verify" && op.errorCode === "CRITICAL_NOT_NOTIFIED";
  const details = op.errorBody as { duplicates?: { mrn: string; firstName: string; fatherName: string }[]; alerts?: { message: string }[] } | undefined;
  const duplicates = details?.duplicates;
  const advice = hint(op);
  return (
    <li className="py-2.5 text-sm">
      <p className="font-medium text-slate-900 dark:text-white">
        <span className="mr-2 font-mono text-xs text-slate-500">{time(op.at)}</span>
        {opText(op, t)}
      </p>
      <p className="mt-0.5 text-red-700 dark:text-red-300">{op.error && t(op.error)}</p>
      {details?.alerts?.length ? (
        <ul className="mt-1 list-disc pl-5 text-slate-700 dark:text-slate-300">
          {details.alerts.map((a, i) => (
            <li key={i}>{t(a.message)}</li>
          ))}
        </ul>
      ) : null}
      {advice && <p className="mt-0.5 font-medium text-slate-700 dark:text-slate-300">{t(advice)}</p>}
      {duplicates?.length ? (
        <p className="mt-0.5 text-slate-600 dark:text-slate-400">
          {t("Possibly the same person as: {list}", { list: duplicates.map((d) => `${d.firstName} ${d.fatherName} (${d.mrn})`).join(", ") })}
        </p>
      ) : null}
      {critical && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={notified}
            onChange={(e) => setNotified(e.target.value)}
            placeholder={t("Who was told, and how (e.g. Dr. Dawit, by phone)")}
            aria-label={t("Who was told of the critical result")}
            className={`${inputClass} min-w-56 flex-1`}
          />
          <button
            disabled={notified.trim().length < 2}
            onClick={() =>
              void retryOp(op, (o) => ({
                ...o,
                steps: o.steps.map((s) => ({ ...s, body: { ...(s.body as object), notified: notified.trim() } })),
                data: { ...o.data, notified: notified.trim() },
              }))
            }
            className={`${secondaryButtonClass} btn-size`}
          >
            {t("Verify and send")}
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {op.kind === "register" && duplicates?.length ? (
          <button
            onClick={() =>
              void retryOp(op, (o) => ({ ...o, steps: o.steps.map((s) => ({ ...s, body: { ...(s.body as object), confirmDuplicate: true } })) }))
            }
            className={`${secondaryButtonClass} btn-size`}
          >
            {t("Different person: register anyway")}
          </button>
        ) : null}
        {!op.error?.startsWith("Depends on") && !critical && (
          <button onClick={() => void retryOp(op)} className={`${secondaryButtonClass} btn-size`}>
            {t(op.errorCode === "IDEMPOTENCY_UNKNOWN" || op.errorCode === "SERVER_ERROR" ? "Not in HMIS: send again" : "Send again")}
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm(t('Remove "{what}"? It will not be sent.', { what: opText(op, t) }))) void discardOp(op.id);
          }}
          className={`${secondaryButtonClass} btn-size`}
        >
          {t("Remove")}
        </button>
      </div>
    </li>
  );
}
