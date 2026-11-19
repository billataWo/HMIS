"use client";

import { Building2, FileText, Inbox, Loader2, Receipt, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { SearchResults } from "@/lib/platform";
import { platformSearch } from "../actions";

type Hit = { key: string; href: string; icon: typeof Search; title: string; detail: string; group: string };

const STATE: Record<string, string> = { trial: "trial", active: "active", overdue: "overdue", suspended: "suspended", cancelled: "cancelled" };

function hits(r: SearchResults): Hit[] {
  return [
    ...r.clinics.map((c) => ({
      key: `c${c.id}`,
      href: `/platform/clinics/${c.id}`,
      icon: Building2,
      title: c.name,
      detail: [c.nameAm, c.address, c.state ? STATE[c.state] : "not billed"].filter(Boolean).join(" · "),
      group: "Clinics",
    })),
    ...r.invoices.map((i) => ({ key: `i${i.id}`, href: `/platform/invoice/${i.id}`, icon: FileText, title: i.number, detail: `${i.clinic} · ${Number(i.total).toLocaleString("en-US")} ETB · ${i.status.toLowerCase()}`, group: "Invoices" })),
    ...r.payments.map((p) => ({
      key: `p${p.id}`,
      href: `/platform/clinics/${p.tenantId}`,
      icon: Receipt,
      title: p.reference ?? "Payment",
      detail: `${p.clinic} · ${Number(p.amount).toLocaleString("en-US")} ETB · ${p.status.toLowerCase()}`,
      group: "Payments",
    })),
    ...r.requests.map((q) => ({ key: `r${q.id}`, href: `/platform/requests/${q.id}`, icon: Inbox, title: q.clinicName, detail: `${q.reference} · ${q.contactPhone} · ${q.status.toLowerCase()}`, group: "Requests" })),
  ];
}

/**
 * One box for everything: a clinic by name or phone, an invoice by number, a payment by its bank
 * reference, a request by reference or phone. Ctrl+K (or /) to jump to it; arrows and Enter to open.
 */
export function ConsoleSearch() {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const latest = useRef("");

  // Ctrl+K / ⌘K anywhere, or / when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Asks once the typing pauses; an older answer arriving late is ignored.
  useEffect(() => {
    const text = q.trim();
    latest.current = text;
    if (text.length < 2) return;
    const timer = setTimeout(() => {
      start(async () => {
        const r = await platformSearch(text);
        if (latest.current !== text) return;
        setResults(hits(r));
        setActive(0);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const shown = q.trim().length >= 2 ? results : null;
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    setResults(null);
    input.current?.blur();
    router.push(h.href);
  };

  return (
    <div
      className="relative w-full max-w-md"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && !!shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && shown?.[active] ? `${id}-${shown[active].key}` : undefined}
        aria-autocomplete="list"
        aria-label="Search clinics, invoices, payments and requests"
        placeholder="Search clinics, invoices, payments…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!shown?.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + shown.length) % shown.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pr-16 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:bg-slate-950 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5">
        {pending && <Loader2 aria-hidden className="size-4 animate-spin text-slate-400" />}
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 font-sans text-[11px] text-slate-500 sm:inline dark:border-slate-700 dark:bg-slate-800">Ctrl K</kbd>
      </span>

      {open && shown && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-40 mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg sm:min-w-[28rem] dark:border-slate-700 dark:bg-slate-900"
        >
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">{pending ? "Searching…" : `Nothing matches “${q.trim()}”.`}</p>
          ) : (
            shown.map((h, n) => (
              <div key={h.key}>
                {(n === 0 || shown[n - 1].group !== h.group) && <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{h.group}</p>}
                <button
                  id={`${id}-${h.key}`}
                  type="button"
                  role="option"
                  aria-selected={n === active}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(n)}
                  onClick={() => go(h)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${n === active ? "bg-brand-50 dark:bg-brand-950" : ""}`}
                >
                  <h.icon aria-hidden className="size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900 dark:text-white">{h.title}</span>
                    <span className="block truncate text-xs text-slate-500">{h.detail}</span>
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
