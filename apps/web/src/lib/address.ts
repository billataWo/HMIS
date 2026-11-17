import { EN } from "./format";
import type { T } from "./i18n";

/** Ethiopia's regions and city administrations (the API accepts these). */
export const REGIONS = [
  "Addis Ababa",
  "Afar",
  "Amhara",
  "Benishangul-Gumuz",
  "Central Ethiopia",
  "Dire Dawa",
  "Gambela",
  "Harari",
  "Oromia",
  "Sidama",
  "Somali",
  "South Ethiopia",
  "South West Ethiopia",
  "Tigray",
] as const;

type Addressed = {
  region?: string | null;
  zone?: string | null;
  woreda?: string | null;
  kebele?: string | null;
  houseNo?: string | null;
  address?: string | null;
};

/** "House 112, Kebele 04, Adama, East Shewa, Oromia · behind the bus station", or null. */
export function formatAddress(p: Addressed, t: T = EN) {
  const place = [p.houseNo && t("House {n}", { n: p.houseNo }), p.kebele && t("Kebele {n}", { n: p.kebele }), p.woreda, p.zone, p.region && t(p.region)].filter(Boolean).join(", ");
  return [place, p.address].filter(Boolean).join(" · ") || null;
}
