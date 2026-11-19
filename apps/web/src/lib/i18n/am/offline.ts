/** The offline workspace (app/offline): what a PC can do while the connection is down. */
export const OFFLINE: Record<string, string> = {
  // The workspace
  "Offline workspace": "የከመስመር ውጭ የሥራ ቦታ",
  "Loading what this PC has kept…": "ይህ ኮምፒውተር የያዘውን በመጫን ላይ…",
  "The sign-in on this PC has expired": "በዚህ ኮምፒውተር ላይ ያለው መግቢያ ጊዜው አልፏል",
  "{name}'s sign-in ran out at {time}, so this PC no longer keeps their patients' data. Sign in again once the connection is back.":
    "የ{name} መግቢያ በ{time} ስላበቃ ይህ ኮምፒውተር የታካሚዎቻቸውን መረጃ ከእንግዲህ አይዝም። ግንኙነቱ ሲመለስ እንደገና ይግቡ።",
  "The {n} offline item waiting on this PC will be sent then.": "በዚህ ኮምፒውተር ላይ የሚጠብቀው {n} የከመስመር ውጭ ሥራ ያኔ ይላካል።",
  "The {n} offline items waiting on this PC will be sent then.": "በዚህ ኮምፒውተር ላይ የሚጠብቁት {n} የከመስመር ውጭ ሥራዎች ያኔ ይላካሉ።",
  "Nothing is kept on this PC yet": "በዚህ ኮምፒውተር ላይ እስካሁን የተያዘ ነገር የለም",
  "Offline mode needs one sign-in while the connection works: HMIS then keeps your day's work on this PC.":
    "ከመስመር ውጭ ለመሥራት ግንኙነቱ እያለ አንድ ጊዜ መግባት ያስፈልጋል፦ ከዚያ HMIS የዕለቱን ሥራዎን በዚህ ኮምፒውተር ላይ ይይዛል።",
  "Open HMIS": "HMISን ክፈት",
  "data from {time}": "መረጃው የ{time} ነው",
  "No connection": "ግንኙነት የለም",
  "Send now": "አሁን ላክ",
  "Back to HMIS": "ወደ HMIS ተመለስ",
  "Connected: work done here is sent to the server straight away. The full HMIS has more; use this page when the connection drops.":
    "ተገናኝቷል፦ እዚህ የሚሠራ ሥራ ወዲያውኑ ወደ ሰርቨሩ ይላካል። ሙሉው HMIS ብዙ ነገር አለው፤ ይህን ገጽ ግንኙነቱ ሲቋረጥ ይጠቀሙበት።",
  "No connection: keep working here. Everything is kept on this PC and sent, with all the usual checks, when the connection is back. Other PCs only see it after that.":
    "ግንኙነት የለም፦ እዚሁ መሥራትዎን ይቀጥሉ። ሁሉም ነገር በዚህ ኮምፒውተር ላይ ተይዞ ግንኙነቱ ሲመለስ በተለመዱት ፍተሻዎች ሁሉ ይላካል። ሌሎች ኮምፒውተሮች የሚያዩት ከዚያ በኋላ ነው።",
  "Your sign-in has expired, so the work below can't be sent yet. {link} as {name}: it is sent straight after.":
    "መግቢያዎ ጊዜው ስላለፈ ከታች ያለው ሥራ ገና ሊላክ አይችልም። እንደ {name} {link}፦ ወዲያውኑ ይላካል።",
  "{n} item recorded offline on this PC by another person is waiting for them to sign in here; work is only ever sent as the person who did it.":
    "በዚህ ኮምፒውተር ላይ በሌላ ሰው ከመስመር ውጭ የተመዘገበ {n} ሥራ ያ ሰው እዚህ እስኪገባ ይጠብቃል፤ ሥራ የሚላከው ሁልጊዜ በሠራው ሰው ስም ብቻ ነው።",
  "{n} items recorded offline on this PC by another person are waiting for them to sign in here; work is only ever sent as the person who did it.":
    "በዚህ ኮምፒውተር ላይ በሌላ ሰው ከመስመር ውጭ የተመዘገቡ {n} ሥራዎች ያ ሰው እዚህ እስኪገባ ይጠብቃሉ፤ ሥራ የሚላከው ሁልጊዜ በሠራው ሰው ስም ብቻ ነው።",
  "This is the cloud's read-only copy of the clinic": "ይህ ለማየት ብቻ የሆነው የክሊኒኩ የክላውድ ቅጂ ነው",
  "This clinic works on its own clinic server, which keeps working without internet. Records are entered there, not here.":
    "ይህ ክሊኒክ ያለ ኢንተርኔት መሥራቱን በሚቀጥለው የራሱ ሰርቨር ላይ ይሠራል። መዝገቦች የሚገቡት እዚያ ነው፣ እዚህ አይደለም።",
  "Work areas": "የሥራ ክፍሎች",
  "Your role has no offline work area": "ሚናዎ የከመስመር ውጭ የሥራ ክፍል የለውም",
  "Needs attention ({n})": "ትኩረት የሚፈልጉ ({n})",
  "The server did not accept these. Fix the cause (often online, in the full HMIS), then send again or remove them.":
    "ሰርቨሩ እነዚህን አልተቀበለም። ምክንያቱን ያስተካክሉ (ብዙውን ጊዜ በመስመር ላይ፣ በሙሉው HMIS)፣ ከዚያ እንደገና ይላኩ ወይም ያስወግዷቸው።",
  "Waiting to be sent ({n})": "ለመላክ የሚጠብቁ ({n})",
  "Possibly the same person as: {list}": "ምናልባት ከዚህ ሰው ጋር አንድ ሊሆን ይችላል፦ {list}",
  "Different person: register anyway": "የተለየ ሰው ነው፦ ለማንኛውም መዝግብ",
  "Not in HMIS: send again": "በHMIS ውስጥ የለም፦ እንደገና ላክ",
  "Send again": "እንደገና ላክ",
  'Remove "{what}"? It will not be sent.': "«{what}» ይወገድ? አይላክም።",
  "Depends on earlier work that was removed from this PC.": "ከዚህ ኮምፒውተር በተወገደ ቀደም ያለ ሥራ ላይ የተመሠረተ ነው።",
  // What to do about a refusal
  "Look for it in HMIS first. Only if it is not there, send it again.": "መጀመሪያ በHMIS ውስጥ ይፈልጉት። እዚያ ከሌለ ብቻ እንደገና ይላኩት።",
  "This visit was already settled, probably on another PC. The money taken here is extra: give it back to the patient.":
    "ይህ ጉብኝት ምናልባት በሌላ ኮምፒውተር ላይ ቀድሞ ተከፍሏል። እዚህ የተቀበሉት ገንዘብ ትርፍ ነው፦ ለታካሚው ይመልሱ።",
  "Less is owed than was taken (part was paid on another PC). Give the difference back, then record the right amount in HMIS.":
    "ከተቀበሉት ያነሰ ነው የሚፈለገው (ከፊሉ በሌላ ኮምፒውተር ተከፍሏል)። ልዩነቱን ይመልሱ፣ ከዚያ ትክክለኛውን መጠን በHMIS ይመዝግቡ።",
  "Check the visit's invoices in HMIS before taking any more money; give back anything paid twice.":
    "ተጨማሪ ገንዘብ ከመቀበልዎ በፊት የጉብኝቱን ሂሳቦች በHMIS ይመልከቱ፤ ሁለት ጊዜ የተከፈለውን ይመልሱ።",
  "Another PC recorded this sample already: nothing more to do.": "ሌላ ኮምፒውተር ይህን ናሙና ቀድሞ መዝግቦታል፦ ሌላ የሚሠራ ነገር የለም።",
  "Check the prescription in HMIS before handing over anything else.": "ሌላ ነገር ከማስረከብዎ በፊት የመድኃኒት ማዘዣውን በHMIS ይመልከቱ።",
  "Open the visit in HMIS, review the alert and prescribe again there.": "ጉብኝቱን በHMIS ከፍተው ማስጠንቀቂያውን ይመልከቱና እዚያ እንደገና ያዝዙ።",

  // Shared
  "new (number when sent)": "አዲስ (ቁጥሩ ሲላክ ይሰጣል)",

  // Front desk
  "{name} is checked in.": "{name} ገብተዋል።",
  "Patients known on this PC: registered recently, seen today, or registered here offline.":
    "በዚህ ኮምፒውተር የሚታወቁ ታካሚዎች፦ በቅርቡ የተመዘገቡ፣ ዛሬ የታዩ ወይም እዚህ ከመስመር ውጭ የተመዘገቡ።",
  Service: "አገልግሎት",
  "Not on this PC. Register below; if the patient already has a card, the server will say so when this is sent.":
    "በዚህ ኮምፒውተር ላይ የለም። ከታች ይመዝግቡ፤ ታካሚው ቀድሞ ካርድ ካለው ይህ ሲላክ ሰርቨሩ ይናገራል።",
  "Nobody yet.": "እስካሁን ማንም የለም።",
  "The card number (MRN) is given when this is sent to the server.": "የካርድ ቁጥሩ (MRN) የሚሰጠው ይህ ወደ ሰርቨሩ ሲላክ ነው።",
  "Age (years)": "ዕድሜ (ዓመት)",
  "This may be someone who already has a card:": "ይህ ቀድሞ ካርድ ያለው ሰው ሊሆን ይችላል፦",
  "Use this card": "ይህን ካርድ ተጠቀም",
  "Check in now": "አሁን አስገባ",
  Register: "መዝግብ",

  // Doctor
  "No open visits on this PC.": "በዚህ ኮምፒውተር ላይ ክፍት ጉብኝት የለም።",
  "Choose a patient": "ታካሚ ይምረጡ",
  "The consultation fee is not paid yet": "የምክክር ክፍያው ገና አልተከፈለም",
  "The consultation fee has not been paid yet (as far as this PC knows).": "የምክክር ክፍያው ገና አልተከፈለም (ይህ ኮምፒውተር እስከሚያውቀው ድረስ)።",
  "Call the patient in to record notes and orders.": "ማስታወሻዎችንና ትዕዛዞችን ለመመዝገብ ታካሚውን ይጥሩ።",
  "Vitals and notes": "ቫይታል ምልክቶችና ማስታወሻዎች",
  "Temp °C": "ሙቀት °C",
  "SpO₂ %": "SpO₂ %",
  "Weight kg": "ክብደት kg",
  "Saved on this PC": "በዚህ ኮምፒውተር ላይ ተቀምጧል",
  "Save notes": "ማስታወሻዎቹን አስቀምጥ",
  "Common ICD-11 diagnoses kept on this PC. For others, add them when the connection is back.":
    "በዚህ ኮምፒውተር የተያዙ የተለመዱ የICD-11 ዲያግኖሲሶች። ሌሎቹን ግንኙነቱ ሲመለስ ይጨምሩ።",
  "Search: malaria, pneumonia, CA40…": "ፈልግ፦ malaria, pneumonia, CA40…",
  "Order tests": "ምርመራዎችን እዘዝ",
  Prescription: "የመድኃኒት ማዘዣ",
  "Allergy and interaction checks run when this reaches the server; an alert brings it back to you.":
    "የአለርጂና የመስተጋብር ፍተሻዎች ይህ ሰርቨሩ ሲደርስ ይካሄዳሉ፤ ማስጠንቀቂያ ካለ ወደ እርስዎ ይመለሳል።",
  "Already prescribed this visit: {drugs}.": "በዚህ ጉብኝት ቀድሞ የታዘዙ፦ {drugs}።",
  "How often": "በምን ያህል ጊዜ",
  "Only {n} in stock when this PC last checked.": "ይህ ኮምፒውተር ለመጨረሻ ጊዜ ሲያይ ክምችቱ {n} ብቻ ነበር።",
  "{drug} is already prescribed for this visit.": "{drug} ለዚህ ጉብኝት ቀድሞ ታዝዟል።",
  Prescribe: "እዘዝ",

  // Cashier
  "Nothing waiting to be paid on this PC": "በዚህ ኮምፒውተር ላይ ክፍያ የሚጠብቅ የለም",
  "Taken on this PC": "በዚህ ኮምፒውተር የተቀበሉ",
  "Provisional receipts; the official receipt comes with the invoice once this is sent.": "ጊዜያዊ ደረሰኞች፤ ይፋዊው ደረሰኝ ይህ ሲላክ ከሂሳቡ ጋር ይመጣል።",
  "Added offline": "ከመስመር ውጭ የተጨመረ",
  "Paid so far": "እስካሁን የተከፈለ",
  "Owed {amount}": "የሚፈለግ {amount}",
  "Payment method": "የክፍያ ዘዴ",
  "Telebirr transaction number": "የቴሌብር የግብይት ቁጥር",
  "Transaction no.": "የግብይት ቁጥር",
  "Amount received": "የተቀበሉት መጠን",
  "More than is owed ({amount}): take only what is owed.": "ከሚፈለገው ({amount}) ይበልጣል፦ የሚፈለገውን ብቻ ይቀበሉ።",
  "Less than is owed: the rest stays owed.": "ከሚፈለገው ያነሰ ነው፦ ቀሪው እንደ ዕዳ ይቆያል።",
  "Check the Telebirr message on the patient's phone and copy its transaction number.": "በታካሚው ስልክ ላይ ያለውን የቴሌብር መልዕክት ይመልከቱና የግብይት ቁጥሩን ይቅዱ።",

  // Lab
  "No open tests on this PC": "በዚህ ኮምፒውተር ላይ ክፍት ምርመራ የለም",
  "{n} verified on this PC today.": "ዛሬ በዚህ ኮምፒውተር {n} ተረጋግጠዋል።",
  "Result to enter": "ውጤት የሚገባለት",
  "To verify": "የሚረጋገጥ",
  "Not paid yet (as far as this PC knows): send the patient to the cashier.": "ገና አልተከፈለም (ይህ ኮምፒውተር እስከሚያውቀው ድረስ)፦ ታካሚውን ወደ ገንዘብ ተቀባይ ይላኩ።",
  "Sample label (optional)": "የናሙና መለያ (አማራጭ)",
  "Sample label": "የናሙና መለያ",
  "This is a panel test: enter its results when the connection is back.": "ይህ የፓነል ምርመራ ነው፦ ውጤቶቹን ግንኙነቱ ሲመለስ ያስገቡ።",
  "Result…": "ውጤት…",
  "Value in {unit}": "ዋጋው በ{unit}",
  "Result: {value}": "ውጤት፦ {value}",
  Verify: "አረጋግጥ",

  // Pharmacy
  "No prescriptions waiting on this PC": "በዚህ ኮምፒውተር ላይ የሚጠብቅ የመድኃኒት ማዘዣ የለም",
  "To dispense": "የሚታደል",
  "{n} to go · billed {billed}": "{n} ቀሪ · ሂሳብ የተሠራለት {billed}",
  "paid {n}": "የተከፈለ {n}",
  "only {n} in stock": "ክምችቱ {n} ብቻ ነው",
  "Bill {amount}": "ሂሳብ ሥራ {amount}",
  "Bill first; the patient pays at the cashier": "መጀመሪያ ሂሳብ ይሥሩ፤ ታካሚው በገንዘብ ተቀባይ ይከፍላል",
  "Bill first": "መጀመሪያ ሂሳብ ይሥሩ",
  "Hand over": "አስረክብ",

  // Queued work, as listed
  "Register {name}": "{name}ን መዝግብ",
  "Check in {name}": "{name}ን አስገባ",
  "Back to waiting: {name}": "ወደ ጥበቃ ተመለሰ፦ {name}",
  "Call in {name}": "{name}ን ጥራ",
  "Send {name} to the lab": "{name}ን ወደ ላብራቶሪ ላክ",
  "Send {name} to the pharmacy": "{name}ን ወደ ፋርማሲ ላክ",
  "Complete the visit of {name}": "የ{name}ን ጉብኝት አጠናቅቅ",
  "Cancel the visit of {name}": "የ{name}ን ጉብኝት ሰርዝ",
  "Notes and vitals for {name}": "የ{name} ማስታወሻዎችና ቫይታል ምልክቶች",
  "Diagnosis {code} for {name}": "ዲያግኖሲስ {code} ለ{name}",
  "Lab: {tests} for {name}": "ላብራቶሪ፦ {tests} ለ{name}",
  "Prescription ({drugs}) for {name}": "የመድኃኒት ማዘዣ ({drugs}) ለ{name}",
  "Cash payment of {amount} ETB from {name}": "ከ{name} የ{amount} ብር ጥሬ ገንዘብ ክፍያ",
  "Telebirr payment ({reference}) of {amount} ETB from {name}": "ከ{name} የ{amount} ብር የቴሌብር ክፍያ ({reference})",
  "Sample for {test} ({name})": "የ{test} ናሙና ({name})",
  "Result {test}: {value} ({name})": "ውጤት {test}፦ {value} ({name})",
  "Verify {test} ({name})": "{test}ን አረጋግጥ ({name})",
  "Bill drugs for {name}": "ለ{name} የመድኃኒት ሂሳብ ሥራ",
  "Hand over drugs to {name}": "መድኃኒቶቹን ለ{name} አስረክብ",
  "Triage for {name}": "የ{name} ቅድመ ምርመራ",
  "Sample rejected: {test} ({name})": "ናሙናው ውድቅ ተደርጓል፦ {test} ({name})",
  "Bank transfer ({reference}) of {amount} ETB from {name}": "ከ{name} የ{amount} ብር የባንክ ዝውውር ({reference})",

  // Taking back work not yet sent
  "Take back": "ሳይላክ መልስ",
  'Take back "{what}"? It will not be sent.': '"{what}" ይመለስ? አይላክም።',
  'Take back "{what}"? It is not sent, and neither are the {n} later items that depend on it:':
    '"{what}" ይመለስ? አይላክም፤ በእሱ ላይ የተመሠረቱት {n} ተከታይ ሥራዎችም አይላኩም፦',
  "It was sent meanwhile: correct it in HMIS instead.": "እስከዚያው ተልኳል፦ በምትኩ በHMIS ውስጥ ያርሙት።",
  "Recorded by mistake? Take it back before it is sent. Once sent, correct it in HMIS.":
    "በስህተት ተመዝግቧል? ከመላኩ በፊት ይመልሱት። ከተላከ በኋላ በHMIS ውስጥ ያርሙት።",
  "Verify and send": "አረጋግጥና ላክ",

  // Turned off in Settings
  "Offline mode is turned off for this clinic": "ለዚህ ክሊኒክ ከመስመር ውጭ ሥራ ጠፍቷል",
  "This PC keeps no patient data, so there is nothing to work on without a connection. An admin can turn it on in Settings.":
    "ይህ ኮምፒውተር የታካሚ መረጃ አይዝም፤ ስለዚህ ያለ ግንኙነት የሚሠራ ነገር የለም። አስተዳዳሪ በቅንብሮች ውስጥ ሊያበራው ይችላል።",
  "The {n} offline item waiting on this PC will be sent once HMIS is open.": "በዚህ ኮምፒውተር ላይ የሚጠብቀው {n} የከመስመር ውጭ ሥራ HMIS ሲከፈት ይላካል።",
  "The {n} offline items waiting on this PC will be sent once HMIS is open.": "በዚህ ኮምፒውተር ላይ የሚጠብቁት {n} የከመስመር ውጭ ሥራዎች HMIS ሲከፈት ይላካሉ።",
  "The server had an error with this, so it may not have been saved.": "ሰርቨሩ በዚህ ላይ ስህተት ስላጋጠመው ተቀምጦ ላይሆን ይችላል።",

  // Front desk
  "All {n} of the clinic's patients as of {time}, and those registered here offline.":
    "የክሊኒኩ {n} ታካሚዎች በሙሉ እስከ {time} ድረስ፣ እና እዚህ ከመስመር ውጭ የተመዘገቡት።",
  "Why the visit is cancelled": "ጉብኝቱ የተሰረዘበት ምክንያት",
  "Cancel the visit": "ጉብኝቱን ሰርዝ",

  // Triage and consultation
  "To triage": "ቅድመ ምርመራ ይጠብቃል",
  "Between {min} and {max}": "ከ{min} እስከ {max}",
  "The last period must be within the last 10 months": "የመጨረሻው የወር አበባ ባለፉት 10 ወራት ውስጥ መሆን አለበት",
  "An emergency: seen before payment. The fee stays owed.": "ድንገተኛ ሕመምተኛ፦ ከክፍያ በፊት ይታያል። ክፍያው እንደ ዕዳ ይቆያል።",
  "As this PC last had them; results released on the lab's PC show here after it has sent them.":
    "ይህ ኮምፒውተር በመጨረሻ እንደያዛቸው፤ በላብራቶሪው ኮምፒውተር የተለቀቁ ውጤቶች እዚህ የሚታዩት ያ ኮምፒውተር ከላካቸው በኋላ ነው።",
  "In the lab": "ላብራቶሪ ውስጥ",
  "Common ICD-11 diagnoses kept on this PC; any other by its ICD-11 code.": "በዚህ ኮምፒውተር ላይ የተያዙ የተለመዱ የICD-11 ዲያግኖሲሶች፤ ሌላ ማንኛውም በICD-11 ኮዱ።",

  // Lab
  "The last sample was rejected ({reason}): take a new one.": "የመጨረሻው ናሙና ውድቅ ተደርጓል ({reason})፦ አዲስ ናሙና ይውሰዱ።",
  "Not run": "አልተካሄደም",
  "A number": "ቁጥር ያስገቡ",
  "What was wrong": "ችግሩ ምን ነበር",
  "Reject: take a new sample": "ውድቅ አድርግ፦ አዲስ ናሙና ውሰድ",

  // Cashier
  "Check the bank's confirmation and copy its reference number.": "የባንኩን ማረጋገጫ ይመልከቱና የማጣቀሻ ቁጥሩን ይቅዱ።",
};
