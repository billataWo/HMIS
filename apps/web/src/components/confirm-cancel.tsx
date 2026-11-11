"use client";

import { useEffect, useRef, useState } from "react";

const quiet = "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";

/**
 * A destructive action on a saved record (cancel a visit, an appointment, a lab order...) asks
 * once, in place: no dialog to dismiss, nothing to tap by mistake in a busy screen. Escape or
 * "Keep" backs out. Give it a server action (`action`, submitted as a form) or a handler
 * (`onConfirm`, for panels that track their own pending state).
 */
export function ConfirmCancel({
  action,
  onConfirm,
  disabled,
  label = "Cancel",
  question = "Cancel this?",
  yes = "Yes, cancel",
  no = "Keep",
}: {
  action?: () => void | Promise<void>;
  onConfirm?: () => void;
  disabled?: boolean;
  label?: string;
  question?: string;
  yes?: string;
  no?: string;
}) {
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        className={`${quiet} text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:text-red-300 dark:hover:bg-red-950/50`}
      >
        {label}
      </button>
    );
  }
  const yesButton = (
    <button
      type={action ? "submit" : "button"}
      disabled={disabled}
      onClick={
        onConfirm
          ? () => {
              setAsking(false);
              onConfirm();
            }
          : undefined
      }
      className={`${quiet} bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600`}
    >
      {yes}
    </button>
  );
  const body = (
    <>
      <span className="font-medium text-red-800 dark:text-red-200">{question}</span>
      {yesButton}
      <button ref={keep} type="button" onClick={() => setAsking(false)} className={`${quiet} text-slate-700 hover:bg-white focus-visible:outline-brand-600 dark:text-slate-200 dark:hover:bg-slate-800`}>
        {no}
      </button>
    </>
  );
  const box = "inline-flex flex-wrap items-center gap-2 rounded-lg bg-red-50 py-1 pr-1 pl-3 text-xs dark:bg-red-950/50";
  const escape = (e: React.KeyboardEvent) => e.key === "Escape" && setAsking(false);
  return action ? (
    <form action={action} onKeyDown={escape} className={box} role="group" aria-label={question}>
      {body}
    </form>
  ) : (
    <div onKeyDown={escape} className={box} role="group" aria-label={question}>
      {body}
    </div>
  );
}
