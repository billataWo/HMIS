import { CircleCheck, CircleX, KeyRound, Server } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, type BadgeTone, Card, PageHeader, Skeleton } from "@/components/ui";
import { etb, formatAgo } from "@/lib/format";
import { DEPLOYMENT_LABEL, type Health, METHOD_LABEL, platformApi, type ServerStatus } from "@/lib/platform";
import { date, dateTime, StateBadge, thClass } from "../bits";

export const metadata: Metadata = { title: "Health" };

const SERVER: Record<ServerStatus, { label: string; tone: BadgeTone }> = {
  offline: { label: "Offline", tone: "danger" },
  never: { label: "Never connected", tone: "warning" },
  error: { label: "Problem", tone: "warning" },
  new: { label: "Being set up", tone: "info" },
  ok: { label: "Syncing", tone: "success" },
};

/** "20261218000000_platform_notes" → "18 Dec 2026": the update a server has, by its date. */
const version = (v: string | null) => {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`) : (v ?? "—");
};

async function Content() {
  const h = await platformApi<Health>("/platform/health");
  const down = h.servers.filter((s) => s.status === "offline" || s.status === "never");
  const behind = h.servers.filter((s) => s.behind);
  const failed30 = h.checkouts.byProvider.reduce((sum, p) => sum + p.failed, 0);
  const setupOk = h.setup.filter((s) => s.ok).length;

  const tiles = [
    { label: "Clinic servers offline", value: down.length, of: `of ${h.servers.length}`, bad: down.length > 0, href: "#servers" },
    { label: "Servers on an older update", value: behind.length, of: `of ${h.servers.length}`, bad: behind.length > 0, href: "#servers" },
    { label: "Online payments failed", value: failed30, of: "last 30 days", bad: failed30 > 0, href: "#payments" },
    { label: "Licences ending in 14 days", value: h.licences.length, of: "own servers", bad: h.licences.length > 0, href: "#licences" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <a key={t.label} href={t.href} className={`surface block p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900 ${t.bad ? "ring-1 ring-amber-300 dark:ring-amber-800" : ""}`}>
            <p className="text-sm text-slate-500">{t.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.bad ? "text-amber-700 dark:text-amber-300" : "text-slate-900 dark:text-white"}`}>
              {t.value} <span className="text-sm font-normal text-slate-500">{t.of}</span>
            </p>
          </a>
        ))}
      </div>

      <Card title="Clinic servers" description={`Servers in clinics send their records to the cloud. The cloud has the update of ${version(h.cloudVersion)}.`} className="overflow-hidden">
        <div id="servers" className="-m-5 scroll-mt-24 overflow-x-auto">
          {!h.servers.length ? (
            <p className="p-5 text-sm text-slate-500">No clinic has a server of its own yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={thClass}>Server</th>
                  <th className={thClass}>Clinic</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Last heard from</th>
                  <th className={thClass}>Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {h.servers.map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 font-medium">
                        <Server aria-hidden className="size-4 text-slate-400" />
                        {s.name}
                      </span>
                      {s.lastError && <p className="mt-0.5 max-w-md text-xs break-words text-red-700 dark:text-red-400">{s.lastError}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/platform/clinics/${s.tenantId}`} className="hover:underline">
                        {s.clinic}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={SERVER[s.status].tone} dot>
                        {SERVER[s.status].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">{s.lastSeenAt ? formatAgo(s.lastSeenAt) : `set up ${date(s.createdAt)}`}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {version(s.edgeVersion)}
                      {s.behind && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">older than the cloud: update it</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="Online payments" description="Checkouts with Chapa and telebirr over the last 30 days.">
          <div id="payments" className="scroll-mt-24 space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={`${thClass} pl-0`}>Provider</th>
                  <th className={`${thClass} text-right`}>Paid</th>
                  <th className={`${thClass} text-right`}>Failed</th>
                  <th className={`${thClass} text-right`}>Abandoned</th>
                  <th className={`${thClass} pr-0 text-right`}>Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
                {h.checkouts.byProvider.map((p) => (
                  <tr key={p.provider}>
                    <td className="py-2 font-medium">{METHOD_LABEL[p.provider]}</td>
                    <td className="px-3 py-2 text-right">{p.paid}</td>
                    <td className={`px-3 py-2 text-right ${p.failed ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{p.failed}</td>
                    <td className="px-3 py-2 text-right">{p.expired}</td>
                    <td className="py-2 text-right">{p.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {h.checkouts.unapplied > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                {h.checkouts.unapplied} online payment{h.checkouts.unapplied === 1 ? " was" : "s were"} received but not applied to an invoice:{" "}
                <Link href="/platform#unapplied" className="font-medium underline underline-offset-4">
                  see the overview
                </Link>
                .
              </p>
            )}
            {h.checkouts.failed.length > 0 && (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {h.checkouts.failed.map((f) => (
                  <li key={f.id} className="py-2">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link href={`/platform/clinics/${f.tenantId}`} className="font-medium hover:underline">
                        {f.clinic}
                      </Link>
                      <span className="tabular-nums">{etb(f.amount)}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {METHOD_LABEL[f.provider] ?? f.provider} · {dateTime(f.createdAt)} · <span className="font-mono">{f.reference}</span>
                    </p>
                    {f.lastError && <p className="text-xs text-red-700 dark:text-red-400">{f.lastError}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Licences ending soon" description="Clinics on their own server need a new licence each period. Clinic servers fetch it by themselves once paid.">
            <div id="licences" className="scroll-mt-24">
              {!h.licences.length ? (
                <p className="text-sm text-slate-500">None in the next 14 days.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {h.licences.map((l) => (
                    <li key={l.tenantId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <KeyRound aria-hidden className="size-4 shrink-0 text-slate-400" />
                        <Link href={`/platform/clinics/${l.tenantId}`} className="truncate font-medium hover:underline">
                          {l.clinic}
                        </Link>
                        <span className="text-xs text-slate-500">{DEPLOYMENT_LABEL[l.deployment]}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <StateBadge state={l.state} />
                        <span className={`text-xs font-medium ${l.daysLeft <= 3 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>
                          {l.daysLeft < 0 ? `ended ${date(l.endsAt)}` : l.daysLeft === 0 ? "ends today" : `${l.daysLeft} day${l.daysLeft === 1 ? "" : "s"} left`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card title="Setup" description={`${setupOk} of ${h.setup.length} done.`}>
            <ul className="space-y-2.5 text-sm">
              {h.setup.map((s) => (
                <li key={s.key} className="flex gap-2.5">
                  {s.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                  <span>
                    <span className="font-medium">{s.label}</span>
                    <span className="sr-only">{s.ok ? ": done" : ": not done"}</span>
                    {!s.ok && s.fix && <span className="block text-xs text-slate-500">{s.fix}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function HealthPage() {
  return (
    <>
      <PageHeader title="Health" subtitle="What needs a technician or a phone call before a clinic notices." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
