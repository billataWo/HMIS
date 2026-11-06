"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Reveal } from "./motion";
import { Notice } from "./ui";

type Params = { error?: string; checkedIn?: string; booked?: string; done?: string };

/** Success or error banner driven by ?checkedIn=, ?booked=, ?done= or ?error= after a one-click action. */
export function Flash({ params }: { params: Params }) {
  const message = params.error
    ? params.error
    : params.checkedIn
      ? `Checked in. Queue number ${params.checkedIn}.`
      : params.booked
        ? "Appointment booked."
        : (params.done ?? null);
  // Keyed by the message so a new action's banner reappears after an earlier one was dismissed.
  return message ? <Banner key={message} error={!!params.error} message={message} /> : null;
}

function Banner({ error, message }: { error: boolean; message: string }) {
  const [open, setOpen] = useState(true);
  return (
    <Reveal show={open} appear className="mb-4">
      <Notice tone={error ? "danger" : "success"}>
        <div className="flex items-start justify-between gap-3">
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Dismiss"
            className="-m-1 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      </Notice>
    </Reveal>
  );
}
