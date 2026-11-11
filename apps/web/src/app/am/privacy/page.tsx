import { privacyMetadata, PrivacyView } from "../../privacy/view";

export const metadata = privacyMetadata("am");

/** The Privacy Policy in Amharic (English: /privacy). */
export default function PrivacyPageAm() {
  return <PrivacyView lang="am" />;
}
