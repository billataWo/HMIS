import { Search, UserPlus, Users } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, EmptyState, inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Me, type Patient } from "@/lib/api";
import { canRegister } from "@/lib/roles";
import { ageText, formatDualDate, fullName } from "@/lib/format";

async function Results({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? "";
  const [patients, me] = await Promise.all([api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`), api<Me>("/auth/me")]);

  return (
    <>
      <Form action="/patients" className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={q}
            autoFocus
            aria-label="Search patients"
            placeholder="Search by name, phone or MRN · በስም፣ በስልክ ወይም በካርድ ቁጥር"
            className={`${inputClass} h-11 pl-9`}
          />
        </div>
        <button className={`${secondaryButtonClass} h-11`}>Search</button>
      </Form>

      {patients.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q ? `No patient matches “${q}”` : "No patients registered yet"}
          action={
            canRegister(me) ? (
              <Link href="/patients/new" className={buttonClass}>
                <UserPlus aria-hidden />
                Register a new patient
              </Link>
            ) : undefined
          }
        >
          {!canRegister(me) && "New patients are registered at reception."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3 font-medium">MRN</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Sex / age</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const age = ageText(p.dateOfBirth, true);
                return (
                  <tr key={p.id} className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/patients/${p.id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                        {p.mrn}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/patients/${p.id}`} className="hover:underline">
                        {fullName(p)}
                      </Link>
                      {p.firstNameAm && (
                        <span className="block text-xs text-slate-500">
                          {[p.firstNameAm, p.fatherNameAm].filter(Boolean).join(" ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.sex === "MALE" ? "M" : "F"}
                      {age !== null && ` · ${age}`}
                    </td>
                    <td className="px-4 py-3">{p.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDualDate(p.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function RegisterButton() {
  const me = await api<Me>("/auth/me");
  if (!canRegister(me)) return null;
  return (
    <Link href="/patients/new" className={buttonClass}>
      <UserPlus aria-hidden />
      Register patient
    </Link>
  );
}

export default function PatientsPage({ searchParams }: PageProps<"/patients">) {
  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="ታካሚዎች"
        actions={
          <Suspense fallback={null}>
            <RegisterButton />
          </Suspense>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Results searchParams={searchParams as Promise<{ q?: string }>} />
      </Suspense>
    </>
  );
}
