import { LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { NoAccess } from "@/components/status-page";
import { secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { getT } from "@/lib/lang";
import { CATEGORIES, REPORT_LINKS, REPORTS } from "@/lib/reports";
import { ReportFinder } from "./report-finder";

export const metadata: Metadata = { title: "Reports" };

async function Library() {
  const [t, me] = await Promise.all([getT(), api<Me>("/auth/me")]);
  if (me.role !== "ADMIN") return <NoAccess>{t("Only clinic admins can see reports.")}</NoAccess>;
  const groups = CATEGORIES.map((c) => ({
    key: c.key,
    title: t(c.title),
    description: t(c.description),
    items: [
      ...REPORTS.filter((r) => r.category === c.key).map((r) => ({ href: `/reports/${r.key}`, title: t(r.title), description: t(r.description), asOfNow: r.asOfNow })),
      ...REPORT_LINKS.filter((r) => r.category === c.key).map((r) => ({ href: r.href, title: t(r.title), description: t(r.description) })),
    ],
  }));
  return <ReportFinder groups={groups} />;
}

async function ToDashboard() {
  const t = await getT();
  return (
    <Link href="/dashboard" className={secondaryButtonClass}>
      <LayoutDashboard aria-hidden />
      {t("Dashboard")}
    </Link>
  );
}

export default function ReportsPage() {
  return (
    <>
      <PageTitle title="Reports" subtitle="every row, to print or download" actions={<ToDashboard />} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Library />
      </Suspense>
    </>
  );
}
