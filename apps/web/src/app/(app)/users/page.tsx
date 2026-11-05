import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type Me, type StaffUser } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { setUserActive } from "../../actions";
import { UserForm } from "./user-form";

async function Staff() {
  const me = await api<Me>("/auth/me");
  if (me.role !== "ADMIN") {
    return <p className="text-sm text-zinc-500">Only clinic admins can manage staff accounts.</p>;
  }

  let users: StaffUser[];
  try {
    users = await api<StaffUser[]>("/users");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only clinic admins can manage staff accounts.</p>;
    throw e;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-zinc-200 dark:border-zinc-800 ${u.active ? "" : "text-zinc-400"}`}>
                <td className="px-3 py-2">{u.fullName}</td>
                <td className="px-3 py-2">{ROLE_LABELS[u.role]}</td>
                <td className="px-3 py-2">{u.phone}</td>
                <td className="px-3 py-2">
                  {u.id === me.id ? (
                    <span className="text-zinc-500">You</span>
                  ) : (
                    <form action={setUserActive.bind(null, u.id, !u.active)}>
                      <button className="text-teal-700 hover:underline dark:text-teal-400">
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
