import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Notice, Skeleton } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { getT } from "@/lib/lang";
import { PasswordForm } from "./password-form";

async function Content() {
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  return (
    <div className="max-w-md space-y-4">
      {me.mustChangePassword && (
        <Notice tone="warning">{t("Your password was set by an admin. Choose your own password to continue.")}</Notice>
      )}
      <PasswordForm />
    </div>
  );
}

export default function PasswordPage() {
  return (
    <>
      <PageTitle title="Change password" />
      <Suspense fallback={<Skeleton className="h-64 max-w-md" />}>
        <Content />
      </Suspense>
    </>
  );
}
