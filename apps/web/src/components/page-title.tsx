import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";
import { tr, type Vars } from "@/lib/i18n";
import { getT } from "@/lib/lang";

/**
 * A page's heading in the chosen language, with the other language under it (as the app has
 * always shown: "Patients" over "ታካሚዎች", or "ታካሚዎች" over "Patients"). `title` and `subtitle`
 * are the English keys; the subtitle is translated and follows the other-language title.
 */
export async function PageTitle({ title, subtitle, vars, actions }: { title: string; subtitle?: string; vars?: Vars; actions?: ReactNode }) {
  const t = await getT();
  const translated = tr("am", title) !== title;
  const other = translated ? (t.lang === "am" ? title : tr("am", title)) : null;
  const sub = [other, subtitle ? t(subtitle, vars) : null].filter(Boolean).join(" · ");
  return <PageHeader title={t(title)} subtitle={sub || undefined} actions={actions} />;
}
