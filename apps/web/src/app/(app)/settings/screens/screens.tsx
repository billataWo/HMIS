"use client";

import { MonitorPlay } from "lucide-react";
import { useActionState } from "react";
import { Alert, Badge, buttonClass, Card, Field, Input, secondaryButtonClass } from "@/components/ui";
import { addScreen, type PairingState, removeScreen, repairScreen } from "./screen-actions";
import { ConfirmCancel } from "@/components/confirm-cancel";
import { useT } from "@/components/lang-provider";

export type Screen = { id: string; name: string; paired: boolean; waitingForCode: boolean; lastSeenAt: string | null; revokedAt: string | null };

function PairingCode({ state }: { state: PairingState }) {
  const t = useT();
  if (!state.code) return null;
  const until = state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" }) : "";
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/50">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t.rich("On the TV, open {path} on this HMIS address and enter this code (until {time}):", {
          path: <span className="font-mono">/display</span>,
          time: until,
        })}
      </p>
      <p className="mt-2 font-mono text-4xl font-bold tracking-[0.3em] text-slate-900 dark:text-white">{state.code}</p>
    </div>
  );
}

export function AddScreen() {
  const [state, action, pending] = useActionState<PairingState, FormData>(addScreen, {});
  const t = useT();
  return (
    <Card title={t("Add a screen")}>
      <form action={action} className="space-y-3">
        {state.error && <Alert>{t(state.error)}</Alert>}
        <Field label={t("Name")}>
          <Input name="name" required minLength={2} maxLength={80} placeholder={t("Waiting room TV")} />
        </Field>
        <button disabled={pending} className={buttonClass}>
          {t("Get a pairing code")}
        </button>
      </form>
      <div className="mt-4">
        <PairingCode state={state} />
      </div>
    </Card>
  );
}

export function ScreenRow({ screen }: { screen: Screen }) {
  const [state, action, pending] = useActionState<PairingState>(repairScreen.bind(null, screen.id), {});
  const removed = !!screen.revokedAt;
  const t = useT();
  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <MonitorPlay aria-hidden className="size-5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1 basis-48">
          <p className="font-medium text-slate-900 dark:text-white">{screen.name}</p>
          <p className="text-sm text-slate-500">
            {screen.lastSeenAt
              ? t("Last showed the queue {when}", {
                  when: new Date(screen.lastSeenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" }),
                })
              : t("Not connected yet")}
          </p>
        </div>
        <Badge tone={removed ? "neutral" : screen.paired ? "success" : "warning"} dot>
          {t(removed ? "Screen removed" : screen.paired ? "Connected" : screen.waitingForCode ? "Waiting for its code" : "Not connected")}
        </Badge>
        <form action={action}>
          <button disabled={pending} className={`${secondaryButtonClass} btn-size`}>
            {t(removed || !screen.paired ? "New code" : "Connect again")}
          </button>
        </form>
        {!removed && (
          <ConfirmCancel action={removeScreen.bind(null, screen.id)} label={t("Remove")} question={t("Remove this screen? It stops showing the queue.")} yes={t("Yes, remove")} />
        )}
      </div>
      {state.error && <Alert>{t(state.error)}</Alert>}
      <PairingCode state={state} />
    </li>
  );
}
