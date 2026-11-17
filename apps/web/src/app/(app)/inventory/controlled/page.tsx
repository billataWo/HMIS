import { ShieldAlert } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ControlledBadge } from "@/components/controlled-badge";
import { PrintButton } from "@/components/print-button";
import { PageTitle } from "@/components/page-title";
import { EmptyState, inputClass, linkClass, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { api, ApiError, type ControlledRegister, type Me, type RegisterLine } from "@/lib/api";
import { formatDualDate, formatTime, fullName } from "@/lib/format";

type Search = { from?: string; to?: string; drug?: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Addis_Ababa" });

/** What a line was: where the units came from or went, in the words of a paper register. */
function Details({ l, t }: { l: RegisterLine; t: T }) {
  const who = l.patient && (
    <Link href={`/patients/${l.patient.id}`} className="hover:underline print:no-underline">
      {fullName(l.patient)} · {l.patient.mrn}
    </Link>
  );
  switch (l.type) {
    case "RECEIPT":
      return (
        <>
          {l.supplier ? t("Received from {supplier}", { supplier: l.supplier }) : t("Received")}
          {l.reference && <span className="text-slate-500"> · {l.reference}</span>}
        </>
      );
    case "DISPENSE":
      return (
        <>
          {t.rich("Dispensed to {who}", { who: who ?? t("a patient") })}
          {l.prescriber ? <span className="text-slate-500"> · {t("Rx Dr. {name}", { name: l.prescriber })}</span> : <span className="text-slate-500"> · {t("counter sale")}</span>}
        </>
      );
    case "RETURN":
      return (
        <>
          {t.rich("Returned by {who}", { who: who ?? t("the patient") })}
          {l.reason && <span className="text-slate-500"> · {t(l.reason)}</span>}
        </>
      );
    case "EXPIRED":
      return <>{t("Expired: written off for destruction")}</>;
    case "TRANSFER_OUT":
    case "TRANSFER_IN":
      // "TR-00001: Main store → Dispensary": out of one store, into the other (the balance is unchanged overall).
      return <>{t(l.type === "TRANSFER_OUT" ? "Moved out" : "Moved in")}{l.reason && <span className="text-slate-500"> · {l.reason}</span>}</>;
    default:
      return (
        <>
          {t(l.in ? "Added" : "Removed")}
          {l.reason && <span className="text-slate-500"> · {t(l.reason.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()))}</span>}
        </>
      );
  }
}

async function Register({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const t = await getT();
  const qs = new URLSearchParams(Object.entries({ from: q.from, to: q.to, drugId: q.drug }).filter(([, v]) => v) as [string, string][]);
  let reg: ControlledRegister, all: ControlledRegister, me: Me;
  try {
    [reg, me] = await Promise.all([api<ControlledRegister>(`/controlled-register?${qs}`), api<Me>("/auth/me")]);
    // The drug picker lists every controlled drug, whichever one is shown.
    all = q.drug ? await api<ControlledRegister>(`/controlled-register?from=${reg.to}&to=${reg.to}`) : reg;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only pharmacists and admins keep the controlled-drug register.")}</p>;
    if (e instanceof ApiError && e.status === 400) return <p className="text-sm text-red-700">{t(e.message)}</p>;
    throw e;
  }
  const monthStart = `${reg.to.slice(0, 8)}01`;
  const prev = new Date(`${monthStart}T12:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const lastMonth = prev.toISOString().slice(0, 7);
  const lastMonthEnd = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  if (!all.drugs.length) {
    return (
      <EmptyState icon={ShieldAlert} title={t("No controlled drugs in your list")}>
        {t.rich("Mark narcotics (tramadol, pethidine, morphine…) and psychotropics (diazepam, phenobarbital…) on their page in {link} and every unit received, dispensed, returned or written off is kept here.", {
          link: (
            <Link href="/inventory" className={linkClass}>
              {t("Inventory")}
            </Link>
          ),
        })}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Form action="/inventory/controlled" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-500">
            {t("From")}
            <input type="date" name="from" defaultValue={reg.from} className={`${inputClass} mt-1 w-40`} />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            {t("To")}
            <input type="date" name="to" defaultValue={reg.to} className={`${inputClass} mt-1 w-40`} />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            {t("Drug")}
            <select name="drug" defaultValue={q.drug ?? ""} className={`${inputClass} mt-1 w-auto`}>
              <option value="">{t("All controlled drugs")}</option>
              {all.drugs.map((d) => (
                <option key={d.id} value={d.id}>
                  {[d.genericName, d.strength, d.form].filter(Boolean).join(" ")}
                </option>
              ))}
            </select>
          </label>
          <button className={secondaryButtonClass}>{t("Show")}</button>
        </Form>
        <nav aria-label={t("Period")} className="flex gap-2">
          <Link href={`/inventory/controlled?from=${monthStart}${q.drug ? `&drug=${q.drug}` : ""}`} className={pillClass(reg.from === monthStart && !q.to)}>
            {t("This month")}
          </Link>
          <Link href={`/inventory/controlled?from=${lastMonth}-01&to=${lastMonthEnd}${q.drug ? `&drug=${q.drug}` : ""}`} className={pillClass(reg.from === `${lastMonth}-01` && reg.to === lastMonthEnd)}>
            {t("Last month")}
          </Link>
        </nav>
      </div>

      {/* On paper: whose register, for when. */}
      <p className="hidden text-sm print:block">
        <strong>{me.tenant.name}</strong> · {t("Controlled-drug register")} · {t("{from} to {to}", { from: day(reg.from), to: day(reg.to) })}
      </p>

      {reg.drugs.map((d, n) => (
        <section key={d.id} className={`surface overflow-hidden print:rounded-none print:border-0 print:shadow-none ${n > 0 ? "print:break-before-page" : ""}`}>
          <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h2 className="font-semibold text-slate-900 dark:text-white">
              {[d.genericName, d.strength, d.form].filter(Boolean).join(" ")}
              {d.brandName && <span className="font-normal text-slate-500"> ({d.brandName})</span>} <ControlledBadge c={d.controlled} />
            </h2>
            <p className="text-sm text-slate-600 tabular-nums dark:text-slate-300">
              {t.rich("Opening {opening} · received {received} · issued {issued} · closing {closing}", {
                opening: <strong>{d.opening}</strong>,
                received: <strong>{d.received}</strong>,
                issued: <strong>{d.issued}</strong>,
                closing: <strong>{d.closing}</strong>,
              })}{" "}
              {d.unit}
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-xs text-slate-500 dark:bg-slate-800/40 print:bg-transparent">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("Date")}</th>
                  <th className="px-4 py-2 font-medium">{t("Details")}</th>
                  <th className="px-4 py-2 font-medium">{t("Batch")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("In")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Out")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Balance")}</th>
                  <th className="px-4 py-2 font-medium">{t("By")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100 text-slate-500 dark:border-slate-800">
                  <td className="px-4 py-2 whitespace-nowrap">{day(reg.from)}</td>
                  <td className="px-4 py-2" colSpan={4}>
                    {t("Opening balance")}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{d.opening}</td>
                  <td />
                </tr>
                {d.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDualDate(l.at)}
                      <span className="block text-xs text-slate-500">{formatTime(l.at)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Details l={l} t={t} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {l.batchNo}
                      <span className="block text-xs text-slate-500">{t("exp {date}", { date: day(l.expiryDate) })}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.in || ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.out || ""}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{l.balance}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">{l.by ?? "—"}</td>
                  </tr>
                ))}
                {d.lines.length === 0 && (
                  <tr className="border-t border-slate-100 dark:border-slate-800">
                    <td colSpan={7} className="px-4 py-3 text-center text-slate-500">
                      {t("Nothing received or issued in this period.")}
                    </td>
                  </tr>
                )}
                <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                  <td className="px-4 py-2 whitespace-nowrap">{day(reg.to)}</td>
                  <td className="px-4 py-2 font-medium" colSpan={4}>
                    {t("Closing balance")}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{d.closing}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {/* Signed on paper at each check. */}
          <div className="hidden grid-cols-2 gap-8 px-4 pt-10 pb-4 text-sm print:grid">
            <p className="border-t border-black pt-1">{t("Pharmacist (name, signature, date)")}</p>
            <p className="border-t border-black pt-1">{t("Checked by (name, signature, date)")}</p>
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ControlledRegisterPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <>
      <PageTitle title="Controlled-drug register" subtitle="Narcotic and psychotropic drugs · every unit in and out, with the balance" actions={<PrintButton inline />} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Register searchParams={searchParams} />
      </Suspense>
    </>
  );
}
