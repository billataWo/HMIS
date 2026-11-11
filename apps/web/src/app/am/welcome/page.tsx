import { WelcomeView, welcomeMetadata } from "../../welcome/view";

export const metadata = welcomeMetadata("am");

/** The HMIS cloud's front page, in Amharic (English: /welcome). */
export default function WelcomePageAm() {
  return <WelcomeView lang="am" />;
}
