import { Info, TriangleAlert } from "lucide-react";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { AnnouncementClose } from "@/components/announcement-close";
import { AppNav, AppNavSkeleton } from "@/components/app-nav";
import Link from "next/link";
import { Notice, Skeleton } from "@/components/ui";
import { api, type BackupStatus, type Me, type SyncStatus } from "@/lib/api";
import { formatAgo, formatDualDate, formatMinutes, minutesAgo } from "@/lib/format";
import { LangBoundary } from "@/components/lang-boundary";
import { LangProvider } from "@/components/lang-provider";
import { getLang, getT } from "@/lib/lang";

async function Navigation() {
  const [me, lang] = await Promise.all([api<Me>("/auth/me"), getLang()]);
  return (
    <LangProvider lang={lang}>
      <AppNav me={me} lang={lang} />
    </LangProvider>
  );
}

/** For admins only: a banner when the server's backups need action (Settings → Backups). */
async function BackupBanner() {
  const me = await api<Me>("/auth/me");
  if (me.role !== "ADMIN") return null;
  const status = await api<BackupStatus>("/backups/status").catch(() => null);
  if (!status?.banner) return null;
  const t = await getT();
  return (
    <Notice tone="danger" className="mb-6 print:hidden">
      {t(status.banner)}{" "}
      <Link href="/settings/backups" className="font-medium underline underline-offset-4">
        {t("Open backup status")}
      </Link>
    </Notice>
  );
}

/**
 * The clinic's HMIS subscription: everyone is told when the clinic is read-only (and why nothing
 * can be saved); admins are told ahead of time, while there is still time to pay.
 */
async function SubscriptionBanner() {
  const me = await api<Me>("/auth/me");
  const s = me.subscription;
  if (!s) return null;
  const t = await getT();
  const admin = me.role === "ADMIN";
  const open = (
    <Link href="/settings/subscription" className="font-medium underline underline-offset-4">
      {t("Subscription")}
    </Link>
  );
  const tellAdmin = t("Please tell the clinic's admin.");
  if (s.unlicensed) {
    return (
      <Notice tone="danger" className="mb-6 print:hidden">
        {t("This server has no valid HMIS licence: records can be looked at and printed, but nothing new can be saved.")}{" "}
        {admin ? t.rich("Install the licence from HMIS: {link}.", { link: open }) : tellAdmin}
      </Notice>
    );
  }
  if (s.readOnly) {
    return (
      <Notice tone="danger" className="mb-6 print:hidden">
        {t(
          s.state === "cancelled"
            ? "This clinic's HMIS subscription has ended: records can be looked at and printed, but nothing new can be saved."
            : "This clinic's HMIS subscription is suspended: records can be looked at and printed, but nothing new can be saved.",
        )}{" "}
        {admin ? t.rich("Pay the open invoice to continue: {link}.", { link: open }) : tellAdmin}
      </Notice>
    );
  }
  if (!admin) return null;
  if (s.state === "overdue") {
    return (
      <Notice tone="warning" className="mb-6 print:hidden">
        {t.rich(
          s.daysLeft === 1
            ? "The HMIS subscription is overdue. In {n} day the clinic becomes read-only until it is paid: {link}."
            : "The HMIS subscription is overdue. In {n} days the clinic becomes read-only until it is paid: {link}.",
          { n: s.daysLeft, link: open },
        )}
      </Notice>
    );
  }
  if (s.endsAt && s.daysLeft !== null && s.daysLeft <= 7) {
    return (
      <Notice tone="info" className="mb-6 print:hidden">
        {t.rich(s.state === "trial" ? "The free trial ends on {date} ({days}): {link}." : "The paid period ends on {date} ({days}): {link}.", {
          date: formatDualDate(s.endsAt),
          days: t(s.daysLeft === 1 ? "{n} day" : "{n} days", { n: s.daysLeft }),
          link: open,
        })}
      </Notice>
    );
  }
  return null;
}

