import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { inputClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Me, type StaffUser } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { getT } from "@/lib/lang";
import { resetUserTwoStep } from "../../two-step-actions";
import { setUserActive, setUserRoom } from "../../actions";
import { UserForm } from "./user-form";

async function Staff() {
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (me.role !== "ADMIN") {
    return <p className="text-sm text-slate-500">{t("Only clinic admins can manage staff accounts.")}</p>;
  }

  let users: StaffUser[];
  try {
    users = await api<StaffUser[]>("/users");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only clinic admins can manage staff accounts.")}</p>;
    throw e;
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="overflow-x-auto surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
            <tr>
              <th className="px-4 py-3 font-medium">{t("Name")}</th>
              <th className="px-4 py-3 font-medium">{t("Role")}</th>
              <th className="px-4 py-3 font-medium">{t("Phone")}</th>
              <th className="px-4 py-3 font-medium">{t("Room")}</th>
              <th className="px-4 py-3 font-medium">{t("Two-step")}</th>
              <th className="px-4 py-3 font-medium">{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-slate-200 dark:border-slate-800 ${u.active ? "" : "text-slate-500"}`}>
                <td className="px-4 py-3">{u.fullName}</td>
                <td className="px-4 py-3">{t(ROLE_LABELS[u.role] ?? u.role)}</td>
                <td className="px-4 py-3">{u.phone}</td>
                <td className="px-4 py-2">
                  {/* Where they see patients: the waiting-room screen shows it when they call someone in. */}
                  <form action={setUserRoom.bind(null, u.id)} className="flex items-center gap-1">
                    <input
                      name="room"
                      defaultValue={u.room ?? ""}
                      maxLength={40}
                      placeholder={u.role === "DOCTOR" ? t("Room 2") : "—"}
                      aria-label={t("Room for {name}", { name: u.fullName })}
                      className={`${inputClass} w-24 px-2 py-1 text-sm`}
                    />
                    <button className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950">{t("Save")}</button>
                  </form>
                </td>
                <td className="px-4 py-3">
                  {u.totpEnabledAt ? (
                    u.id === me.id ? (
                      <span className="text-emerald-700 dark:text-emerald-400">{t("On")}</span>
                    ) : (
                      // For a lost phone: they sign in with their password and set it up again.
                      <form action={resetUserTwoStep.bind(null, u.id)}>
                        <span className="text-emerald-700 dark:text-emerald-400">{t("On")}</span> ·{" "}
                        <button className="text-brand-700 hover:underline dark:text-brand-400" title={t("Lost phone: they set it up again at their next sign-in")}>
                          {t("Reset")}
                        </button>
                      </form>
                    )
                  ) : (
                    <span className={u.role === "ADMIN" ? "text-amber-700 dark:text-amber-400" : "text-slate-500"}>{t(u.role === "ADMIN" ? "Not set up yet" : "Off")}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.id === me.id ? (
                    <span className="text-slate-500">{t("You")}</span>
                  ) : (
                    <form action={setUserActive.bind(null, u.id, !u.active)}>
                      <button className="text-brand-700 hover:underline dark:text-brand-400">
                        {t(u.active ? "Deactivate" : "Reactivate")}
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
        <h2 className="mb-3 font-medium">{t("Add staff member")}</h2>
        <UserForm />
      </section>
    </div>
  );
}

export default function UsersPage() {
  return (
    <>
      <PageTitle title="Staff" subtitle="accounts and roles" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Staff />
      </Suspense>
    </>
  );
}
