import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { type OperatorMe, platformApi } from "@/lib/platform";
import { VoiceStudio } from "./studio";

export const metadata: Metadata = { title: "Voice" };

async function Content() {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  return <VoiceStudio canEdit={me.role === "OWNER"} />;
}

export default function VoicePage() {
  return (
    <>
      <PageHeader title="Voice" subtitle="the voice that calls patients on every clinic's waiting-room TV, in Amharic and English" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
