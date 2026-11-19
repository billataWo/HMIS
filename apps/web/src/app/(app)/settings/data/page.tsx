import { Download } from "lucide-react";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { buttonClass, Card, Field, Input, Notice, Skeleton } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { getT } from "@/lib/lang";
import { BackToSettings } from "../back-to-settings";
import { NoAccess } from "@/components/status-page";

const ERRORS: Record<string, string> = {
  password: "That password is not right.",
  locked: "Too many wrong passwords. Try again in 15 minutes.",
  failed: "The export could not be made. Try again, or ask HMIS.",
  expired: "The download link has expired. Enter your password again.",
};

async function Content({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [me, { error }, t] = await Promise.all([api<Me>("/auth/me"), searchParams, getT()]);
  if (me.role !== "ADMIN") return <NoAccess>{t("Only clinic admins export the clinic's data.")}</NoAccess>;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card title={t("All of the clinic's records")} description={t("Patients, visits, results, prescriptions, bills, stock, staff and the audit log")}>
        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <p>
            {t(
              "One file with every record of the clinic, in a structured form (compressed JSON lines). Keep it safe: it holds every patient's health records. Another HMIS server can import it, for example to move from the HMIS cloud to the clinic's own server.",
            )}
          </p>
          <p>{t("Staff passwords and two-step keys are never in it: after an import, staff get new passwords.")}</p>
          {error && ERRORS[error] && <Notice tone="danger">{t(ERRORS[error])}</Notice>}
          <form method="post" action="/settings/data/download" className="space-y-3">
            <Field label={t("Your password")} hint={t("Asked again: this file holds every patient's records")}>
              <Input name="password" type="password" required autoComplete="current-password" />
            </Field>
            <button className={buttonClass}>
              <Download aria-hidden className="size-4" /> {t("Download all the data")}
            </button>
          </form>
          <p className="text-xs text-slate-500">{t("The export is recorded in the audit log.")}</p>
        </div>
      </Card>
      <Card title={t("One patient's record")}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t.rich(
            "When a patient asks for their records (Proclamation 1321/2024, the right of access and to data portability), open the patient and choose {button}. Print the visit documents too if they want them on paper.",
            { button: <strong>{t("Export record")}</strong> },
          )}
        </p>
      </Card>
    </div>
  );
}

export default function DataPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <>
      <PageTitle title="Your data" subtitle="take the clinic's records with you" actions={<BackToSettings />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
