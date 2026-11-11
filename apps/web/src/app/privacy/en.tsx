import Link from "next/link";
import { Bullets, ContactBlock, docLink, type LegalFacts, LegalTable } from "@/components/legal";
import { LEGAL } from "@/lib/legal";


const days = (n: number | null, fallback: string) => (n === null ? fallback : `${n} days`);

/** The Privacy Policy in English (the version that applies). */
export function privacySectionsEn(f: LegalFacts) {
  return [
    {
      id: "about",
      title: "Who we are and what this covers",
      body: (
        <>
          <p>
            HMIS is clinic management software for Ethiopia: patient registration, the queue, consultations, laboratory, pharmacy, stock and billing. It is provided by{" "}
            {LEGAL.provider || "the HMIS team"} (&ldquo;HMIS&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what personal data HMIS handles, why, where it is kept, who can
            see it, how long it is kept, and the rights people have over it.
          </p>
          <p>
            It covers this website, the HMIS cloud service that clinics use, the waiting-room screens, and the HMIS software installed on a clinic&apos;s own server. It is written to meet
            Ethiopia&apos;s Personal Data Protection Proclamation No. 1321/2024 (&ldquo;the Proclamation&rdquo;).
          </p>
        </>
      ),
    },
    {
      id: "roles",
      title: "Two kinds of data, two roles",
      body: (
        <>
          <p>
            <strong className="text-(--l-ink)">Patient records belong to the clinic.</strong> When a clinic records a patient in HMIS, the clinic decides why and how that data is used: under
            the Proclamation the clinic is the <em>data controller</em> and HMIS is its <em>data processor</em>. We handle patient records only to run HMIS for that clinic, on its
            instructions, as set out in our{" "}
            <Link href="/terms#data" className={docLink}>
              Terms of Service
            </Link>{" "}
            (which are the written processing agreement the Proclamation requires). Patients who have a question about their record should ask their clinic first; we help the clinic
            answer.
          </p>
          <p>
            <strong className="text-(--l-ink)">Our own records are ours.</strong> For the details of the clinics that ask for or use HMIS, the people who contact us, the clinics&apos;
            staff accounts and our billing, HMIS is the data controller.
          </p>
        </>
      ),
    },
    {
      id: "collect",
      title: "What we collect",
      body: (
        <>
          <LegalTable
            head={["Whose", "What", "Where it comes from"]}
            rows={[
              [
                "A clinic asking to use HMIS",
                "Clinic name, type, region, city and address, licence number, the contact person's name, phone and email, the chosen plan, staff count, how HMIS should run, the message, and the internet address the request came from.",
                "The request form on this website.",
              ],
              [
                "A clinic using HMIS",
                "The clinic's details, its subscription, invoices and payments (amount, method, reference; card and mobile-money details stay with the payment provider and never reach us).",
                "The clinic, our team, and the payment providers.",
              ],
              [
                "Clinic staff",
                "Full name, phone number (used to sign in), email if given, role, room, a scrambled form of the password (never the password itself), the two-step sign-in key, and the time and internet address of sign-ins and of each change they make.",
                "The clinic's administrator, and HMIS as it is used.",
              ],
              [
                "Patients",
                "Whatever the clinic records: identity and contact details, family links, visits, vital signs, consultation notes and diagnoses, laboratory results, prescriptions and dispensing, procedures, documents, charges, payments, credit companies and insurance. This is health data: the Proclamation treats it as sensitive.",
                "The clinic's staff.",
              ],
              ["Waiting-room screens", "Queue numbers, the doctor's name and room. Never a patient's name.", "The clinic's queue."],
              ["HMIS's own team", "Name, email, role, two-step sign-in key and a record of everything they do in the platform console.", "Our team."],
            ]}
          />
          <p>We do not collect more than HMIS needs to work, and we do not buy personal data from anyone.</p>
        </>
      ),
    },
    {
      id: "use",
      title: "How we use it",
      body: (
        <>
          <Bullets>
            <li>To run HMIS for each clinic: keep its records, show them to the staff whose role needs them, and keep everything working, safe and backed up.</li>
            <li>To review requests, set up clinics, invoice them, take payments and give support.</li>
            <li>To keep HMIS secure: sign-in checks, limits on repeated attempts, audit logs, and investigating misuse.</li>
            <li>To meet our legal duties, such as tax records and answering lawful requests from authorities.</li>
          </Bullets>
          <p>
            We rely on our agreement with the clinic, our legal obligations, and, where the law requires it, consent. Clinics process health data for medical treatment, which the
            Proclamation allows for a medical treatment institution (art. 9(2)(d)); they are responsible for any consent their own use needs.
          </p>
          <p>
            <strong className="text-(--l-ink)">What we never do:</strong> sell personal data; show advertising; use tracking or analytics services; build profiles of patients or staff;
            make automated decisions about people; or use one clinic&apos;s records for another clinic or for anything other than running HMIS for that clinic. Our team opens a
            clinic&apos;s patient records only when the clinic asks for help with them or the law requires it.
          </p>
        </>
      ),
    },
    {
      id: "where",
      title: "Where it is stored",
      body: (
        <>
          <p>
            Everything on the HMIS cloud, the live database and its backups, is stored on servers in Ethiopia, as article 22 of the Proclamation requires. We do not transfer personal data
            out of Ethiopia.
          </p>
          <p>
            A clinic that runs HMIS on <strong className="text-(--l-ink)">its own server</strong> keeps its records at the clinic. That server contacts the HMIS cloud only to check its
            licence (the clinic&apos;s name and subscription, no patient data) and, if the clinic chooses to keep a copy on the cloud, to send its records there.
          </p>
        </>
      ),
    },
    {
      id: "share",
      title: "Who we share it with",
      body: (
        <>
          <p>Only these service providers handle data for us, each under a written agreement and only for the purpose shown:</p>
          <LegalTable head={["Provider", "What it does", "Where"]} rows={LEGAL.subprocessors.map((s) => [s.name, s.does, s.where])} />
          <p>We tell clinics before we add or replace one, so they can object.</p>
          <p>
            Beyond them, we disclose personal data only when Ethiopian law requires it (for example a court order), and then only what is required; where we may, we tell the clinic first.
            If HMIS is sold or merged, the records go to the new provider only under this policy, and clinics are told beforehand.
          </p>
        </>
      ),
    },
    {
      id: "keep",
      title: "How long we keep it",
      body: (
        <LegalTable
          head={["What", "How long"]}
          rows={[
            ["A clinic's records (patients, visits, staff, its audit log)", "As long as the clinic uses HMIS. The clinic itself decides when to correct or remove a record, within the Ministry of Health's record-keeping rules."],
            [
              "After a clinic cancels",
              `Its records stay, read-only, for ${f.retentionDays} days so it can export them; then we delete them. Backups that still contain them expire within 90 days after that.`,
            ],
            ["A request that did not become a clinic", "Up to 2 years after we last spoke, then deleted."],
            ["Invoices and payment records", "As long as Ethiopian tax law requires."],
            ["Our team's console history", "As long as HMIS runs, to show who did what."],
          ]}
        />
      ),
    },
    {
      id: "security",
      title: "How we protect it",
      body: (
        <Bullets>
          <li>Each clinic&apos;s records are walled off from every other clinic&apos;s inside the database itself (row-level security), not only by the application.</li>
          <li>Staff see only what their role needs. Two-step sign-in with a phone app is available for every account and required for administrators and our own team.</li>
          <li>Every change to a patient&apos;s record, every export and every action of our team is recorded in an audit log.</li>
          <li>Connections are encrypted (HTTPS). The database is backed up regularly; backups are encrypted, stored in Ethiopia and test-restored.</li>
          <li>Passwords are stored only in scrambled form; repeated wrong sign-ins are slowed down; sessions end when a password changes.</li>
          <li>Only a few named members of our team can reach the servers, with their own accounts.</li>
        </Bullets>
      ),
    },
    {
      id: "breach",
      title: "If something goes wrong",
      body: (
        <p>
          If personal data is lost, exposed or changed without permission, we tell the affected clinic without delay, with what happened and what we are doing about it, so it can inform
          the Ethiopian Communications Authority and, where needed, its patients within the 72 hours the Proclamation sets (arts. 43–44). For our own records we notify them ourselves.
        </p>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <p>Under the Proclamation (arts. 24–32) you may:</p>
          <Bullets>
            <li>be told what data is held about you and how it is used, and get a copy;</li>
            <li>have wrong data corrected, and data deleted when there is no longer a reason to keep it;</li>
            <li>object to, or ask us to restrict, a use of your data;</li>
            <li>receive your data in a form you can take elsewhere;</li>
            <li>not be subject to decisions made only by a computer (HMIS makes none);</li>
            <li>withdraw a consent you gave, for what follows.</li>
          </Bullets>
          <p>
            <strong className="text-(--l-ink)">Patients:</strong> ask your clinic, which keeps your record and can give you a copy of it from HMIS. Medical records may have to be kept for a
            time by law even if you ask for them to be deleted. <strong className="text-(--l-ink)">Clinics, staff and others:</strong> write to us (below). We answer within 30 days and may
            ask you to prove who you are.
          </p>
          <p>
            You can also complain to the <strong className="text-(--l-ink)">Ethiopian Communications Authority</strong>, which enforces the Proclamation.
          </p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          Clinics treat children, so patient records include people under 16. The clinic obtains the consent of a parent or guardian where the law requires it (art. 11). This website and
          the HMIS accounts are not meant for children.
        </p>
      ),
    },
    {
      id: "cookies",
      title: "Cookies and what the browser keeps",
      body: (
        <>
          <p>HMIS uses only cookies it needs to work. There are no advertising, analytics or third-party cookies, so there is nothing to opt out of.</p>
          <LegalTable
            head={["Name", "What it is for", "How long"]}
            rows={[
              ["hmis_token", "Keeps a member of staff signed in.", "12 hours, or until sign-out"],
              ["hmis_challenge", "Carries the sign-in from the password to the two-step code.", "5 minutes"],
              ["hmis_staff_browser", "Remembers that staff sign in on this browser, so it opens the sign-in page. Says nothing about who.", "1 year"],
              ["hmis_lang", "The language chosen (English or Amharic).", "1 year"],
              ["hmis_display", "The waiting-room screen's own key.", "1 year, or until the screen is removed"],
              ["hmis_platform, hmis_platform_challenge", "Signs in HMIS's own team to the platform console.", "8 hours / 5 minutes"],
            ]}
          />
          <p>
            For working through internet cuts, the browser also keeps the signed-in person&apos;s working day and the work waiting to be sent; it is removed at sign-out (work not yet sent
            stays until it is sent) and replaced when someone else signs in on that computer. A waiting-room screen remembers whether its voice calls are on.
          </p>
        </>
      ),
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: (
        <p>
          When we change this policy we change its date and version above. If a change matters to how clinics&apos; or patients&apos; data is handled, we tell clinics at least 30 days before
          it applies.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <>
          <p>Questions, requests about your data, or a concern about privacy:</p>
          <ContactBlock facts={f} />
        </>
      ),
    },
  ];
}

export function privacySummaryEn(facts: LegalFacts) {
  return (
      <>
        <strong className="text-(--l-ink)">In short:</strong> clinics own their patients&apos; records; we keep them only to run HMIS for that clinic. Everything is stored in Ethiopia,
        walled off clinic by clinic, and logged. We never sell data, show ads or track you. A clinic can export everything at any time, and after it leaves we delete its records{" "}
        {days(facts.retentionDays, "")} later.
      </>
  );
}
