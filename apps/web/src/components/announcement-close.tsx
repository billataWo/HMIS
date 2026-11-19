"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Read in the app layout: the announcements this browser has closed. */
export const HIDDEN_COOKIE = "hmis_announcements_closed";

/** Closes an information message from HMIS in this browser (warnings cannot be closed). */
export function AnnouncementClose({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={label}
      title={label}
      onClick={() =>
        start(() => {
          const now = document.cookie.match(new RegExp(`(?:^|; )${HIDDEN_COOKIE}=([^;]*)`))?.[1] ?? "";
          const ids = [...decodeURIComponent(now).split(",").filter(Boolean).filter((x) => x !== id), id].slice(-20);
          document.cookie = `${HIDDEN_COOKIE}=${encodeURIComponent(ids.join(","))}; path=/; max-age=${90 * 24 * 60 * 60}; samesite=lax`;
          router.refresh();
        })
      }
      className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-lg opacity-70 hover:bg-black/5 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-40 dark:hover:bg-white/10"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}
