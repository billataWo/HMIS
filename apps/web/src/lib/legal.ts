/**
 * The facts the Privacy Policy and the Terms of Service state about the business that provides
 * HMIS. FILL IN the empty ones before clinics sign up (and have a lawyer read both documents):
 * an empty value is left out of the pages rather than shown as a blank.
 *
 * Support phone and email come from the platform console (Settings) when `email` and `phone`
 * here are empty.
 */
export const LEGAL = {
  /** The registered legal name of the business, e.g. "Example Health Technologies PLC". */
  provider: "",
  /** Registered address: sub-city, woreda, house number, city. */
  address: "",
  /** Where privacy questions and requests go (e.g. privacy@…). Empty: the support email. */
  email: "",
  /** Empty: the support phone. */
  phone: "",
  /** Commercial registration / trade licence number. */
  tradeRegistration: "",
  /** Registration with the Ethiopian Communications Authority as a data controller and processor (Proclamation No. 1321/2024, art. 33). */
  dataProtectionRegistration: "",

  /**
   * The version of both documents: their date. Change it whenever either document changes; new
   * requests record the version they accepted. Tell existing clinics 30 days before a change
   * (Terms, "Changes to these terms").
   */
  version: "2026-11-12",
  /** As it is shown on the pages. */
  updated: "12 November 2026",

  /**
   * Who processes data for HMIS (the clinics are told before this list changes). `am`: the same in
   * Amharic for /am/privacy (without it, the English is shown there).
   */
  subprocessors: [
    {
      name: "AletCloud",
      does: "Hosts the HMIS cloud: the application and its database.",
      where: "Ethiopia",
      am: { name: "AletCloud (አሌት ክላውድ)", does: "የHMIS ክላውድን ያስተናግዳል፦ መተግበሪያውንና ዳታቤዙን።", where: "ኢትዮጵያ" },
    },
    {
      name: "Off-site backup storage",
      does: "Keeps encrypted copies of the database for disaster recovery.",
      where: "Ethiopia",
      am: { name: "ከቦታ ውጪ ያለ የተጠባባቂ ቅጂ ማከማቻ", does: "የዳታቤዙን የተመሰጠሩ ቅጂዎች ለአደጋ ጊዜ ማገገሚያ ይይዛል።", where: "ኢትዮጵያ" },
    },
    {
      name: "Chapa",
      does: "Takes card and mobile-money payments of HMIS subscription invoices, when a clinic pays that way.",
      where: "Ethiopia",
      am: { name: "ቻፓ (Chapa)", does: "ክሊኒክ በዚህ መንገድ ሲከፍል የHMIS የደንበኝነት ክፍያዎችን በካርድና በሞባይል ገንዘብ ይቀበላል።", where: "ኢትዮጵያ" },
    },
    {
      name: "telebirr (Ethio Telecom)",
      does: "Takes telebirr payments of HMIS subscription invoices, when a clinic pays that way.",
      where: "Ethiopia",
      am: { name: "ቴሌብር (ኢትዮ ቴሌኮም)", does: "ክሊኒክ በዚህ መንገድ ሲከፍል የHMIS የደንበኝነት ክፍያዎችን በቴሌብር ይቀበላል።", where: "ኢትዮጵያ" },
    },
  ],
};

/** The provider's name in sentences: the legal name once it is filled in. */
export const providerName = LEGAL.provider || "HMIS";
