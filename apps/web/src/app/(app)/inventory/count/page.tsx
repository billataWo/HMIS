import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError } from "@/lib/api";
import { CountForm, type CountBatch } from "./count-form";

async function Sheet() {
  let batches: CountBatch[];
  try {
    batches = await api<CountBatch[]>("/inventory/batches");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{(await getT())("Only pharmacists and admins count stock.")}</p>;
    throw e;
  }
  return <CountForm batches={batches} />;
}

export default function CountPage() {
  return (
    <>
      <PageTitle title="Stock count" subtitle="count what is on the shelf; only batches you fill in are changed, and every difference is recorded" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Sheet />
      </Suspense>
    </>
  );
}
