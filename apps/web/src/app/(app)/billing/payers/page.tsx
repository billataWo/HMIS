import { Landmark } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, EmptyState, linkClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type Me, type Payer } from "@/lib/api";
import { etb } from "@/lib/format";
import { PayerForm } from "./payer-forms";
import { NoAccess } from "@/components/status-page";

async function Payers() {
  let payers: Payer[];
  let me: Me;
  const t = await getT();
  try {
    [payers, me] = await Promise.all([api<Payer[]>("/payers"), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only cashiers and admins can see payer accounts.")}</NoAccess>;
    throw e;
  }
  const owed = payers.reduce((s, p) => s + Number(p.balance ?? 0), 0);

  return (
    <div className="space-y-4">
      {me.role === "ADMIN" && <PayerForm />}
      {payers.length === 0 ? (
        <EmptyState icon={Landmark} title={t("No credit companies or insurers yet")}>
          {t("They are added here by an admin, or automatically the first time an invoice is billed to a new name.")}
        </EmptyState>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3">{t("Payer")}</th>
                <th className="px-4 py-3">{t("Type")}</th>
                <th className="px-4 py-3">{t("Contact")}</th>
                <th className="px-4 py-3 text-right">{t("Unpaid invoices")}</th>
                <th className="px-4 py-3 text-right">{t("They owe")}</th>
              </tr>
            </thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">
                    <Link href={`/billing/payers/${p.id}`} className={linkClass}>
                      {p.name}
                    </Link>
                    {!p.active && (
                      <span className="ml-2">
                        <Badge>{t("inactive")}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{t(p.type === "CREDIT" ? "Credit" : "Insurance")}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{[p.contactPerson, p.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 text-right">{p.openInvoices}</td>
                  <td className={`px-4 py-3 text-right font-medium ${Number(p.balance) > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{etb(p.balance ?? "0", t)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                <td colSpan={4} className="px-4 py-3">
                  {t("Total owed to the clinic")}
                </td>
                <td className="px-4 py-3 text-right">{etb(owed, t)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PayersPage() {
  return (
    <>
      <PageTitle title="Credit and insurance" subtitle="companies and insurers billed by the clinic" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Payers />
      </Suspense>
    </>
  );
}
