import { CalendarDays, ChartColumn, FlaskConical, ListOrdered, Pill, Receipt, ScrollText, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";

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

export function Bento() {
  return (
    <div className="land-stagger grid gap-4 md:grid-cols-6">
      <Card
        icon={ListOrdered}
        title="Queue and waiting room"
        className="md:col-span-6 lg:col-span-4"
        visual={
          <div className="grid gap-2 @sm:grid-cols-[1fr_auto]">
            <div className={`${panel} space-y-1.5`}>
              {[
                ["12", "Selam T.", "With Dr. Hana"],
                ["13", "Dawit H.", "At the lab"],
                ["15", "Abebe K.", "Waiting"],
              ].map(([n, who, where]) => (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className={`${mono} w-6 text-(--l-muted)`}>#{n}</span>
                  <span className="flex-1 truncate font-medium">{who}</span>
                  <span className="text-(--l-muted)">{where}</span>
                </div>
              ))}
            </div>
            <div className="flex min-w-36 flex-col items-center justify-center rounded-xl bg-(--l-deep) px-5 py-3 text-white">
              <span className="text-[10px] tracking-[0.18em] text-white/60 uppercase">Now calling</span>
              <span className={`${mono} text-3xl font-semibold`}>#14</span>
              <span className="text-[11px] text-white/80">Room 2</span>
            </div>
          </div>
        }
      >
        Live queue for each department, and a TV in the waiting room that calls the next number.
      </Card>

      <Card
        icon={FlaskConical}
        title="Laboratory"
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
        Orders reach the bench; results are checked against reference ranges and go back to the doctor.
      </Card>

      <Card
        icon={Stethoscope}
        title="Consultation"
        className="md:col-span-3 lg:col-span-2"
        visual={
          <div className={`${panel} space-y-2`}>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {["BP 118/76", "T 36.8 °C", "SpO₂ 98%", "Pulse 82"].map((v) => (
                <span key={v} className={`${mono} rounded-md bg-(--l-paper) px-1.5 py-0.5 ring-1 ring-(--l-line)`}>
                  {v}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`${mono} rounded bg-(--l-accent-soft) px-1.5 py-0.5 text-[11px] text-(--l-accent)`}>CA40</span>
              <span className="font-medium">Pneumonia</span>
              <span className="ml-auto text-[10px] text-(--l-muted)">ICD-11 · primary</span>
            </div>
          </div>
        }
      >
        History, allergies, vitals, notes, ICD-11 diagnoses and prescriptions, per visit.
      </Card>

      <Card
        icon={Pill}
        title="Pharmacy and stock"
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
            <p className="pt-1 text-[10px] text-(--l-warn)">Batch B-2207 expires in 32 days</p>
          </div>
        }
      >
        Dispensing from stock by batch, with low-stock and expiry warnings.
      </Card>

      <Card
        icon={Receipt}
        title="Billing"
        className="md:col-span-3 lg:col-span-2"
        visual={
          <div className={`${panel} text-xs`}>
            {[
              ["Consultation", "150.00"],
              ["CBC", "120.00"],
              ["Amoxicillin × 21", "80.00"],
            ].map(([item, price]) => (
              <div key={item} className="flex justify-between py-0.5">
                <span>{item}</span>
                <span className={mono}>{price}</span>
              </div>
            ))}
            <div className="mt-1.5 flex justify-between border-t border-dashed border-(--l-line) pt-1.5 font-semibold">
              <span>Paid · telebirr</span>
              <span className={mono}>350.00 ETB</span>
            </div>
          </div>
        }
      >
        Price list, pay-before-service, receipts; cash, telebirr, Chapa or bank transfer.
      </Card>

      <Card
        icon={ChartColumn}
        title="Reports"
        className="md:col-span-3 lg:col-span-3"
        visual={
          <div className={panel}>
            <div className="flex h-20 items-end gap-1.5">
              {[42, 58, 51, 66, 73, 61, 38].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className={`w-full rounded-t-sm ${i === 4 ? "bg-(--l-accent)" : "bg-(--l-accent)/35"}`} style={{ height: `${h}%` }} />
                  <span className="text-[9px] text-(--l-muted)">{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-(--l-muted)">Visits this week</span>
              <span className="rounded bg-(--l-paper) px-1.5 py-0.5 font-medium ring-1 ring-(--l-line)">MoH report.csv</span>
            </p>
          </div>
        }
      >
        Daily takings and visits, and the monthly MoH report as a spreadsheet.
      </Card>

      <Card
        icon={CalendarDays}
        title="Appointments and audit"
        className="md:col-span-6 lg:col-span-3"
        visual={
          <div className="grid gap-2 @sm:grid-cols-2">
            <div className={`${panel} space-y-1 text-xs`}>
              {[
                ["09:30", "Follow-up · Selam T."],
                ["10:15", "Antenatal · Hiwot G."],
              ].map(([t, what]) => (
                <div key={t} className="flex gap-2">
                  <span className={`${mono} text-(--l-muted)`}>{t}</span>
                  <span className="truncate">{what}</span>
                </div>
              ))}
            </div>
            <div className={`${panel} space-y-1 text-xs`}>
              <div className="flex items-center gap-1.5 font-medium">
                <ScrollText className="size-3.5 text-(--l-accent)" /> Audit log
              </div>
              <p className="text-[11px] text-(--l-muted)">Dr. Hana · diagnosis added · 10:42</p>
            </div>
          </div>
        }
      >
        Book visits ahead; every change to a record says who made it, and when.
      </Card>
    </div>
  );
}
