import { CircleCheck, CircleX, CloudUpload, DatabaseBackup, History, HardDrive, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, type BadgeTone, Card, EmptyState, Notice, PageHeader, secondaryButtonClass, Skeleton, StatCard } from "@/components/ui";
import { api, ApiError, type BackupCheckStatus, type BackupEventRow, type BackupStatus } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";

const STATUS: Record<BackupCheckStatus, { label: string; tone: BadgeTone; icon: typeof CircleCheck; color: string }> = {
  ok: { label: "OK", tone: "success", icon: CircleCheck, color: "text-emerald-600 dark:text-emerald-400" },
  warning: { label: "Needs attention", tone: "warning", icon: TriangleAlert, color: "text-amber-600 dark:text-amber-400" },
  failing: { label: "Failing", tone: "danger", icon: CircleX, color: "text-red-600 dark:text-red-400" },
};

const HEADLINE: Record<BackupCheckStatus, string> = {
  ok: "Backups are healthy",
  warning: "Backups are running, but something needs attention",
  failing: "Backups need action now",
};

const KIND: Record<BackupEventRow["kind"], string> = {
  BACKUP: "Backup",
  OFFSITE_SYNC: "Off-site copy",
  CHECK: "Health check",
  RESTORE_TEST: "Restore test",
  VERIFY: "Verification",
  ARCHIVE: "Long-term archive",
  RESTORE: "Database restored",
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** How far back a restore can go, e.g. "14 days" or "9 hours". */
function since(iso: string) {
  const hours = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

function bytes(n: number | null) {
  if (n === null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const when = (iso: string) => `${formatDualDate(iso)}, ${formatTime(iso)}`;

async function Status() {
  let s: BackupStatus;
  try {
    s = await api<BackupStatus>("/backups/status");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins can see the backup status.</p>;
    throw e;
  }

  if (!s.monitored) {
    return (
      <EmptyState icon={DatabaseBackup} title="Backups are not running on this server">
        No backup has been recorded. The backup service is set up on the server by the HMIS support team (deploy/compose.yml); once it runs,
        this page shows every backup, the off-site copy and the weekly restore test.
      </EmptyState>
    );
  }

  const head = STATUS[s.overall];
  const recovery = s.lastRestoreTest?.recoverySeconds;
  return (
    <div className="space-y-6">
      <section className="surface flex flex-wrap items-center gap-4 p-5">
        <head.icon aria-hidden className={`size-9 shrink-0 ${head.color}`} />
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{HEADLINE[s.overall]}</h2>
          <p className="text-sm text-slate-500">
            {s.site ? `${s.site} · ` : ""}every change is copied to the backup disk within about a minute, encrypted with AES-256
          </p>
        </div>
        <Badge tone={head.tone} dot>
          {head.label}
        </Badge>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Last backup"
          icon={HardDrive}
          value={ago(s.lastBackup?.at ?? null)}
          hint={s.lastBackup ? `${s.lastBackup.type ?? ""} · database ${bytes(s.lastBackup.databaseBytes)}` : "none yet"}
        />
        <StatCard
          label="Can restore to"
          icon={History}
          value={s.restoreWindow?.from ? since(s.restoreWindow.from) : "—"}
          hint={s.restoreWindow?.from ? `any moment since ${formatDualDate(s.restoreWindow.from)}` : undefined}
        />
        <StatCard
          label="Off-site copy"
          icon={CloudUpload}
          value={s.offsite.configured ? ago(s.offsite.lastCopiedAt) : "Not set up"}
          hint={s.offsite.configured ? (s.offsite.location ?? "S3 storage with object lock") : "needed for the 3-2-1 rule"}
        />
        <StatCard
          label="Last restore test"
          icon={ShieldCheck}
          value={s.lastRestoreTest ? (s.lastRestoreTest.ok ? "Passed" : "Failed") : "Not yet"}
          hint={s.lastRestoreTest ? `${ago(s.lastRestoreTest.at)}${recovery ? ` · restored in ${Math.max(1, Math.round(recovery / 60))} min` : ""}` : undefined}
        />
      </div>

      {s.lastRestore && (
        <Notice tone="info">
          {s.lastRestore.message} ({when(s.lastRestore.at)}).
        </Notice>
      )}

      <Card title="Checks" description="Run automatically on the server; problems are also sent to the support team by Telegram or email.">
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {s.checks.map((c) => {
            const st = STATUS[c.status];
            return (
              <li key={c.key} className="flex items-start gap-3 py-3">
                <st.icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${st.color}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-white">{c.label}</p>
                  <p className="text-sm break-words text-slate-600 dark:text-slate-400">{c.detail}</p>
                </div>
                {c.at && <span className="shrink-0 text-xs text-slate-500">{ago(c.at)}</span>}
                <span className="sr-only">{st.label}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="How the clinic's data is protected">
        <ul className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3 dark:text-slate-400">
          <li>
            <p className="font-medium text-slate-900 dark:text-white">3 copies, 2 kinds of storage, 1 off-site</p>
            The live database, an encrypted copy on a second disk in this server, and an encrypted copy in storage at another site in Ethiopia.
          </li>
          <li>
            <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
              <Lock aria-hidden className="size-3.5" /> Cannot be deleted
            </p>
            Every version of the off-site copy is locked (write-once) for weeks: ransomware, a stolen password or even an administrator cannot erase it.
          </li>
          <li>
            <p className="font-medium text-slate-900 dark:text-white">Proven every week</p>
            The latest backup is restored into a separate database, checked for corruption and compared with the live data.
          </li>
        </ul>
        <p className="mt-4 text-sm text-slate-500">
          Restoring replaces live medical records, so it is done on the server by the HMIS support team following the written restore guide,
          not from this screen. Call them if data was deleted by mistake: the database can be put back to any moment in the window above.
        </p>
      </Card>

      <Card title="Recent activity" className="overflow-hidden">
        <div className="-m-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {s.recent.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {formatTime(e.finishedAt)}
                    <span className="block text-xs text-slate-500">{formatDualDate(e.finishedAt)}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {KIND[e.kind]}
                    {e.detail && <span className="block text-xs text-slate-500">{e.detail}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={e.status === "OK" ? "success" : e.status === "WARNING" ? "warning" : "danger"}>
                      {e.status === "OK" ? "OK" : e.status === "WARNING" ? "Warning" : "Failed"}
                    </Badge>
                  </td>
                  <td className="max-w-lg px-4 py-2.5 text-xs break-words text-slate-600 dark:text-slate-400">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function BackupsPage() {
  return (
    <>
      <PageHeader
        title="Backups"
        subtitle="ምትኬ · automatic, encrypted, copied off-site and tested every week"
        actions={
          <Link href="/settings" className={secondaryButtonClass}>
            Settings
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Status />
      </Suspense>
    </>
  );
}

