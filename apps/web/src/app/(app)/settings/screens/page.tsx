import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Card, EmptyState, Notice, Skeleton } from "@/components/ui";
import { api, ApiError, type Me } from "@/lib/api";
import { getT } from "@/lib/lang";
import { BackToSettings } from "../back-to-settings";
import { AddScreen, type Screen, ScreenRow } from "./screens";

async function Content() {
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (me.role !== "ADMIN") return <p className="text-sm text-slate-500">{t("Only clinic admins manage screens.")}</p>;
  let screens: Screen[];
  try {
    screens = await api<Screen[]>("/displays");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only clinic admins manage screens.")}</p>;
    throw e;
  }
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Notice tone="info">
          {t(
            "A screen has its own key that can only show the queue board (numbers and doctors). It is never signed in as a staff member, so nobody at the TV can open patients or bills. Removing it, or connecting it again, stops the old key at once.",
          )}
        </Notice>
        {screens.length ? (
          <Card title={t("Screens")}>
            <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
              {screens.map((s) => (
                <ScreenRow key={s.id} screen={s} />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title={t("No screens yet")}>{t("Add the waiting-room TV here, then enter its code on the TV.")}</EmptyState>
        )}
      </div>
      <AddScreen />
    </div>
  );
}

export default function ScreensPage() {
  return (
    <>
      <PageTitle title="Screens" subtitle="waiting-room queue displays" actions={<BackToSettings />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}
