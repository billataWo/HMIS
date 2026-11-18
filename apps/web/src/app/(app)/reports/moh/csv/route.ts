import { api, type MohReport } from "@/lib/api";

const esc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The monthly MoH report as a CSV file (UTF-8 with BOM so Excel shows Amharic correctly). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const y = Number(url.searchParams.get("y"));
  const m = Number(url.searchParams.get("m"));
  const r = await api<MohReport>(`/reports/moh-monthly${y && m ? `?ecYear=${y}&ecMonth=${m}` : ""}`);

  const rows: (string | number)[][] = [
    ["Facility", r.facility.name],
    ["Period (Ethiopian calendar)", r.period.label, r.period.labelAm],
    ["Gregorian dates", r.period.startDay, "to (exclusive)", r.period.endDay],
    [],
    ["OPD visits by age and sex"],
    ["Age group", "Male", "Female", "Total"],
    ...r.opd.byAge.map((a) => [a.ageGroup, a.male, a.female, a.male + a.female]),
    ["Total", r.opd.male, r.opd.female, r.opd.total],
    ["New visits", r.opd.newVisits],
    ["Repeat visits", r.opd.repeatVisits],
    ["Visits without diagnosis", r.opd.withoutDiagnosis],
    [],
    ["Top causes of OPD morbidity"],
    ["Rank", "ICD-11", "Diagnosis", "Male", "Female", "Total"],
    ...r.morbidity.map((x, i) => [i + 1, x.code, x.label, x.male, x.female, x.total]),
    [],
    ...(r.familyPlanning
      ? [
          ["Family planning: acceptors by method"],
          ["Method", "New", "Repeat"],
          ...r.familyPlanning.byMethod.map((m) => [m.label, m.new, m.repeat]),
          ["Total", r.familyPlanning.acceptorsNew, r.familyPlanning.acceptorsRepeat],
          ["Family planning: acceptors by age"],
          ["Age group", "New", "Repeat"],
          ...r.familyPlanning.byAge.map((a) => [a.ageGroup, a.new, a.repeat]),
          ["Implant and IUCD removals", r.familyPlanning.removals],
          ["Early removals", r.familyPlanning.earlyRemovals],
          ["Couple-years of protection", r.familyPlanning.cyp],
          [],
        ]
      : []),
    ["Malaria tests performed", r.malaria.tested],
    ["Malaria tests positive", r.malaria.positive],
    ...r.malaria.byResult.map((x) => [`Result: ${x.result}`, x.count]),
  ];
  const csv = "﻿" + rows.map((row) => row.map(esc).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="opd-report-${r.period.ecYear}-${String(r.period.ecMonth).padStart(2, "0")}.csv"`,
    },
  });
}
