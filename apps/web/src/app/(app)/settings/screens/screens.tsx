"use client";

import { MonitorPlay } from "lucide-react";
import { useActionState } from "react";
import { Alert, Badge, buttonClass, Card, Field, Input, secondaryButtonClass } from "@/components/ui";
import { addScreen, type PairingState, removeScreen, repairScreen } from "./screen-actions";

export type Screen = { id: string; name: string; paired: boolean; waitingForCode: boolean; lastSeenAt: string | null; revokedAt: string | null };

function PairingCode({ state }: { state: PairingState }) {
  if (!state.code) return null;
  const until = state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" }) : "";
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/50">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        On the TV, open <span className="font-mono">/display</span> on this HMIS address and enter this code (until {until}):
      </p>
      <p className="mt-2 font-mono text-4xl font-bold tracking-[0.3em] text-slate-900 dark:text-white">{state.code}</p>
    </div>
  );
}

export function AddScreen() {
  const [state, action, pending] = useActionState<PairingState, FormData>(addScreen, {});
  return (
    <Card title="Add a screen">
      <form action={action} className="space-y-3">
        {state.error && <Alert>{state.error}</Alert>}
        <Field label="Name">
          <Input name="name" required minLength={2} maxLength={80} placeholder="Waiting room TV" />
        </Field>
        <button disabled={pending} className={buttonClass}>
          Get a pairing code
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
  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <MonitorPlay aria-hidden className="size-5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1 basis-48">
          <p className="font-medium text-slate-900 dark:text-white">{screen.name}</p>
          <p className="text-sm text-slate-500">
            {screen.lastSeenAt
              ? `Last showed the queue ${new Date(screen.lastSeenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })}`
              : "Not connected yet"}
          </p>
        </div>
        <Badge tone={removed ? "neutral" : screen.paired ? "success" : "warning"} dot>
          {removed ? "Removed" : screen.paired ? "Connected" : screen.waitingForCode ? "Waiting for its code" : "Not connected"}
        </Badge>
        <form action={action}>
          <button disabled={pending} className={`${secondaryButtonClass} btn-size`}>
            {removed || !screen.paired ? "New code" : "Connect again"}
          </button>
        </form>
        {!removed && (
          <form action={removeScreen.bind(null, screen.id)}>
            <button className={`${secondaryButtonClass} btn-size`}>Remove</button>
          </form>
        )}
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      <PairingCode state={state} />
    </li>
  );
}
