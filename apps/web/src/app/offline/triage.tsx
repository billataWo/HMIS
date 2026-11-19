"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { useT } from "@/components/lang-provider";
import { Badge, Card, EmptyState } from "@/components/ui";
import { saveNotes } from "@/lib/offline/actions";
import { byPriority, fullName, PatientLine, type TabProps, TriageDot, useBusy, VitalsForm } from "./shared";

/**
 * The nurse's triage offline: vitals, priority, chief complaint and pregnancy for today's patients,
 * as on the visit page. The doctor's PC sees it once this PC has sent it.
 */
export function Triage({ view, userId }: TabProps) {
  const t = useT();
  const open = view.queue.filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED").sort(byPriority);
  const [selected, setSelected] = useState<string | null>(null);
  const visit = open.find((v) => v.id === selected) ?? null;
  const [busy, run] = useBusy();

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <Card title={t("Patients today")}>
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {open.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => setSelected(v.id)}
                aria-current={v.id === selected ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ${v.id === selected ? "bg-brand-50 dark:bg-brand-950/60" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-6 shrink-0 font-mono text-slate-500 tabular-nums">{v.offline ? "·" : v.queueNumber}</span>
                  <TriageDot level={v.triageLevel} />
                  <span className="truncate">{fullName(v.patient)}</span>
                </span>
                {v.triageLevel ? <StatusBadge status={v.status} lang={t.lang} /> : <Badge tone="warning">{t("To triage")}</Badge>}
              </button>
            </li>
          ))}
          {!open.length && <li className="py-3 text-sm text-slate-500">{t("No open visits on this PC.")}</li>}
        </ul>
      </Card>
      {visit ? (
        <Card key={visit.id} title={<PatientLine p={visit.patient} />}>
          <VitalsForm
            visit={visit}
            detail={view.snap.visits[visit.id]}
            local={view.notes[visit.id] ?? {}}
            mode="nurse"
            busy={busy}
            onSave={(fields) => run(() => saveNotes(userId, visit, fields, true))}
          />
        </Card>
      ) : (
        <EmptyState title={t("Choose a patient")} />
      )}
    </div>
  );
}
