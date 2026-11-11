import { privacyMetadata, PrivacyView } from "./view";

export const metadata = privacyMetadata("en");

/** The Privacy Policy in English (Amharic: /am/privacy). */
export default function PrivacyPage() {
  return <PrivacyView lang="en" />;
}
