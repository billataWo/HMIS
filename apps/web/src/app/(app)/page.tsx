import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Today } from "./today";

const modules = [
  { name: "Patients", nameAm: "ታካሚዎች", desc: "Registration, MRN, search by phone", href: "/patients" },
  { name: "Queue", nameAm: "ወረፋ", desc: "Check-in, queue numbers, waiting-room display", href: "/queue" },
  { name: "Appointments", nameAm: "ቀጠሮዎች", desc: "Bookings, check-in on arrival, no-shows", href: "/appointments" },
  { name: "Consultation (EMR)", nameAm: "ምርመራ", desc: "Vitals, notes, ICD-11 diagnoses. Open a patient from the queue", href: "/queue" },
  { name: "Lab", nameAm: "ላብራቶሪ", desc: "Samples, results with normal ranges, printable reports", href: "/lab" },
  { name: "Pharmacy", nameAm: "ፋርማሲ", desc: "Prescriptions to dispense, first-expiry-first-out", href: "/pharmacy" },
  { name: "Billing", nameAm: "ክፍያ", desc: "Invoices, Telebirr, Chapa, receipts, cash closing", href: "/billing" },
  { name: "Reports", nameAm: "ሪፖርቶች", desc: "Revenue, patient counts, stock losses, monthly MoH report", href: "/reports" },
];

export default function Home() {
  return (
    <>
      <PageHeader title="Home" actions={<Today />} />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const card = (
            <>
              <h2 className="font-medium">{m.name}</h2>
              <p className="text-sm text-zinc-500">{m.nameAm}</p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{m.desc}</p>
              {!m.href && <p className="mt-2 text-xs text-zinc-400">Coming next</p>}
            </>
          );
          return m.href ? (
            <Link key={m.name} href={m.href} className="rounded-lg border border-zinc-200 p-4 hover:border-teal-600 dark:border-zinc-800">
              {card}
            </Link>
          ) : (
            <div key={m.name} className="rounded-lg border border-dashed border-zinc-200 p-4 opacity-70 dark:border-zinc-800">
              {card}
            </div>
          );
        })}
      </section>
    </>
  );
}
