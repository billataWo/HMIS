import { Suspense, type ReactNode } from "react";
import { AppNav, AppNavSkeleton } from "@/components/app-nav";
import Link from "next/link";
import { Notice } from "@/components/ui";
import { api, type BackupStatus, type Me } from "@/lib/api";
import { getLang } from "@/lib/lang";

async function Navigation() {
  const [me, lang] = await Promise.all([api<Me>("/auth/me"), getLang()]);
  return <AppNav me={me} lang={lang} />;
}

/** For admins only: a banner when the server's backups need action (Settings → Backups). */
async function BackupBanner() {
  const me = await api<Me>("/auth/me");
  if (me.role !== "ADMIN") return null;
  const status = await api<BackupStatus>("/backups/status").catch(() => null);
  if (!status?.banner) return null;
  return (
    <Notice tone="danger" className="mb-6 print:hidden">
      {status.banner}{" "}
      <Link href="/settings/backups" className="font-medium underline underline-offset-4">
        Open backup status
      </Link>
    </Notice>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <Suspense fallback={<AppNavSkeleton />}>
        <Navigation />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8 print:max-w-none print:p-0">
        <Suspense fallback={null}>
          <BackupBanner />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
