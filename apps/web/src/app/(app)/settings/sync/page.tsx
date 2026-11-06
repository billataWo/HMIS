import { Cloud, CloudOff, Server } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, EmptyState, Notice, PageHeader, secondaryButtonClass, Skeleton, StatCard } from "@/components/ui";
import { api, type Me, type SyncStatus } from "@/lib/api";
import { formatAgo, formatDualDate, formatTime, minutesAgo } from "@/lib/format";

const when = (iso: string) => `${formatDualDate(iso)}, ${formatTime(iso)}`;

async function Status() {
  const [me, s] = await Promise.all([api<Me>("/auth/me"), api<SyncStatus>("/sync/status")]);
  if (me.role !== "ADMIN") return <p className="text-sm text-slate-500">Only clinic admins can see the sync details.</p>;

  if (s.mode === "off") {
    return (
      <EmptyState icon={CloudOff} title="This clinic is not synced">
        The clinic works directly on this server. A clinic with its own server on the premises keeps working without internet and sends its
        records to the HMIS cloud whenever the connection is up; the HMIS support team sets that up (docs/sync).
      </EmptyState>
    );
  }

  if (s.mode === "cloud-copy") {
    return (
      <div className="space-y-6">
        <Notice tone="info">
          This is the cloud&apos;s copy of the clinic. Staff can sign in from anywhere to look up patients and run reports, but records are entered
          on the clinic&apos;s own server, so changes here are refused.
        </Notice>
        <Card title="Clinic servers sending to this copy">
          <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
            {(s.clients ?? []).map((c) => (
              <li key={c.name} className="flex flex-wrap items-start gap-3 py-3">
                <Server aria-hidden className="mt-0.5 size-5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Last in touch {formatAgo(c.lastSeenAt)} · {c.appliedRows.toLocaleString()} changes received
                  </p>
                  {c.lastError && <p className="mt-1 text-sm break-words text-red-700 dark:text-red-300">{c.lastError}</p>}
                </div>
                <Badge tone={c.lastError ? "danger" : minutesAgo(c.lastSeenAt) > 15 ? "warning" : "success"} dot>
                  {c.lastError ? "Problem" : minutesAgo(c.lastSeenAt) > 15 ? "Not in touch" : "Connected"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  const waiting = s.waiting ?? 0;
  const offline = Boolean(s.lastError) && waiting > 0;
  return (
    <div className="space-y-6">
      <section className="surface flex flex-wrap items-center gap-4 p-5">
        {offline ? (
          <CloudOff aria-hidden className="size-9 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Cloud aria-hidden className="size-9 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {offline ? "Working offline: changes are waiting for the internet" : "Connected to the HMIS cloud"}
          </h2>
          <p className="text-sm text-slate-500">
            This server is where the clinic works. Everything keeps working without internet; changes go to the cloud when the connection is up.
          </p>
        </div>
        <Badge tone={offline ? "warning" : "success"} dot>
          {offline ? "Offline" : "Connected"}
        </Badge>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Last sent to the cloud" value={formatAgo(s.lastSyncAt ?? null)} hint={s.lastSyncAt ? when(s.lastSyncAt) : undefined} />
        <StatCard
          label="Waiting to be sent"
          value={waiting.toLocaleString()}
          hint={s.oldestWaitingAt ? `oldest from ${formatAgo(s.oldestWaitingAt)}` : "nothing waiting"}
        />
        <StatCard label="Sent in total" value={(s.pushedRows ?? 0).toLocaleString()} hint={s.enabledAt ? `since ${formatDualDate(s.enabledAt)}` : undefined} />
      </div>

      {s.lastError && (
        <Notice tone="warning">
          {s.lastError}
          {s.lastErrorAt ? ` (${when(s.lastErrorAt)})` : ""}. Changes are kept safely on this server and sent as soon as the cloud can be reached.
        </Notice>
      )}
      {s.cloudUrl && <p className="text-sm text-slate-500">Cloud: {s.cloudUrl}</p>}
    </div>
  );
}

export default function SyncPage() {
  return (
    <>
      <PageHeader
        title="Cloud sync"
        subtitle="the clinic server and the HMIS cloud"
        actions={
          <Link href="/settings" className={secondaryButtonClass}>
            Settings
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Status />
      </Suspense>
    </>
  );
}
