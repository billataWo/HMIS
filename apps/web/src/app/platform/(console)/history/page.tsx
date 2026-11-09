import Link from "next/link";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { type HistoryEntry, platformApi } from "@/lib/platform";
import { dateTime, tdClass, thClass } from "../bits";

async function Content() {
  const entries = await platformApi<HistoryEntry[]>("/platform/audit");
  return (
    <Card className="overflow-x-auto">
      <table className="-m-5 w-[calc(100%+2.5rem)] text-sm">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <th className={thClass}>When</th>
            <th className={thClass}>Who</th>
            <th className={thClass}>What</th>
            <th className={thClass}>Details</th>
            <th className={thClass}>From</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {entries.map((e) => (
            <tr key={e.id}>
              <td className={`${tdClass} whitespace-nowrap`}>{dateTime(e.createdAt)}</td>
              <td className={tdClass}>{e.operator ?? "—"}</td>
              <td className={tdClass}>
                {e.action}
                {e.tenantId && (
                  <>
                    {" "}
                    <Link href={`/platform/clinics/${e.tenantId}`} className="text-brand-700 hover:underline dark:text-brand-400">
                      clinic
                    </Link>
                  </>
                )}
              </td>
              <td className={`${tdClass} max-w-md truncate font-mono text-xs text-slate-500`}>{e.data ? JSON.stringify(e.data) : ""}</td>
              <td className={`${tdClass} text-xs text-slate-500`}>{e.ip ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="every action in this console and every operator sign-in" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
