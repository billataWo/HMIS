import { termsMetadata, TermsView } from "../../terms/view";

export const metadata = termsMetadata("am");

/** The Terms of Service in Amharic (English: /terms). */
export default function TermsPageAm() {
  return <TermsView lang="am" />;
}
