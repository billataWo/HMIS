import type { Lang } from "@/lib/i18n";

/**
 * Every word of the front page, in English and Amharic, side by side so a reviewer can compare
 * them. Facts only: each claim is something HMIS does today. Have a native speaker review the
 * Amharic before changing it.
 */
export const WELCOME = {
  en: {
    title: "HMIS for Ethiopian clinics",
    description: "Queue, consultation, lab, pharmacy and billing for clinics in Ethiopia. Free trial, then a monthly or yearly plan.",
    badge: "Made for clinics in Ethiopia",
    h1: ["Run your clinic's day, from check‑in to ", "receipt.", ""],
    subline: "የክሊኒክዎን የዕለት ሥራ በአንድ ቦታ ያስተዳድሩ",
    sublineLang: "am",
    lede: "Queue, consultation, lab, pharmacy and billing in one system your whole team uses. On the cloud or on your own server, and it keeps going when the internet does not.",
    start: "Start a free trial",
    seePlans: "See plans and prices",
    noCard: "No card needed. We call you before anything starts.",
    proofLabel: "Why clinics choose HMIS",
    proof: [
      { title: "Ethiopian payments", text: "Cash, telebirr and Chapa at the till" },
      { title: "Keeps working offline", text: "On your own server, or for open screens" },
      { title: "English or Amharic", text: "Each person picks their language" },
      { title: "MoH report built in", text: "The monthly report as a spreadsheet" },
    ],
    modules: {
      eyebrow: "What it does",
      title: "Everything a clinic does in a day, in one place",
      text: "Each member of staff signs in with their phone number and sees the screens for their role: reception, nurse, doctor, lab, pharmacy, cashier or admin.",
    },
    visit: {
      eyebrow: "One system, every step",
      title: "A patient's visit, without the paper trail",
      text: "Each desk sees the patient arrive on its own screen: the cashier before the doctor if you want payment first, the lab when tests are ordered, the pharmacy when a prescription is written. Nobody carries a card between rooms.",
    },
    ways: {
      eyebrow: "How it runs",
      title: "On the cloud, or at your clinic",
      text: "The same HMIS and the same price either way. Choose when you ask for it, and change later if you need to.",
      items: [
        { title: "On the HMIS cloud", text: "Nothing to install. Open HMIS in a browser on any computer or tablet. If the connection drops, the screens you have open keep working and catch up when it is back." },
        { title: "Your own server, synced", text: "A small server at the clinic runs HMIS for everyone on the clinic's network, with or without internet, and keeps a copy in the cloud." },
        { title: "Your own server only", text: "Everything stays at the clinic. Your server checks its HMIS licence; no patient data leaves the building." },
      ],
      devices: "Works on the computers and tablets you already have: any up-to-date browser. Receipts and lab reports print on an ordinary printer.",
    },
    privacy: {
      eyebrow: "Your patients' privacy",
      title: "Medical records deserve better than a shared spreadsheet",
      text: "HMIS is built for health data: each clinic's records are separate, each person signs in on their own, and the audit log shows who did what.",
      link: "Read the privacy policy",
      items: [
        "Each clinic's records are walled off from every other clinic's in the database itself.",
        "Two-step sign-in with a phone app, and staff see only what their role needs.",
        "Every change to a patient's record, and every export, is in the audit log.",
        "Your data is yours: export one patient's record or the whole clinic whenever you want.",
      ],
    },
    plans: {
      eyebrow: "Plans",
      title: "Priced by the size of your clinic",
      intro: (trial: number, vat: number) => `Every plan starts with a ${trial}-day free trial. Prices are per clinic, plus ${vat}% VAT.`,
      ask: "Ask us for prices:",
      askLink: "request HMIS",
    },
    start_: { eyebrow: "Getting started", title: "From request to your first patient" },
    questions: {
      eyebrow: "Questions",
      title: "What clinics ask us",
      items: [
        {
          q: "Do we need internet all the time?",
          a: "On the cloud, HMIS needs internet, but a dropped connection does not stop the screens already open: they keep working and send their changes when it is back. If your connection is unreliable, run HMIS on your own server at the clinic instead.",
        },
        {
          q: "What happens when the free trial ends?",
          a: "You get an invoice for the plan you chose. Until it is paid there is a grace period; after that HMIS becomes read-only. Nothing is deleted, and you can still see and export everything.",
        },
        { q: "Can we change plans later?", a: "Yes. Tell us when the clinic grows, or when you need fewer staff accounts, and we move you to the plan that fits." },
        {
          q: "Can we leave and take our data?",
          a: "Yes. An admin can download all of the clinic's data at any time, also for a while after the subscription ends, and it can be loaded into another HMIS server.",
        },
        {
          q: "Who can see our patients?",
          a: "Only your clinic's staff, each according to their role. The database itself refuses to show one clinic's records to another, and HMIS's own console shows a clinic's account and invoices, not its patients.",
        },
      ],
    },
    cta: {
      title: "Try HMIS in your clinic",
      text: "Ask today; we call you within two working days.",
      request: "Request HMIS",
      signIn: "Already using HMIS? Sign in",
      contact: "Questions first?",
    },
  },
  am: {
    title: "HMIS ለኢትዮጵያ ክሊኒኮች",
    description: "ለኢትዮጵያ ክሊኒኮች ወረፋ፣ የሐኪም ምርመራ፣ ላብራቶሪ፣ ፋርማሲና ክፍያ። በነፃ ሙከራ ይጀምሩ፤ ከዚያ ወርሃዊ ወይም ዓመታዊ ዕቅድ።",
    badge: "ለኢትዮጵያ ክሊኒኮች የተሰራ",
    h1: ["የክሊኒክዎን ዕለታዊ ሥራ ከመቀበያ እስከ ", "ደረሰኝ", " ያስተዳድሩ።"],
    subline: "Run your clinic's day, all in one place",
    sublineLang: "en",
    lede: "ወረፋ፣ የሐኪም ምርመራ፣ ላብራቶሪ፣ ፋርማሲና ክፍያ — መላው ቡድንዎ በሚጠቀምበት አንድ ሥርዓት። በክላውድ ወይም በራስዎ ሰርቨር ላይ፤ ኢንተርኔት ቢቋረጥም ሥራው አይቆምም።",
    start: "ነፃ ሙከራ ይጀምሩ",
    seePlans: "ዕቅዶችንና ዋጋዎችን ይመልከቱ",
    noCard: "ካርድ አያስፈልግም። ምንም ነገር ከመጀመሩ በፊት እንደውልልዎታለን።",
    proofLabel: "ክሊኒኮች HMISን የሚመርጡበት ምክንያት",
    proof: [
      { title: "የኢትዮጵያ የክፍያ መንገዶች", text: "ጥሬ ገንዘብ፣ ቴሌብርና ቻፓ በገንዘብ ተቀባዩ ዘንድ" },
      { title: "ያለ ኢንተርኔትም ይሰራል", text: "በራስዎ ሰርቨር፣ ወይም ለተከፈቱ ገጾች" },
      { title: "እንግሊዝኛ ወይም አማርኛ", text: "እያንዳንዱ ሰው ቋንቋውን ይመርጣል" },
      { title: "የጤና ሚኒስቴር ሪፖርት", text: "ወርሃዊው ሪፖርት እንደ ስፕሬድሺት ይወጣል" },
    ],
    modules: {
      eyebrow: "ምን ይሰራል",
      title: "የክሊኒክ የአንድ ቀን ሥራ በሙሉ፣ በአንድ ቦታ",
      text: "እያንዳንዱ ሰራተኛ በስልክ ቁጥሩ ይገባል፤ ለሚናው የሚያስፈልጉትን ገጾች ያያል፦ መቀበያ፣ ነርስ፣ ሐኪም፣ ላብራቶሪ፣ ፋርማሲ፣ ገንዘብ ተቀባይ ወይም አስተዳዳሪ።",
    },
    visit: {
      eyebrow: "አንድ ሥርዓት፣ በእያንዳንዱ ደረጃ",
      title: "የታካሚ ጉብኝት፣ ያለ ወረቀት ዝውውር",
      text: "እያንዳንዱ ክፍል ታካሚው መድረሱን በራሱ ገጽ ያያል፦ ቅድሚያ ክፍያ ከፈለጉ ገንዘብ ተቀባዩ ከሐኪሙ በፊት፣ ምርመራ ሲታዘዝ ላብራቶሪው፣ ማዘዣ ሲጻፍ ፋርማሲው። ማንም ካርድ ይዞ ከክፍል ወደ ክፍል አይዞርም።",
    },
    ways: {
      eyebrow: "እንዴት ይሰራል",
      title: "በክላውድ፣ ወይም በክሊኒክዎ",
      text: "በየትኛውም መንገድ ያው HMIS፣ ያው ዋጋ። ሲጠይቁ ይምረጡ፤ ካስፈለገ በኋላ መቀየር ይችላሉ።",
      items: [
        { title: "በHMIS ክላውድ", text: "የሚጫን ነገር የለም። በማንኛውም ኮምፒውተር ወይም ታብሌት ብራውዘር ላይ HMISን ይክፈቱ። ግንኙነቱ ቢቋረጥ የተከፈቱት ገጾች መስራታቸውን ይቀጥላሉ፤ ሲመለስም ያልተላከውን ይልካሉ።" },
        { title: "የራስዎ ሰርቨር፣ ከክላውድ ጋር የተመሳሰለ", text: "በክሊኒኩ ያለ ትንሽ ሰርቨር በክሊኒኩ ኔትወርክ ላሉ ሁሉ HMISን ያሰራል — ኢንተርኔት ቢኖርም ባይኖርም — ቅጂውንም በክላውድ ያስቀምጣል።" },
        { title: "የራስዎ ሰርቨር ብቻ", text: "ሁሉም ነገር በክሊኒኩ ይቀራል። ሰርቨርዎ የHMIS ፈቃዱን ብቻ ያረጋግጣል፤ የታካሚ መረጃ ከሕንጻው አይወጣም።" },
      ],
      devices: "ቀድሞውኑ ባሉዎት ኮምፒውተሮችና ታብሌቶች ላይ ይሰራል፦ ማንኛውም ዘመናዊ ብራውዘር በቂ ነው። ደረሰኞችና የላብራቶሪ ውጤቶች በተራ ፕሪንተር ይታተማሉ።",
    },
    privacy: {
      eyebrow: "የታካሚዎችዎ ግላዊነት",
      title: "የሕክምና መዝገብ ከጋራ ስፕሬድሺት የተሻለ ጥበቃ ይገባዋል",
      text: "HMIS ለጤና መረጃ የተሰራ ነው፦ የእያንዳንዱ ክሊኒክ መዝገብ ለብቻው ነው፣ እያንዳንዱ ሰው በራሱ መለያ ይገባል፣ የኦዲት መዝገቡም ማን ምን እንዳደረገ ያሳያል።",
      link: "የግላዊነት ፖሊሲውን ያንብቡ",
      items: [
        "የእያንዳንዱ ክሊኒክ መዝገብ በዳታቤዙ ውስጥ ራሱ ከሌሎች ክሊኒኮች ተለይቶ ይጠበቃል።",
        "በስልክ መተግበሪያ የሚሰራ ባለሁለት ደረጃ መግቢያ፤ ሰራተኞች ሚናቸው የሚፈልገውን ብቻ ያያሉ።",
        "በታካሚ መዝገብ ላይ የሚደረግ እያንዳንዱ ለውጥና እያንዳንዱ የመረጃ ማውጣት በኦዲት መዝገቡ ይመዘገባል።",
        "መረጃዎ የእርስዎ ነው፦ የአንድን ታካሚ መዝገብ ወይም የክሊኒኩን ሙሉ መረጃ በፈለጉት ጊዜ ያውርዱ።",
      ],
    },
    plans: {
      eyebrow: "ዕቅዶች",
      title: "በክሊኒክዎ መጠን የተተመነ ዋጋ",
      intro: (trial: number, vat: number) => `እያንዳንዱ ዕቅድ በ${trial} ቀን ነፃ ሙከራ ይጀምራል። ዋጋዎቹ ለአንድ ክሊኒክ ሲሆኑ ${vat}% ቫት ይጨመርባቸዋል።`,
      ask: "ዋጋ ለማወቅ ይጠይቁን፦",
      askLink: "HMIS ይጠይቁ",
    },
    start_: { eyebrow: "ለመጀመር", title: "ከጥያቄ እስከ መጀመሪያው ታካሚዎ" },
    questions: {
      eyebrow: "ጥያቄዎች",
      title: "ክሊኒኮች የሚጠይቁን",
      items: [
        {
          q: "ሁልጊዜ ኢንተርኔት ያስፈልገናል?",
          a: "በክላውድ ላይ HMIS ኢንተርኔት ያስፈልገዋል፤ ነገር ግን ግንኙነት ቢቋረጥ የተከፈቱት ገጾች አይቆሙም፦ መስራታቸውን ይቀጥላሉ፣ ግንኙነቱ ሲመለስም ለውጦቻቸውን ይልካሉ። ኢንተርኔትዎ አስተማማኝ ካልሆነ HMISን በክሊኒክዎ በራስዎ ሰርቨር ያሰሩት።",
        },
        {
          q: "ነፃ ሙከራው ሲያልቅ ምን ይሆናል?",
          a: "ለመረጡት ዕቅድ የክፍያ ጥያቄ (ኢንቮይስ) ይደርስዎታል። እስኪከፈል ድረስ የእፎይታ ጊዜ አለ፤ ከዚያ በኋላ HMIS ለማየት ብቻ ይሆናል። ምንም አይሰረዝም፤ ሁሉንም ማየትና ማውረድ ይችላሉ።",
        },
        { q: "በኋላ ዕቅድ መቀየር እንችላለን?", a: "አዎ። ክሊኒኩ ሲያድግ ወይም ያነሱ የሰራተኛ መለያዎች ሲያስፈልጉ ይንገሩን፤ ወደሚስማማዎት ዕቅድ እናዛውርዎታለን።" },
        {
          q: "ብንለቅ መረጃችንን ይዘን መሄድ እንችላለን?",
          a: "አዎ። አስተዳዳሪ የክሊኒኩን መረጃ በሙሉ በማንኛውም ጊዜ — የደንበኝነት ምዝገባው ካለቀ በኋላም ለተወሰነ ጊዜ — ማውረድ ይችላል፤ ወደ ሌላ HMIS ሰርቨርም መጫን ይቻላል።",
        },
        {
          q: "ታካሚዎቻችንን ማን ማየት ይችላል?",
          a: "የክሊኒክዎ ሰራተኞች ብቻ፣ እያንዳንዳቸው እንደ ሚናቸው። ዳታቤዙ ራሱ የአንድን ክሊኒክ መዝገብ ለሌላው አያሳይም፤ የHMIS የራሱ መቆጣጠሪያም የክሊኒኩን መለያና የክፍያ ጥያቄዎች እንጂ ታካሚዎቹን አያሳይም።",
        },
      ],
    },
    cta: {
      title: "HMISን በክሊኒክዎ ይሞክሩ",
      text: "ዛሬ ይጠይቁ፤ በሁለት የሥራ ቀናት ውስጥ እንደውልልዎታለን።",
      request: "HMIS ይጠይቁ",
      signIn: "HMIS እየተጠቀሙ ነው? ይግቡ",
      contact: "መጀመሪያ ጥያቄ አለዎት?",
    },
  },
} satisfies Record<Lang, unknown>;

/** The plan modules, in Amharic (the API names them in English). */
const FEATURES_AM: Record<string, string> = {
  CREDIT: "የዱቤ ድርጅቶችና መድን",
  PURCHASE_ORDERS: "የግዢ ትዕዛዞች",
  CLINIC_SERVER: "የክሊኒክ ሰርቨር (ያለ ኢንተርኔት ይሰራል፣ ከክላውድ ጋር ይመሳሰላል)",
};

export function featureLabels(lang: Lang, fromApi: Record<string, string>) {
  return lang === "am" ? { ...fromApi, ...FEATURES_AM } : fromApi;
}
