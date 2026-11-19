import { StatusPage } from "@/components/status-page";

/** A page or record that isn't there (a wrong link, or notFound() from a page), inside the app's frame. */
export default function NotFound() {
  return <StatusPage status={404} />;
}
