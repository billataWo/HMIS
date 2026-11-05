import { Alert } from "./ui";

/** Success or error banner driven by ?checkedIn=, ?booked=, ?done= or ?error= after a one-click action. */
export function Flash({ params }: { params: { error?: string; checkedIn?: string; booked?: string; done?: string } }) {
  if (params.error) return <div className="mb-4"><Alert>{params.error}</Alert></div>;
  const ok = params.checkedIn
    ? `Checked in. Queue number ${params.checkedIn}.`
    : params.booked
      ? "Appointment booked."
      : (params.done ?? null);
  if (!ok) return null;
  return (
    <div role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      {ok}
    </div>
  );
}
