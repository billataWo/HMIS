import { CircleCheck, CircleX, CloudUpload, DatabaseBackup, History, HardDrive, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, type BadgeTone, Card, EmptyState, Notice, Skeleton, StatCard } from "@/components/ui";
import { api, ApiError, type BackupCheckStatus, type BackupEventRow, type BackupStatus } from "@/lib/api";
import { formatAgo, formatDualDate, formatTime } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { BackToSettings } from "../back-to-settings";
import { NoAccess } from "@/components/status-page";

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

/** How far back a restore can go, e.g. "14 days" or "9 hours". */
function since(iso: string, t: T) {
  const hours = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 36) return t(hours === 1 ? "{n} hour" : "{n} hours", { n: hours });
  return t("{n} days", { n: Math.round(hours / 24) });
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
  const t = await getT();
  const ago = (iso: string | null) => formatAgo(iso, t);
  let s: BackupStatus;
  try {
    s = await api<BackupStatus>("/backups/status");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only clinic admins can see the backup status.")}</NoAccess>;
    throw e;
  }

  if (!s.monitored && s.managedBy) {
    return (
      <EmptyState icon={DatabaseBackup} title={t("Backups are made by the hosting provider")}>
        <span className="block">{s.managedBy}</span>
        <span className="mt-2 block">
          {t(
            "HMIS cannot see or test these backups: to restore, ask the HMIS support team. The off-site copy and weekly restore test of the HMIS backup service are not set up on this server.",
          )}
        </span>
      </EmptyState>
    );
  }

  if (!s.monitored) {
    return (
      <EmptyState icon={DatabaseBackup} title={t("Backups are not running on this server")}>
        {t(
          "No backup has been recorded. The backup service is set up on the server by the HMIS support team (deploy/compose.yml); once it runs, this page shows every backup, the off-site copy and the weekly restore test.",
        )}
      </EmptyState>
    );
  }

  const head = STATUS[s.overall];
  const recovery = s.lastRestoreTest?.recoverySeconds;
  const nightly = s.mode === "nightly";
  return (
    <div className="space-y-6">
      <section className="surface flex flex-wrap items-center gap-4 p-5">
        <head.icon aria-hidden className={`size-9 shrink-0 ${head.color}`} />
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t(HEADLINE[s.overall])}</h2>
          <p className="text-sm text-slate-500">
            {s.site ? `${s.site} · ` : ""}
            {t(
              nightly
                ? "a full copy every night, encrypted and stored off-site"
                : "every change is copied to the backup disk within about a minute, encrypted with AES-256",
            )}
          </p>
        </div>
        <Badge tone={head.tone} dot>
          {t(head.label)}
        </Badge>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("Last backup")}
          icon={HardDrive}
          value={ago(s.lastBackup?.at ?? null)}
          hint={s.lastBackup ? `${s.lastBackup.type ?? ""} · ${t("database {size}", { size: bytes(s.lastBackup.databaseBytes) })}` : t("none yet")}
        />
        <StatCard
          label={t("Can restore to")}
          icon={History}
          value={s.restoreWindow?.from ? since(s.restoreWindow.from, t) : "—"}
          hint={
            s.restoreWindow?.from
              ? t(nightly ? "a nightly copy from any night since {date}" : "any moment since {date}", { date: formatDualDate(s.restoreWindow.from) })
              : undefined
          }
        />
        <StatCard
          label={t("Off-site copy")}
          icon={CloudUpload}
          value={s.offsite.configured ? ago(s.offsite.lastCopiedAt) : t("Not set up")}
          hint={s.offsite.configured ? (s.offsite.location ?? t("S3 storage with object lock")) : t("needed for the 3-2-1 rule")}
        />
        <StatCard
          label={t("Last restore test")}
          icon={ShieldCheck}
          value={t(s.lastRestoreTest ? (s.lastRestoreTest.ok ? "Passed" : "Failed") : "Not yet")}
          hint={
            s.lastRestoreTest
              ? `${ago(s.lastRestoreTest.at)}${recovery ? ` · ${t("restored in {n} min", { n: Math.max(1, Math.round(recovery / 60)) })}` : ""}`
              : undefined
          }
        />
      </div>

      {s.lastRestore && (
        <Notice tone="info">
          {s.lastRestore.message && t(s.lastRestore.message)} ({when(s.lastRestore.at)}).
        </Notice>
      )}

      <Card
        title={t("Checks")}
        description={t(
          nightly
            ? "Each nightly copy is read back from storage and compared before it counts."
            : "Run automatically on the server; problems are also sent to the support team by Telegram or email.",
        )}
      >
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {s.checks.map((c) => {
            const st = STATUS[c.status];
            return (
              <li key={c.key} className="flex items-start gap-3 py-3">
                <st.icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${st.color}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-white">{t(c.label)}</p>
                  <p className="text-sm break-words text-slate-600 dark:text-slate-400">{c.detail && t(c.detail)}</p>
                </div>
                {c.at && <span className="shrink-0 text-xs text-slate-500">{ago(c.at)}</span>}
                <span className="sr-only">{t(st.label)}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {nightly ? (
        <Card title={t("How the clinic's data is protected")}>
          <ul className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3 dark:text-slate-400">
            <li>
              <p className="font-medium text-slate-900 dark:text-white">{t("A copy every night, off-site")}</p>
              {t("Every night a full copy of the database is made and stored in separate storage ({site}), apart from the database.", { site: s.offsite.location ?? "S3" })}
            </li>
            <li>
              <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                <Lock aria-hidden className="size-3.5" /> {t("Only the offline key opens it")}
              </p>
              {t("Copies are encrypted for a key the HMIS team keeps offline: this server can write them but not read them, so a stolen storage password exposes nothing.")}
            </li>
            <li>
              <p className="font-medium text-slate-900 dark:text-white">{t("Kept for months")}</p>
              {t("Every night for {days} days, then the first copy of each month for {months} months.", {
                days: s.retention?.days ?? "?",
                months: s.retention?.months ?? "?",
              })}
            </li>
          </ul>
          <p className="mt-4 text-sm text-slate-500">
            {t(
              "Restoring replaces live medical records, so it is done by the HMIS support team with the offline key, following the backup guide. Call them if data was deleted by mistake: the database can be put back to any nightly copy in the window above.",
            )}
          </p>
        </Card>
      ) : (
      <Card title={t("How the clinic's data is protected")}>
        <ul className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3 dark:text-slate-400">
          <li>
            <p className="font-medium text-slate-900 dark:text-white">{t("3 copies, 2 kinds of storage, 1 off-site")}</p>
            {t("The live database, an encrypted copy on a second disk in this server, and an encrypted copy in storage at another site in Ethiopia.")}
          </li>
          <li>
            <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
              <Lock aria-hidden className="size-3.5" /> {t("Cannot be deleted")}
            </p>
            {t("Every version of the off-site copy is locked (write-once) for weeks: ransomware, a stolen password or even an administrator cannot erase it.")}
          </li>
          <li>
            <p className="font-medium text-slate-900 dark:text-white">{t("Proven every week")}</p>
            {t("The latest backup is restored into a separate database, checked for corruption and compared with the live data.")}
          </li>
        </ul>
        <p className="mt-4 text-sm text-slate-500">
          {t(
            "Restoring replaces live medical records, so it is done on the server by the HMIS support team following the written restore guide, not from this screen. Call them if data was deleted by mistake: the database can be put back to any moment in the window above.",
          )}
        </p>
      </Card>
      )}

      <Card title={t("Recent activity")} className="overflow-hidden">
        <div className="-m-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3">{t("When")}</th>
                <th className="px-4 py-3">{t("What")}</th>
                <th className="px-4 py-3">{t("Result")}</th>
                <th className="px-4 py-3">{t("Details")}</th>
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
                    {t(KIND[e.kind])}
                    {e.detail && <span className="block text-xs text-slate-500">{e.detail}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={e.status === "OK" ? "success" : e.status === "WARNING" ? "warning" : "danger"}>
                      {t(e.status === "OK" ? "OK" : e.status === "WARNING" ? "Warning" : "Failed")}
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
      <PageTitle title="Backups" subtitle="automatic, encrypted and copied off-site" actions={<BackToSettings />} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Status />
      </Suspense>
    </>
  );
}

