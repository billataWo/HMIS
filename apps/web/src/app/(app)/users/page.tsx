import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type Me, type StaffUser } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { resetUserTwoStep } from "../../two-step-actions";
import { setUserActive } from "../../actions";
import { UserForm } from "./user-form";

async function Staff() {
  const me = await api<Me>("/auth/me");
  if (me.role !== "ADMIN") {
    return <p className="text-sm text-slate-500">Only clinic admins can manage staff accounts.</p>;
  }

  let users: StaffUser[];
  try {
    users = await api<StaffUser[]>("/users");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins can manage staff accounts.</p>;
    throw e;
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="overflow-x-auto surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Two-step</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-slate-200 dark:border-slate-800 ${u.active ? "" : "text-slate-500"}`}>
                <td className="px-4 py-3">{u.fullName}</td>
                <td className="px-4 py-3">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-3">{u.phone}</td>
                <td className="px-4 py-3">
                  {u.totpEnabledAt ? (
                    u.id === me.id ? (
                      <span className="text-emerald-700 dark:text-emerald-400">On</span>
                    ) : (
                      // For a lost phone: they sign in with their password and set it up again.
                      <form action={resetUserTwoStep.bind(null, u.id)}>
                        <span className="text-emerald-700 dark:text-emerald-400">On</span> ·{" "}
                        <button className="text-brand-700 hover:underline dark:text-brand-400" title="Lost phone: they set it up again at their next sign-in">
                          Reset
                        </button>
                      </form>
                    )
                  ) : (
                    <span className={u.role === "ADMIN" ? "text-amber-700 dark:text-amber-400" : "text-slate-500"}>{u.role === "ADMIN" ? "Not set up yet" : "Off"}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.id === me.id ? (
                    <span className="text-slate-500">You</span>
                  ) : (
                    <form action={setUserActive.bind(null, u.id, !u.active)}>
                      <button className="text-brand-700 hover:underline dark:text-brand-400">
                        {u.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section>
        <h2 className="mb-3 font-medium">Add staff member</h2>
        <UserForm />
      </section>
    </div>
  );
}

export default function UsersPage() {
  return (
    <>
      <PageHeader title="Staff" subtitle="ሰራተኞች · accounts and roles" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Staff />
      </Suspense>
    </>
  );
}
