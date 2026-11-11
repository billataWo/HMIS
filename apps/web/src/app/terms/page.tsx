import { termsMetadata, TermsView } from "./view";

export const metadata = termsMetadata("en");

/** The Terms of Service in English (Amharic: /am/terms). */
export default function TermsPage() {
  return <TermsView lang="en" />;
}
