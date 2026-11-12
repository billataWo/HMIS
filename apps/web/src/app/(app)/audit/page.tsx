import { connection } from "next/server";
import { ScrollText } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type AuditEntry, type StaffUser } from "@/lib/api";
import { clinicToday, formatDualDate, formatTime, ROLE_LABELS } from "@/lib/format";

type Search = { from?: string; to?: string; userId?: string; action?: string; before?: string };

/** The area an action belongs to ("invoice.void" → "invoice."), for the filter. */
const AREAS: [string, string][] = [
  ["patient.", "Patients"],
  ["visit.", "Visits and queue"],
  ["prescription.", "Prescriptions and dispensing"],
  ["lab.", "Lab"],
  ["invoice.", "Invoices and refunds"],
  ["payment.", "Payments"],
  ["payer.", "Credit and insurance"],
  ["cash.", "Cash closing"],
  ["stock.", "Stock"],
  ["po.", "Purchase orders"],
  ["user.", "Staff accounts"],
  ["settings.", "Settings"],
];

/** A short, readable summary of what was recorded (field names and amounts, never clinical content). */
function details(data: AuditEntry["data"]) {
  if (!data) return "";
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? (typeof v[0] === "object" ? `${v.length} items` : v.join(", ")) : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

async function Log({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  await connection(); // "today" is the request's, not a prerender's
  const today = clinicToday();
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  let res: { from: string; to: string; entries: AuditEntry[]; next: string | null };
  let staff: StaffUser[];
  try {
    [res, staff] = await Promise.all([api<typeof res>(`/audit?${params}`), api<StaffUser[]>("/users")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins can see the audit log.</p>;
    throw e;
  }
  const older = new URLSearchParams(params);
  if (res.next) older.set("before", res.next);

  return (
    <div className="space-y-4">
      <Form action="/audit" className="surface flex flex-wrap items-end gap-3 p-4 text-sm">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-slate-500">From</span>
          <input type="date" name="from" defaultValue={res.from} max={today} className={`${inputClass} w-40`} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-slate-500">To</span>
          <input type="date" name="to" defaultValue={res.to} max={today} className={`${inputClass} w-40`} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-slate-500">Staff member</span>
          <select name="userId" defaultValue={q.userId ?? ""} className={`${inputClass} w-48`}>
            <option value="">Everyone</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({ROLE_LABELS[u.role]})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-slate-500">Area</span>
          <select name="action" defaultValue={q.action ?? ""} className={`${inputClass} w-52`}>
            <option value="">Everything</option>
            {AREAS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button className={secondaryButtonClass}>Show</button>
      </Form>

      {res.entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nothing recorded for these filters" />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {res.entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {formatTime(e.createdAt)}
                    <span className="block text-xs text-slate-500">{formatDualDate(e.createdAt)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {e.user ? e.user.fullName : <span className="text-slate-500">System</span>}
                    {e.user && <span className="block text-xs text-slate-500">{ROLE_LABELS[e.user.role]}</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
                  <td className="max-w-md px-4 py-2.5 text-xs break-words text-slate-600 dark:text-slate-400">{details(e.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.next && (
        <Link href={`/audit?${older}`} className={secondaryButtonClass}>
          Older entries
        </Link>
      )}
    </div>
  );
}

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <>
      <PageHeader title="Audit log" subtitle="who did what, and when · field names and amounts only, never clinical notes" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Log searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}
