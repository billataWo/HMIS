import { Download } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, Card, Field, Input, Notice, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Me } from "@/lib/api";

const ERRORS: Record<string, string> = {
  password: "That password is not right.",
  locked: "Too many wrong passwords. Try again in 15 minutes.",
  failed: "The export could not be made. Try again, or ask HMIS.",
  expired: "The download link has expired. Enter your password again.",
};

async function Content({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [me, { error }] = await Promise.all([api<Me>("/auth/me"), searchParams]);
  if (me.role !== "ADMIN") return <p className="text-sm text-slate-500">Only clinic admins export the clinic&apos;s data.</p>;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card title="All of the clinic's records" description="Patients, visits, results, prescriptions, bills, stock, staff and the audit log">
        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <p>
            One file with every record of the clinic, in a structured form (compressed JSON lines). Keep it safe: it holds every patient&apos;s
            health records. Another HMIS server can import it, for example to move from the HMIS cloud to the clinic&apos;s own server.
          </p>
          <p>Staff passwords and two-step keys are never in it: after an import, staff get new passwords.</p>
          {error && ERRORS[error] && <Notice tone="danger">{ERRORS[error]}</Notice>}
          <form method="post" action="/settings/data/download" className="space-y-3">
            <Field label="Your password" hint="Asked again: this file holds every patient's records">
              <Input name="password" type="password" required autoComplete="current-password" />
            </Field>
            <button className={buttonClass}>
              <Download aria-hidden className="size-4" /> Download all the data
            </button>
          </form>
          <p className="text-xs text-slate-500">The export is recorded in the audit log.</p>
        </div>
      </Card>
      <Card title="One patient's record">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          When a patient asks for their records (Proclamation 1321/2024, the right of access and to data portability), open the patient and
          choose <strong>Export record</strong>. Print the visit documents too if they want them on paper.
        </p>
      </Card>
    </div>
  );
}

export default function DataPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <>
      <PageHeader
        title="Your data"
        subtitle="take the clinic's records with you"
        actions={
          <Link href="/settings" className={secondaryButtonClass}>
            Settings
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
