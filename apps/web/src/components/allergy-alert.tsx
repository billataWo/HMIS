import { TriangleAlert } from "lucide-react";

/** The patient's allergies, shown the same way on every clinical screen. */
export function AllergyAlert({ allergies, className = "mb-4" }: { allergies: string[]; className?: string }) {
  if (allergies.length === 0) return null;
  return (
    <div role="alert" className={`flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100 ${className}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-red-600 text-white">
        <TriangleAlert aria-hidden className="size-4" />
      </span>
      <p className="text-sm">
        <span className="font-semibold">Allergies: </span>
        {allergies.join(", ")}
      </p>
    </div>
  );
}
