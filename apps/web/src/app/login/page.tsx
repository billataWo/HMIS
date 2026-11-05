import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · HMIS" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">HMIS</h1>
        <p className="mb-6 text-sm text-zinc-500">Sign in with your phone number · በስልክ ቁጥርዎ ይግቡ</p>
        <LoginForm />
      </div>
    </main>
  );
}
