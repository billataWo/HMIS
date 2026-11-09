"use client";

import { useActionState, useRef } from "react";
import { Alert, buttonClass, Field, inputClass, Notice } from "@/components/ui";
import { installLicence, type TransferState } from "./actions";

/** Installs a licence file from HMIS: choose the file, or paste its text. */
export function LicenceForm() {
  const [state, action, pending] = useActionState<TransferState, FormData>(installLicence, {});
  const text = useRef<HTMLTextAreaElement>(null);
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.done && <Notice tone="success">The licence is installed.</Notice>}
      <Field label="Licence file from HMIS">
        <input
          type="file"
          accept=".txt,text/plain"
          className="block text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file && text.current) text.current.value = (await file.text()).trim();
          }}
        />
      </Field>
      <Field label="Or paste it" hint="It starts with HMIS-LICENCE-1.">
        <textarea ref={text} name="licence" required rows={3} spellCheck={false} className={`${inputClass} font-mono text-xs`} />
      </Field>
      <button disabled={pending} className={buttonClass}>
        {pending ? "Checking…" : "Install the licence"}
      </button>
    </form>
  );
}