type Announcement = { id: string; tone: "INFO" | "WARNING"; title: string; titleAm: string | null; body: string | null; bodyAm: string | null };

/**
 * Messages from HMIS (maintenance, new features, price changes), written in the platform console.
 * In Amharic when HMIS wrote an Amharic version. Information can be closed (remembered in this
 * browser: components/announcement-close.tsx); a warning stays until HMIS ends it.
 */
async function Announcements() {
  const [list, lang, t, jar] = await Promise.all([api<Announcement[]>("/announcements").catch(() => []), getLang(), getT(), cookies()]);
  const closed = new Set(decodeURIComponent(jar.get("hmis_announcements_closed")?.value ?? "").split(","));
  const shown = list.filter((a) => a.tone === "WARNING" || !closed.has(a.id));
  if (!shown.length) return null;
  return (
    <div className="mb-6 space-y-3 print:hidden">
      {shown.map((a) => {
        const am = lang === "am";
        const title = (am && a.titleAm) || a.title;
        const body = (am && a.bodyAm) || a.body;
        const Icon = a.tone === "WARNING" ? TriangleAlert : Info;
        return (
          <section
            key={a.id}
            aria-label={t("Message from HMIS")}
            lang={am && a.titleAm ? "am" : "en"}
            className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${
              a.tone === "WARNING"
                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
                : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100"
            }`}
          >
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{title}</p>
              {body && <p className="mt-0.5 whitespace-pre-line opacity-90">{body}</p>}
            </div>
            {a.tone === "INFO" && <AnnouncementClose id={a.id} label={t("Close")} />}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Clinic server ↔ cloud: everyone on a read-only cloud copy is told so (and how fresh it is);
 * admins on a clinic server are told when changes have been waiting for the internet a while.
 */
async function SyncBanner() {
  const [me, sync, t] = await Promise.all([api<Me>("/auth/me"), api<SyncStatus>("/sync/status").catch(() => null), getT()]);
  if (!sync) return null;
  if (sync.mode === "cloud-copy") {
    const stale = minutesAgo(sync.lastSyncAt) > 15;
    return (
      <Notice tone={stale ? "warning" : "info"} className="mb-6 print:hidden">
        {t(
          stale
            ? "Cloud copy for looking things up: records are entered on the clinic's own server. Last update from it {ago}, so the newest work may not be here yet."
            : "Cloud copy for looking things up: records are entered on the clinic's own server. Last update from it {ago}.",
          { ago: formatAgo(sync.lastSyncAt, t) },
        )}
      </Notice>
    );
  }
  if (sync.mode === "clinic-server" && me.role === "ADMIN" && sync.waiting && sync.oldestWaitingAt) {
    if (minutesAgo(sync.oldestWaitingAt) < 60) return null;
    return (
      <Notice tone="warning" className="mb-6 print:hidden">
        {t("No connection to the cloud for {time}: {n} changes are kept safely on this server and will be sent when the internet is back. Keep working as normal.", {
          time: formatMinutes(Math.round(minutesAgo(sync.oldestWaitingAt)), t),
          n: sync.waiting,
        })}{" "}
        <Link href="/settings/sync" className="font-medium underline underline-offset-4">
          {t("Sync status")}
        </Link>
      </Notice>
    );
  }
  return null;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <Suspense fallback={<AppNavSkeleton />}>
        <Navigation />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8 print:max-w-none print:p-0">
        <Suspense fallback={null}>
          <SubscriptionBanner />
        </Suspense>
        <Suspense fallback={null}>
          <Announcements />
        </Suspense>
        <Suspense fallback={null}>
          <BackupBanner />
        </Suspense>
        <Suspense fallback={null}>
          <SyncBanner />
        </Suspense>
        <LangBoundary fallback={<Skeleton className="h-96" />}>{children}</LangBoundary>
      </main>
    </div>
  );
}
