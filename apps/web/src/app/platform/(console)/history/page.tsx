import { Banknote, Building2, CreditCard, FileText, KeyRound, LogIn, Settings, ShieldAlert, Trash2, UserCog } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { CLINIC_TZ } from "@/lib/format";
import { type HistoryEntry, platformApi } from "@/lib/platform";

type Kind = { label: string; icon: typeof LogIn; tone: "neutral" | "good" | "money" | "warn" | "danger" };

/** What each action in the console's history means, in words. */
const ACTIONS: Record<string, Kind> = {
  "platform.login": { label: "Signed in", icon: LogIn, tone: "neutral" },
  "platform.login_failed": { label: "Failed sign-in", icon: ShieldAlert, tone: "warn" },
  "platform.two_step_failed": { label: "Wrong two-step code", icon: ShieldAlert, tone: "warn" },
  "platform.password_check_failed": { label: "Wrong current password", icon: ShieldAlert, tone: "warn" },
  "platform.temporary_password_expired": { label: "Expired temporary password used", icon: ShieldAlert, tone: "warn" },
  "platform.password_changed": { label: "Changed their password", icon: KeyRound, tone: "neutral" },
  "platform.two_step_enabled": { label: "Set up two-step sign-in", icon: KeyRound, tone: "good" },
  "request.approved": { label: "Approved a request", icon: Building2, tone: "good" },
  "request.rejected": { label: "Rejected a request", icon: Building2, tone: "neutral" },
  "subscription.created": { label: "Started billing a clinic", icon: CreditCard, tone: "neutral" },
  "subscription.updated": { label: "Changed a subscription", icon: CreditCard, tone: "neutral" },
  "subscription.suspended": { label: "Suspended a clinic", icon: CreditCard, tone: "danger" },
  "subscription.reactivated": { label: "Reactivated a clinic", icon: CreditCard, tone: "good" },
  "subscription.cancelled": { label: "Cancelled a subscription", icon: CreditCard, tone: "danger" },
  "licence.issued": { label: "Issued a licence", icon: FileText, tone: "neutral" },
  "invoice.issued": { label: "Issued an invoice", icon: FileText, tone: "neutral" },
  "invoice.voided": { label: "Voided an invoice", icon: FileText, tone: "warn" },
  "payment.recorded": { label: "Recorded a payment", icon: Banknote, tone: "money" },
  "payment.confirmed": { label: "Confirmed a payment", icon: Banknote, tone: "money" },
  "payment.rejected": { label: "Rejected a payment", icon: Banknote, tone: "warn" },
  "payment.online": { label: "Paid online", icon: Banknote, tone: "money" },
  "payment.online_unapplied": { label: "Paid online, not applied", icon: Banknote, tone: "warn" },
  "plan.created": { label: "Added a plan", icon: CreditCard, tone: "neutral" },
  "plan.updated": { label: "Changed a plan", icon: CreditCard, tone: "neutral" },
  "operator.created": { label: "Added an operator", icon: UserCog, tone: "neutral" },
  "operator.updated": { label: "Changed an operator", icon: UserCog, tone: "neutral" },
  "operator.reset": { label: "Reset an operator's sign-in", icon: UserCog, tone: "warn" },
  "settings.updated": { label: "Changed the settings", icon: Settings, tone: "neutral" },
  "clinic.data_deleted": { label: "Deleted a clinic's records", icon: Trash2, tone: "danger" },
};

const TONE: Record<Kind["tone"], string> = {
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  money: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: CLINIC_TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: CLINIC_TZ });

/** A value as people read it: yes or no, a date instead of a timestamp. */
function readable(v: unknown) {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TZ });
  return String(v);
}

/** The details worth reading, as short "name: value" pairs (ids and nested objects left out). */
function details(data: HistoryEntry["data"]) {
  if (!data) return [];
  return Object.entries(data)
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object" && !/id$/i.test(k))
    .slice(0, 6)
    .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").toLowerCase(), readable(v)] as const);
}

async function Content() {
  const entries = await platformApi<HistoryEntry[]>("/platform/audit");
  if (!entries.length) return <EmptyState title="Nothing yet">Every action in this console and every operator sign-in is recorded here.</EmptyState>;
  const days = new Map<string, HistoryEntry[]>();
  for (const e of entries) days.set(day(e.createdAt), [...(days.get(day(e.createdAt)) ?? []), e]);

  return (
    <div className="space-y-6">
      {[...days].map(([d, list]) => (
        <Card key={d} title={d} description={`${list.length} action${list.length === 1 ? "" : "s"}`}>
          <ol className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((e) => {
              const kind = ACTIONS[e.action] ?? { label: e.action, icon: FileText, tone: "neutral" as const };
              const info = details(e.data);
              return (
                <li key={e.id} className="flex gap-3 py-3">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${TONE[kind.tone]}`}>
                    <kind.icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-slate-900 dark:text-white">{e.operator ?? "HMIS"}</span>
                      <span className="text-slate-700 dark:text-slate-200">{kind.label.charAt(0).toLowerCase() + kind.label.slice(1)}</span>
                      {e.tenantId && (
                        <Link href={`/platform/clinics/${e.tenantId}`} className="text-brand-700 hover:underline dark:text-brand-400">
                          open the clinic
                        </Link>
                      )}
                      <time dateTime={e.createdAt} className="ml-auto text-xs text-slate-500 tabular-nums">
                        {time(e.createdAt)}
                      </time>
                    </p>
                    {(info.length > 0 || e.ip) && (
                      <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        {info.map(([k, v]) => (
                          <span key={k} className="max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {k}: <span className="font-medium text-slate-800 dark:text-slate-100">{v}</span>
                          </span>
                        ))}
                        {e.ip && <span className="rounded-md px-1.5 py-0.5 font-mono text-slate-500">from {e.ip}</span>}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
      <p className="text-center text-xs text-slate-500">The latest 200 actions.</p>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Every action in this console and every operator sign-in, newest first." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
