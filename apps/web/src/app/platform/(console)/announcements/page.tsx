import { Megaphone } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, type BadgeTone, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { type Announcement, type AnnouncementState, type ClinicRow, platformApi } from "@/lib/platform";
import { AnnouncementForm, AnnouncementPreview, WithdrawAnnouncement } from "../../followup-forms";
import { dateTime } from "../bits";

export const metadata: Metadata = { title: "Announcements" };

const STATE: Record<AnnouncementState, { label: string; tone: BadgeTone }> = {
  live: { label: "Showing now", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

function Row({ a }: { a: Announcement }) {
  const s = STATE[a.state];
  const current = a.state === "live" || a.state === "scheduled";
  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
          <span className="font-medium text-slate-700 dark:text-slate-200">{a.clinic ?? "Every clinic"}</span>
        </div>
        {current && <WithdrawAnnouncement id={a.id} />}
      </div>
      <div className={current ? "" : "opacity-70"}>
        <AnnouncementPreview tone={a.tone} title={a.title} body={a.body ?? ""} />
      </div>
      {(a.titleAm || a.bodyAm) && (
        <p lang="am" className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium">{a.titleAm}</span>
          {a.bodyAm ? ` · ${a.bodyAm}` : ""}
        </p>
      )}
      <p className="text-xs text-slate-500">
        From {dateTime(a.startsAt)}
        {a.endsAt ? ` until ${dateTime(a.endsAt)}` : ", no end"}
        {a.createdBy ? ` · by ${a.createdBy}` : ""}
        {a.withdrawnAt ? ` · withdrawn ${dateTime(a.withdrawnAt)}${a.withdrawnBy ? ` by ${a.withdrawnBy}` : ""}` : ""}
      </p>
    </li>
  );
}

async function Content() {
  const [list, clinics] = await Promise.all([platformApi<Announcement[]>("/platform/announcements"), platformApi<ClinicRow[]>("/platform/clinics")]);
  const current = list.filter((a) => a.state === "live" || a.state === "scheduled");
  const past = list.filter((a) => !current.includes(a));
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_26rem]">
      <div className="space-y-6">
        <Card title="Showing or scheduled" description="Clinic staff see these at the top of every page, in Amharic when there is an Amharic version.">
          {current.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {current.map((a) => (
                <Row key={a.id} a={a} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Megaphone} title="Nothing is showing">
              Tell clinics about maintenance, a new feature or a price change.
            </EmptyState>
          )}
        </Card>
        {past.length > 0 && (
          <Card title="Earlier">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {past.map((a) => (
                <Row key={a.id} a={a} />
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Card title="New announcement">
        <AnnouncementForm clinics={clinics.filter((c) => c.subscription?.state !== "cancelled").map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))} />
      </Card>
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <>
      <PageHeader title="Announcements" subtitle="Messages from HMIS at the top of the clinic app: planned maintenance, new features, price changes." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
