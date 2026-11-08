/**
 * Interface language. English text is the key; `AM` holds the Amharic. Anything not yet in the
 * dictionary stays in English, so screens can be translated one at a time. Have a native speaker
 * on the clinical team review new entries before release.
 */
export type Lang = "en" | "am";

export const LANG_COOKIE = "hmis_lang";

const AM: Record<string, string> = {
  // Navigation
  Home: "መነሻ",
  Queue: "ወረፋ",
  Appointments: "ቀጠሮዎች",
  Patients: "ታካሚዎች",
  Lab: "ላብራቶሪ",
  Pharmacy: "ፋርማሲ",
  Inventory: "ክምችት",
  Billing: "ክፍያ",
  "Credit & insurance": "ዱቤና መድን",
  Reports: "ሪፖርቶች",
  Staff: "ሰራተኞች",
  Settings: "ቅንብሮች",
  "Audit log": "የኦዲት መዝገብ",
  "Front desk": "መቀበያ",
  Services: "አገልግሎቶች",
  Finance: "ፋይናንስ",
  Administration: "አስተዳደር",
  "Sign out": "ውጣ",
  Password: "የይለፍ ቃል",
  "Two-step": "ባለሁለት ደረጃ መግቢያ",
  Language: "ቋንቋ",

  // Home
  "Good morning": "እንደምን አደሩ",
  "Good afternoon": "እንደምን ዋሉ",
  "Good evening": "እንደምን አመሹ",
  Welcome: "እንኳን ደህና መጡ",
  "Your workspace": "የስራ ቦታዎ",
  "Check in a patient": "ታካሚ ተቀበል",
  "Register patient": "ታካሚ መዝግብ",
  "Book appointment": "ቀጠሮ ያዝ",
  "Open the queue": "ወረፋውን ክፈት",
  "My patients": "የእኔ ታካሚዎች",
  "Lab worklist": "የላብራቶሪ ስራዎች",
  "Prescriptions to dispense": "የሚታደሉ ማዘዣዎች",
  "Bills to collect": "የሚሰበሰቡ ክፍያዎች",
  "Today's queue": "የዛሬው ወረፋ",
  Dashboard: "ዳሽቦርድ",

  // Queue
  "Patients today": "የዛሬ ታካሚዎች",
  Waiting: "በመጠባበቅ ላይ",
  "In progress": "በሂደት ላይ",
  Finished: "የተጠናቀቁ",
  "Finished today": "ዛሬ የተጠናቀቁ",
  Find: "ፈልግ",
  "New patient": "አዲስ ታካሚ",
  "All doctors": "ሁሉም ሐኪሞች",
  "Waiting-room display": "የመጠበቂያ ክፍል ማሳያ",
  "Call in": "ጥራ",
  Complete: "ጨርስ",
  "Send to lab": "ወደ ላብራቶሪ ላክ",
  "Send to pharmacy": "ወደ ፋርማሲ ላክ",
  "Back to queue": "ወደ ወረፋ መልስ",
  "Back to doctor": "ወደ ሐኪም መልስ",
  Open: "ክፈት",
  Triage: "ቅድመ ምርመራ",
  Cancel: "ሰርዝ",
  "Nobody is waiting.": "የሚጠብቅ የለም።",
  "Awaiting payment": "ክፍያ ይጠበቃል",
  "Results ready": "ውጤት ደርሷል",
  "Lab results pending": "የላብራቶሪ ውጤት ይጠበቃል",
  Owes: "ቀሪ ክፍያ",
  "No diagnosis yet": "ዲያግኖሲስ ገና አልተመዘገበም",

  // Visit statuses
  "With doctor": "ከሐኪም ጋር",
  "At lab": "ላብራቶሪ",
  "At pharmacy": "ፋርማሲ",
  Done: "ተጠናቋል",
  Cancelled: "ተሰርዟል",
};

/** The text in the chosen language (English when there is no translation yet). */
export function tr(lang: Lang, english: string) {
  return lang === "am" ? (AM[english] ?? english) : english;
}
