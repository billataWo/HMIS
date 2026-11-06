import { Suspense } from "react";
import { Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { PasswordForm } from "./password-form";

async function Content() {
  const me = await api<Me>("/auth/me");
  return (
    <div className="max-w-md space-y-4">
      {me.mustChangePassword && (
        <Notice tone="warning">Your password was set by an admin. Choose your own password to continue.</Notice>
      )}
      <PasswordForm />
    </div>
  );
}

export default function PasswordPage() {
  return (
    <>
      <PageHeader title="Change password" subtitle="የይለፍ ቃል መቀየሪያ" />
      <Suspense fallback={<Skeleton className="h-64 max-w-md" />}>
        <Content />
      </Suspense>
    </>
  );
}
