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
export function formatAddress(p: Addressed) {
  const place = [p.houseNo && `House ${p.houseNo}`, p.kebele && `Kebele ${p.kebele}`, p.woreda, p.zone, p.region].filter(Boolean).join(", ");
  return [place, p.address].filter(Boolean).join(" · ") || null;
}
