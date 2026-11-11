import { RequestView, requestMetadata } from "./view";

export const metadata = requestMetadata("en");

/** Asking to use HMIS, in English (Amharic: /am/request). */
export default function RequestPage({ searchParams }: PageProps<"/request">) {
  return <RequestView lang="en" searchParams={searchParams} />;
}
