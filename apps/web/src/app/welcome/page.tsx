import { WelcomeView, welcomeMetadata } from "./view";

export const metadata = welcomeMetadata("en");

/** The HMIS cloud's front page, in English (Amharic: /am/welcome). */
export default function WelcomePage() {
  return <WelcomeView lang="en" />;
}
