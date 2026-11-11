import { RequestView, requestMetadata } from "../../request/view";

export const metadata = requestMetadata("am");

/** Asking to use HMIS, in Amharic (English: /request). */
export default function RequestPageAm({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  return <RequestView lang="am" searchParams={searchParams} />;
}
