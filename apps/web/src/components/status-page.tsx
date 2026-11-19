"use client";

import { ArrowLeft, CloudOff, HeartPulse, House, RotateCw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HeartbeatBackground, type Rhythm } from "@/components/activity-field";
import { useT } from "@/components/lang-provider";
import { buttonClass, secondaryButtonClass } from "@/components/ui";
import type { PageStatus } from "@/lib/http-status";

/**
 * What each status shows. The monitor draws a rhythm that matches, in the spirit of the sign-in's
 * heartbeat: a missed beat for a page that isn't there, a blocked beat for no access, an irregular
 * rhythm when something failed, and a lead off (a flat, noisy line) when the server can't be reached.
 */
const STATUS: Record<PageStatus, { title: string; body: string; rhythm: Rhythm; hr: string; caption: string; tone: string }> = {
  404: {
    title: "Page not found",
    body: "There's nothing at this address. The page or record may have been removed or merged, or the link has a mistake in it.",
    rhythm: "pause",
    hr: "72",
    caption: "SINUS PAUSE",
    tone: "text-emerald-300",
  },
  403: {
    title: "You don't have access to this page",
    body: "Your role in HMIS doesn't include this page. If you need it for your work, ask the clinic's admin.",
    rhythm: "block",
    hr: "38",
    caption: "AV BLOCK",
    tone: "text-amber-300",
  },
  500: {
    title: "Something went wrong",
    body: "HMIS had a problem showing this page. Nothing you saved is lost. Try again; if it keeps happening, give the admin the reference below.",
    rhythm: "irregular",
    hr: "1??",
    caption: "IRREGULAR RHYTHM",
    tone: "text-rose-300",
  },
  503: {
    title: "Can't reach the HMIS server",
    body: "The clinic server may be restarting, or the network is down. Nothing you saved is lost. Try again in a moment, or keep working in the offline workspace.",
    rhythm: "lead-off",
    hr: "---",
    caption: "LEAD OFF",
    tone: "text-sky-300",
  },
};

/**
 * An HTTP error page: a bedside monitor showing the status code over its rhythm, then what
 * happened and what to do. `page` fills the screen (outside the app); `inline` sits in the app's
 * frame, below its navigation.
 */
export function StatusPage({
  status,
  variant = "inline",
  reference,
  onRetry,
  detail,
}: {
  status: PageStatus;
  variant?: "page" | "inline";
  /** Says more than the standard text: who may open this page ("Only pharmacists and admins manage stock."). */
  detail?: ReactNode;
  /** An error reference to read out to support (500). */
  reference?: string;
  onRetry?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const s = STATUS[status];
  const failed = status === 500 || status === 503;

  // On its own screen it is the page's main content; in the app's frame, the frame has that.
  const Wrapper = variant === "page" ? "main" : "div";
  return (
    <Wrapper
      className={
        variant === "page"
          ? "flex min-h-full flex-1 items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950"
          : "flex flex-1 items-start justify-center px-4 py-10 sm:py-16"
      }
    >
      <div className="w-full max-w-xl">
        <Monitor status={status} />

        <p className={`mt-8 font-mono text-xs font-medium tracking-widest uppercase ${failed ? "text-rose-700 dark:text-rose-300" : "text-brand-700 dark:text-brand-300"}`}>
          {t("Error {code}", { code: status })}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">{t(s.title)}</h1>
        <p className="mt-3 text-pretty text-slate-600 dark:text-slate-400">{detail ? <>{detail} {t("If you need it for your work, ask the clinic's admin.")}</> : t(s.body)}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          {failed && onRetry ? (
            <button onClick={onRetry} className={buttonClass}>
              <RotateCw aria-hidden className="size-4" /> {t("Try again")}
            </button>
          ) : null}
          {status === 503 && (
            // A full page load: with no server, the service worker answers with the offline workspace.
            <a href="/offline" className={secondaryButtonClass}>
              <CloudOff aria-hidden className="size-4" /> {t("Open the offline workspace")}
            </a>
          )}
          {!failed && (
            <Link href="/" className={buttonClass}>
              <House aria-hidden className="size-4" /> {t("Go to the home page")}
            </Link>
          )}
          <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} className={secondaryButtonClass}>
            <ArrowLeft aria-hidden className="size-4" /> {t("Go back")}
          </button>
        </div>
        {reference && <p className="mt-6 font-mono text-xs text-slate-500">{t("Error reference {ref}", { ref: reference })}</p>}
      </div>
    </Wrapper>
  );
}

/** A page this role may not open (403), saying who may: <NoAccess>{t("Only pharmacists and admins manage stock.")}</NoAccess>. */
export function NoAccess({ children }: { children: ReactNode }) {
  return <StatusPage status={403} detail={children} />;
}

/** The monitor: the code large, the heart-rate readout, and the rhythm sweeping across. Decoration only. */
function Monitor({ status }: { status: PageStatus }) {
  const s = STATUS[status];
  return (
    <div aria-hidden className="relative h-52 overflow-hidden rounded-2xl bg-[#05262b] shadow-xl ring-1 ring-black/5 sm:h-60 dark:ring-white/10">
      {/* The monitor's grid, and a soft glow. */}
      <div className="absolute inset-0 bg-[linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] bg-size-[24px_24px] opacity-[0.05]" />
      <div className="absolute -top-1/2 -left-1/4 size-[28rem] rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.18),transparent_60%)]" />
      <HeartbeatBackground rhythm={s.rhythm} color={s.tone} style={{ bottom: "0.75rem" }} />

      <div className="relative flex items-start justify-between p-5 sm:p-6">
        <div>
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-widest text-white/60">
            <HeartPulse className="size-3.5" /> HMIS
          </span>
          <span className={`mt-1 block font-mono text-7xl leading-none font-semibold tracking-tight tabular-nums sm:text-8xl ${s.tone} [text-shadow:0_0_24px_currentColor]`}>
            {status}
          </span>
        </div>
        <div className="text-right font-mono">
          {/* i18n-ignore-start: a monitor's readout, as the device shows it */}
          <span className="block text-[11px] font-medium tracking-widest text-white/60">HR</span>
          <span className={`block text-3xl leading-none font-semibold tabular-nums ${s.tone}`}>{s.hr}</span>
          <span className={`mt-2 block text-[10px] font-medium tracking-widest ${s.tone} opacity-80`}>{s.caption}</span>
          {/* i18n-ignore-end */}
        </div>
      </div>
    </div>
  );
}
