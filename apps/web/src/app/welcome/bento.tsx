import { CalendarDays, ChartColumn, FlaskConical, ListOrdered, Pill, Receipt, ScrollText, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

/** The cards' words, and the labels in their drawings. */
const B = {
  en: {
    queue: ["Queue and waiting room", "Live queue for each department, and a TV in the waiting room that calls the next number."],
    queueRows: [["12", "Selam T.", "With Dr. Hana"], ["13", "Dawit H.", "At the lab"], ["15", "Abebe K.", "Waiting"]],
    nowCalling: "Now calling",
    room: "Room 2",
    lab: ["Laboratory", "Orders reach the bench; results are checked against reference ranges and go back to the doctor."],
    consult: ["Consultation", "History, allergies, vitals, notes, ICD-11 diagnoses and prescriptions, per visit."],
    vitals: ["BP 118/76", "T 36.8 °C", "SpO₂ 98%", "Pulse 82"],
    diagnosis: "Pneumonia",
    primary: "ICD-11 · primary",
    pharmacy: ["Pharmacy and stock", "Dispensing from stock by batch, with low-stock and expiry warnings."],
    expiry: "Batch B-2207 expires in 32 days",
    billing: ["Billing", "Price list, pay-before-service, receipts; cash, telebirr, Chapa or bank transfer."],
    bill: [["Consultation", "150.00"], ["CBC", "120.00"], ["Amoxicillin × 21", "80.00"]],
    paid: "Paid · telebirr",
    reports: ["Reports", "Daily takings and visits, and the monthly MoH report as a spreadsheet."],
    days: ["M", "T", "W", "T", "F", "S", "S"],
    week: "Visits this week",
    moh: "MoH report.csv",
    appts: ["Appointments and audit", "Book visits ahead; every change to a record says who made it, and when."],
    apptRows: [["09:30", "Follow-up · Selam T."], ["10:15", "Antenatal · Hiwot G."]],
    audit: "Audit log",
    auditRow: "Dr. Hana · diagnosis added · 10:42",
  },
  am: {
    queue: ["ወረፋና የመጠበቂያ ክፍል", "ለእያንዳንዱ ክፍል የቀጥታ ወረፋ፣ እና በመጠበቂያ ክፍሉ ቀጣዩን ቁጥር የሚጠራ ቴሌቪዥን።"],
    queueRows: [["12", "ሰላም ት.", "ከዶ/ር ሐና ጋር"], ["13", "ዳዊት ኃ.", "ላብራቶሪ"], ["15", "አበበ ከ.", "በመጠባበቅ ላይ"]],
    nowCalling: "አሁን የሚጠራ",
    room: "ክፍል 2",
    lab: ["ላብራቶሪ", "ትዕዛዞች ላብራቶሪ ይደርሳሉ፤ ውጤቶች ከማጣቀሻ ክልል ጋር ተነጻጽረው ወደ ሐኪሙ ይመለሳሉ።"],
    consult: ["የሐኪም ምርመራ", "ታሪክ፣ አለርጂዎች፣ ቫይታል ሳይንስ፣ ማስታወሻዎች፣ የICD-11 ምርመራዎችና ማዘዣዎች — በየጉብኝቱ።"],
    vitals: ["BP 118/76", "T 36.8 °C", "SpO₂ 98%", "ምት 82"],
    diagnosis: "የሳምባ ምች",
    primary: "ICD-11 · ዋና",
    pharmacy: ["ፋርማሲና ክምችት", "መድኃኒት ከክምችት በባች ይታደላል፤ ክምችት ሲያንስና የማብቂያ ቀን ሲቃረብ ያስጠነቅቃል።"],
    expiry: "ባች B-2207 በ32 ቀናት ጊዜው ያልፋል",
    billing: ["ክፍያ", "የዋጋ ዝርዝር፣ ከአገልግሎት በፊት ክፍያ፣ ደረሰኞች፤ በጥሬ ገንዘብ፣ በቴሌብር፣ በቻፓ ወይም በባንክ ዝውውር።"],
    bill: [["የሐኪም ምርመራ", "150.00"], ["CBC", "120.00"], ["Amoxicillin × 21", "80.00"]],
    paid: "ተከፍሏል · ቴሌብር",
    reports: ["ሪፖርቶች", "የዕለት ገቢና ጉብኝቶች፣ እንዲሁም ወርሃዊው የጤና ሚኒስቴር ሪፖርት እንደ ስፕሬድሺት።"],
    days: ["ሰ", "ማ", "ረ", "ሐ", "ዓ", "ቅ", "እ"],
    week: "የዚህ ሳምንት ጉብኝቶች",
    moh: "MoH report.csv",
    appts: ["ቀጠሮዎችና ኦዲት", "ጉብኝቶችን አስቀድመው ይያዙ፤ በመዝገብ ላይ የሚደረግ እያንዳንዱ ለውጥ ማን እና መቼ እንዳደረገው ያሳያል።"],
    apptRows: [["09:30", "ክትትል · ሰላም ት."], ["10:15", "የቅድመ ወሊድ · ሕይወት ግ."]],
    audit: "የኦዲት መዝገብ",
    auditRow: "ዶ/ር ሐና · ምርመራ ታከለ · 10:42",
  },
} satisfies Record<Lang, unknown>;

/*
 * What HMIS does, as a bento grid: each card shows a fragment of the real screen next to its
 * description. Cards lay themselves out by their own width (container queries), not the page's,
 * so the same card works in a wide row or a narrow column. The fragments are illustrations
 * (aria-hidden); the words carry the meaning.
 */

function Card({ icon: Icon, title, children, visual, className = "" }: { icon: typeof Pill; title: string; children: ReactNode; visual: ReactNode; className?: string }) {
  return (
    <article
      className={`land-lift group @container flex flex-col overflow-hidden rounded-2xl border border-(--l-line) bg-(--l-paper) shadow-(--l-shadow) transition-colors hover:border-(--l-accent)/40 ${className}`}
    >
      <div className="flex h-full flex-col gap-5 p-5 @lg:flex-row @lg:items-center @lg:gap-6 @lg:p-6">
        <div className="@lg:w-[44%] @lg:shrink-0">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-(--l-ink)">
            <Icon aria-hidden className="size-4 text-(--l-accent)" />
            {title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-(--l-muted)">{children}</p>
        </div>
        <div aria-hidden className="mt-auto min-w-0 flex-1 @lg:mt-0">
          {visual}
        </div>
      </div>
    </article>
  );
}

const panel = "rounded-xl border border-(--l-line) bg-(--l-canvas) p-3 text-(--l-ink)";
const mono = "font-mono tabular-nums";

export function Bento({ lang = "en" }: { lang?: Lang }) {
  const t = B[lang];
  return (
    <div className="land-stagger grid gap-4 md:grid-cols-6">
      <Card
        icon={ListOrdered}
        title={t.queue[0]}
        className="md:col-span-6 lg:col-span-4"
        visual={
          <div className="grid gap-2 @sm:grid-cols-[1fr_auto]">
            <div className={`${panel} space-y-1.5`}>
              {t.queueRows.map(([n, who, where]) => (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className={`${mono} w-6 text-(--l-muted)`}>#{n}</span>
                  <span className="flex-1 truncate font-medium">{who}</span>
                  <span className="text-(--l-muted)">{where}</span>
                </div>
              ))}
            </div>
            <div className="flex min-w-36 flex-col items-center justify-center rounded-xl bg-(--l-deep) px-5 py-3 text-white">
              <span className="text-[10px] tracking-[0.18em] text-white/60 uppercase">{t.nowCalling}</span>
              <span className={`${mono} text-3xl font-semibold`}>#14</span>
              <span className="text-[11px] text-white/80">{t.room}</span>
            </div>
          </div>
        }
      >
        {t.queue[1]}
      </Card>

      <Card
        icon={FlaskConical}
        title={t.lab[0]}
        className="md:col-span-3 lg:col-span-2"
        visual={
          <div className={`${panel} space-y-2.5`}>
            {[
              ["Hemoglobin", "13.2", "g/dL", 12, 16, 13.2],
              ["WBC", "11.8", "×10⁹/L", 4, 11, 11.8],
            ].map(([name, value, unit, lo, hi, v]) => {
              const low = Number(lo);
              const high = Number(hi);
              const pos = Math.min(100, Math.max(0, ((Number(v) - (low - 2)) / (high + 2 - (low - 2))) * 100));
              const out = Number(v) > high || Number(v) < low;
              return (
                <div key={String(name)}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium">{name}</span>
                    <span className={`${mono} ${out ? "font-semibold text-(--l-warn)" : ""}`}>
                      {value} <span className="text-(--l-muted)">{unit}</span>
                      {out && " H"}
                    </span>
                  </div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-(--l-line)">
                    <div className="absolute inset-y-0 rounded-full bg-emerald-500/30" style={{ left: "12.5%", right: "12.5%" }} />
                    <div className={`absolute top-1/2 size-2.5 -translate-1/2 rounded-full ring-2 ring-(--l-paper) ${out ? "bg-(--l-warn)" : "bg-(--l-ok)"}`} style={{ left: `${pos}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        }
      >
        {t.lab[1]}
      </Card>

      <Card
        icon={Stethoscope}
        title={t.consult[0]}
        className="md:col-span-3 lg:col-span-2"
        visual={
          <div className={`${panel} space-y-2`}>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {t.vitals.map((v) => (
                <span key={v} className={`${mono} rounded-md bg-(--l-paper) px-1.5 py-0.5 ring-1 ring-(--l-line)`}>
                  {v}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`${mono} rounded bg-(--l-accent-soft) px-1.5 py-0.5 text-[11px] text-(--l-accent)`}>CA40</span>
              <span className="font-medium">{t.diagnosis}</span>
              <span className="ml-auto text-[10px] text-(--l-muted)">{t.primary}</span>
            </div>
          </div>
        }
      >
        {t.consult[1]}
      </Card>

      <Card
        icon={Pill}
        title={t.pharmacy[0]}
        className="md:col-span-3 lg:col-span-2"
        visual={
          <div className={`${panel} space-y-1.5 text-xs`}>
            {[
              ["Amoxicillin 500 mg", "240", "ok"],
              ["Paracetamol 500 mg", "1,120", "ok"],
              ["ORS sachet", "18", "low"],
            ].map(([drug, left, state]) => (
              <div key={drug} className="flex items-center gap-2">
                <span className="flex-1 truncate">{drug}</span>
                <span className={`${mono} ${state === "low" ? "font-semibold text-(--l-warn)" : "text-(--l-muted)"}`}>{left}</span>
              </div>
            ))}
            <p className="pt-1 text-[10px] text-(--l-warn)">{t.expiry}</p>
          </div>
        }
      >
        {t.pharmacy[1]}
      </Card>

      <Card
        icon={Receipt}
        title={t.billing[0]}
        className="md:col-span-3 lg:col-span-2"
        visual={
          <div className={`${panel} text-xs`}>
            {t.bill.map(([item, price]) => (
              <div key={item} className="flex justify-between py-0.5">
                <span>{item}</span>
                <span className={mono}>{price}</span>
              </div>
            ))}
            <div className="mt-1.5 flex justify-between border-t border-dashed border-(--l-line) pt-1.5 font-semibold">
              <span>{t.paid}</span>
              <span className={mono}>350.00 ETB</span>
            </div>
          </div>
        }
      >
        {t.billing[1]}
      </Card>

      <Card
        icon={ChartColumn}
        title={t.reports[0]}
        className="md:col-span-3 lg:col-span-3"
        visual={
          <div className={panel}>
            <div className="flex h-20 items-end gap-1.5">
              {[42, 58, 51, 66, 73, 61, 38].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className={`w-full rounded-t-sm ${i === 4 ? "bg-(--l-accent)" : "bg-(--l-accent)/35"}`} style={{ height: `${h}%` }} />
                  <span className="text-[9px] text-(--l-muted)">{t.days[i]}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-(--l-muted)">{t.week}</span>
              <span className="rounded bg-(--l-paper) px-1.5 py-0.5 font-medium ring-1 ring-(--l-line)">{t.moh}</span>
            </p>
          </div>
        }
      >
        {t.reports[1]}
      </Card>

      <Card
        icon={CalendarDays}
        title={t.appts[0]}
        className="md:col-span-6 lg:col-span-3"
        visual={
          <div className="grid gap-2 @sm:grid-cols-2">
            <div className={`${panel} space-y-1 text-xs`}>
              {t.apptRows.map(([t, what]) => (
                <div key={t} className="flex gap-2">
                  <span className={`${mono} text-(--l-muted)`}>{t}</span>
                  <span className="truncate">{what}</span>
                </div>
              ))}
            </div>
            <div className={`${panel} space-y-1 text-xs`}>
              <div className="flex items-center gap-1.5 font-medium">
                <ScrollText className="size-3.5 text-(--l-accent)" /> {t.audit}
              </div>
              <p className="text-[11px] text-(--l-muted)">{t.auditRow}</p>
            </div>
          </div>
        }
      >
        {t.appts[1]}
      </Card>
    </div>
  );
}
