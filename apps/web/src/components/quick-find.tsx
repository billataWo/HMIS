"use client";

import { CornerDownLeft, LoaderCircle, Search, TriangleAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { findPatients, type FoundPatient } from "@/app/actions";
import { useT } from "./lang-provider";

/** Ctrl+K / Cmd+K anywhere, or "/" when not typing in a field. */
const isShortcut = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") return true;
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  return e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
};

const OPEN_EVENT = "hmis:quick-find";

/** A button that opens quick find (there can be several: sidebar, phone top bar). */
export function QuickFindButton({ variant }: { variant: "sidebar" | "icon" }) {
  const open = () => window.dispatchEvent(new Event(OPEN_EVENT));
  const t = useT();
  return variant === "sidebar" ? (
    <button
      type="button"
      onClick={open}
      className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-xs transition-colors hover:border-slate-300 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
    >
      <Search aria-hidden className="size-4" />
      {t("Find a patient")}
      <kbd className="ml-auto rounded border border-slate-200 px-1.5 font-sans text-[11px] text-slate-500 dark:border-slate-700">Ctrl K</kbd>
    </button>
  ) : (
    <button
      type="button"
      onClick={open}
      aria-label={t("Find a patient")}
      className="grid size-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Search aria-hidden className="size-5" />
    </button>
  );
}

/**
 * Find a patient from any screen: by name, phone or MRN. Arrow keys move, Enter opens the record;
 * the front desk can check the patient in from here. A native <dialog>: focus stays inside,
 * Escape closes it, and focus returns to where it was.
 */
/** Rendered once per page (in the app menu); QuickFindButton and the shortcuts open it. */
export function QuickFind({ frontDesk, canRegister }: { frontDesk: boolean; canRegister: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoundPatient[]>([]);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState("");
  const [pending, start] = useTransition();
  const t = useT();

  const open = useCallback(() => {
    if (dialog.current?.open) return;
    dialog.current?.showModal();
    input.current?.select();
  }, []);
  const close = () => dialog.current?.close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, [open]);

  // Search as the person types, a moment after they pause.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const timer = setTimeout(() => {
      start(async () => {
        const r = await findPatients(term);
        setFailed(!r.ok);
        setResults(r.ok ? r.patients : []);
        setActive(0);
        setSearched(term);
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  const shown = q.trim().length < 2 ? [] : results;
  const go = (href: string) => {
    close();
    router.push(href);
  };
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shown.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = shown[active];
      if (p) go(e.altKey && frontDesk ? `/queue?find=${encodeURIComponent(p.mrn)}` : `/patients/${p.id}`);
    }
  };

  return (
    <>
      <dialog
        ref={dialog}
        aria-label={t("Find a patient")}
        onClose={() => setQ("")}
        onClick={(e) => e.target === dialog.current && close()}
        className="m-0 mx-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-overlay backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px] open:animate-[enter_160ms_ease-out] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
          {pending ? <LoaderCircle aria-hidden className="size-5 animate-spin text-slate-500" /> : <Search aria-hidden className="size-5 text-slate-500" />}
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("Name, phone or MRN")}
            aria-label={t("Name, phone or MRN")}
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-500 dark:border-slate-700">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {shown.length > 0 ? (
            <ul id={listId} role="listbox" aria-label={t("Patients")} className="p-2">
              {shown.map((p, i) => (
                <li
                  key={p.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${i === active ? "bg-brand-50 dark:bg-brand-950/60" : ""}`}
                >
                  <button type="button" onClick={() => go(`/patients/${p.id}`)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {p.mrn} · {t(p.sex === "MALE" ? "M" : "F")}
                      {p.age !== null && ` · ${t("{n}y", { n: p.age })}`}
                      {p.phone && ` · ${p.phone}`}
                    </span>
                    {p.allergies.length > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300">
                        <TriangleAlert aria-hidden className="size-3" />
                        {t("Allergies: {list}", { list: p.allergies.join(", ") })}
                      </span>
                    )}
                  </button>
                  {frontDesk && (
                    <button
                      type="button"
                      onClick={() => go(`/queue?find=${encodeURIComponent(p.mrn)}`)}
                      className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-brand-600/25 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
                    >
                      {t("Check in")}
                    </button>
                  )}
                  {i === active && <CornerDownLeft aria-hidden className="hidden size-4 shrink-0 text-slate-400 sm:block" />}
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-slate-500" aria-live="polite">
              {failed ? (
                t("Can't search right now. Check the connection and try again.")
              ) : q.trim().length < 2 ? (
                t("Type at least two letters or digits of a name, phone number or MRN.")
              ) : pending || searched !== q.trim() ? (
                t("Searching…")
              ) : (
                <>
                  {t("No patient matches “{q}”.", { q: q.trim() })}
                  {canRegister && (
                    <Link href="/patients/new" onClick={close} className="mt-3 flex items-center justify-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300">
                      <UserPlus aria-hidden className="size-4" />
                      {t("Register a new patient")}
                    </Link>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <p className="hidden gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 sm:flex dark:border-slate-800 dark:bg-slate-950/60">
          <span>
            <kbd className="font-sans">↑ ↓</kbd> {t("move")}
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> {t("open the record")}
          </span>
          {frontDesk && (
            <span>
              <kbd className="font-sans">Alt Enter</kbd> {t("check in")}
            </span>
          )}
        </p>
      </dialog>
    </>
  );
}
