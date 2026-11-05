import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, inputClass, PageHeader, Skeleton } from "@/components/ui";
import { api, type Patient } from "@/lib/api";
import { ageFrom, formatDualDate, fullName } from "@/lib/format";

async function Results({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? "";
  const patients = await api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`);

  return (
    <>
      <Form action="/patients" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Search by name, phone or MRN · በስም፣ በስልክ ወይም በካርድ ቁጥር"
          className={inputClass}
        />
        <button className={buttonClass}>Search</button>
      </Form>

      {patients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {q ? (
            <>
              No patient matches “{q}”.{" "}
              <Link href="/patients/new" className="text-teal-700 underline dark:text-teal-400">
                Register a new patient
              </Link>
            </>
          ) : (
            "No patients registered yet."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">MRN</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Sex / age</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const age = ageFrom(p.dateOfBirth);
                return (
                  <tr key={p.id} className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/patients/${p.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                        {p.mrn}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/patients/${p.id}`} className="hover:underline">
                        {fullName(p)}
                      </Link>
                      {p.firstNameAm && (
                        <span className="block text-xs text-zinc-500">
                          {[p.firstNameAm, p.fatherNameAm].filter(Boolean).join(" ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.sex === "MALE" ? "M" : "F"}
                      {age !== null && ` · ${age}y`}
                    </td>
                    <td className="px-3 py-2">{p.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-500">{formatDualDate(p.createdAt)}</td>
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

export default function PatientsPage({ searchParams }: PageProps<"/patients">) {
  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="ታካሚዎች"
        actions={
          <Link href="/patients/new" className={buttonClass}>
            Register patient
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Results searchParams={searchParams as Promise<{ q?: string }>} />
      </Suspense>
    </>
  );
}
