import Link from "next/link";
import { Bullets, ContactBlock, docLink, type LegalFacts } from "@/components/legal";
import { LEGAL, providerName } from "@/lib/legal";


const n = (v: number | null, unit: string, otherwise: string) => (v === null ? otherwise : `${v} ${unit}`);

/** The Terms of Service in English (the version that applies). */
export function termsSectionsEn(f: LegalFacts) {
  const us = LEGAL.provider || "HMIS";
  return [
    {
      id: "agreement",
      title: "The agreement",
      body: (
        <>
          <p>
            These terms are the agreement between {LEGAL.provider ? <strong className="text-(--l-ink)">{LEGAL.provider}</strong> : "the provider of HMIS"} (&ldquo;HMIS&rdquo;,
            &ldquo;we&rdquo;) and the clinic, pharmacy or hospital that uses HMIS (&ldquo;the clinic&rdquo;, &ldquo;you&rdquo;). The clinic accepts them when it asks to use HMIS, and
            again by using it. The person who accepts confirms they may bind the clinic.
          </p>
          <p>
            Our{" "}
            <Link href="/privacy" className={docLink}>
              Privacy Policy
            </Link>{" "}
            is part of these terms. Where these terms and a signed agreement between us differ, the signed agreement applies.
          </p>
        </>
      ),
    },
    {
      id: "service",
      title: "The service",
      body: (
        <>
          <p>
            HMIS is software for running a clinic: registration and the queue, consultations, laboratory, pharmacy and stock, billing, credit and insurance, reports, and waiting-room
            screens. A clinic uses it in one of three ways:
          </p>
          <Bullets>
            <li>
              <strong className="text-(--l-ink)">On the HMIS cloud</strong>, which we run and keep up to date;
            </li>
            <li>
              <strong className="text-(--l-ink)">On its own server with a copy on the cloud</strong>; or
            </li>
            <li>
              <strong className="text-(--l-ink)">On its own server only</strong>, where the records stay at the clinic.
            </li>
          </Bullets>
          <p>What each plan includes (staff accounts and optional modules) is shown on the plans page and in the clinic&apos;s account.</p>
        </>
      ),
    },
    {
      id: "start",
      title: "Getting started and the free trial",
      body: (
        <p>
          A clinic asks to use HMIS on the request page; we review the request, may call to confirm it, and either set the clinic up or explain why we cannot. A new clinic starts with a
          free trial of {n(f.trialDays, "days", "the length shown when it asks")}. No payment is taken during the trial; at its end the clinic receives its first invoice.
        </p>
      ),
    },
    {
      id: "accounts",
      title: "Accounts and sign-in",
      body: (
        <Bullets>
          <li>The clinic&apos;s administrator creates an account for each member of staff, with the role their work needs. Accounts are personal: never share one.</li>
          <li>Keep passwords and the two-step sign-in phone safe. Administrators must use two-step sign-in.</li>
          <li>Remove or deactivate the account of anyone who leaves, the same day.</li>
          <li>Tell us at once if you think someone has used an account without permission.</li>
          <li>The clinic is responsible for what is done with its accounts.</li>
        </Bullets>
      ),
    },
    {
      id: "clinic",
      title: "What the clinic is responsible for",
      body: (
        <Bullets>
          <li>Having the right to record each patient&apos;s data, and any consent the law requires, including a parent&apos;s or guardian&apos;s for patients under 16.</li>
          <li>
            Meeting its own duties as data controller under Proclamation No. 1321/2024, including registering with the Ethiopian Communications Authority, answering patients&apos; requests
            about their data, and reporting breaches.
          </li>
          <li>Following the Ministry of Health&apos;s rules on medical records, and its professional licences.</li>
          <li>The accuracy of what its staff record, and training them to use HMIS.</li>
          <li>Its own computers, printers, screens and internet connection; and, for a clinic&apos;s own server, the server, its room, its power and its backup disks.</li>
        </Bullets>
      ),
    },
    {
      id: "clinical",
      title: "Clinical decisions stay with clinicians",
      body: (
        <p>
          HMIS keeps records and organises work; it does not diagnose or treat. Anything it points out (an abnormal vital sign, a stock level, a possible duplicate patient) is a reminder,
          not advice. Doctors, nurses, laboratory staff and pharmacists remain responsible for every clinical decision, and for checking doses and results themselves.
        </p>
      ),
    },
    {
      id: "use",
      title: "Acceptable use",
      body: (
        <>
          <p>The clinic and its staff must not:</p>
          <Bullets>
            <li>use HMIS for anything unlawful, or record data they have no right to record;</li>
            <li>look at records their work does not need;</li>
            <li>try to get around sign-in, roles, plan limits or the licence, copy or alter the software, or reverse-engineer it;</li>
            <li>test HMIS&apos;s security without our written permission, or put a heavy load on it on purpose;</li>
            <li>upload harmful files, or let anyone outside the clinic use it.</li>
          </Bullets>
        </>
      ),
    },
    {
      id: "fees",
      title: "Plans, fees and payment",
      body: (
        <Bullets>
          <li>
            Fees are those of the clinic&apos;s plan, monthly or yearly, as shown on the plans page, plus VAT{f.vatPercent !== null ? ` (${f.vatPercent}%)` : ""} and any other tax the law
            requires.
          </li>
          <li>We send each invoice before its period starts. Clinics pay by Chapa, telebirr or bank transfer; a bank transfer counts as paid when we confirm it arrived.</li>
          <li>
            An invoice not paid by its due date leaves a grace period of {n(f.graceDays, "days", "the length shown in the account")}. After that the clinic&apos;s HMIS becomes{" "}
            <strong className="text-(--l-ink)">read-only</strong> until it is paid: nothing is deleted, and everything can still be seen and exported.
          </li>
          <li>
            <strong className="text-(--l-ink)">No refunds once a period has started.</strong> Cancelling stops the next invoice; the period already paid runs to its end. The free trial is
            there to try HMIS first. This does not limit any refund Ethiopian law requires.
          </li>
          <li>We may change prices with at least 30 days&apos; notice; a new price applies from the clinic&apos;s next period, not one already paid.</li>
          <li>A clinic may change plan at any time; a new plan&apos;s limits and modules apply straight away, and its price from the next invoice.</li>
        </Bullets>
      ),
    },
    {
      id: "data",
      title: "Patient data: our commitments as processor",
      body: (
        <>
          <p>
            <strong className="text-(--l-ink)">The clinic owns its records.</strong> It can export one patient&apos;s record or the whole clinic at any time. These commitments are the
            written processing agreement required by article 16 of Proclamation No. 1321/2024. HMIS:
          </p>
          <Bullets>
            <li>processes the clinic&apos;s records only to provide HMIS to it, on its instructions (these terms and its use of HMIS), and for no other purpose;</li>
            <li>stores them in Ethiopia and does not transfer them abroad;</li>
            <li>lets only team members who need to, and who are bound to confidentiality, reach them, and only to help the clinic or as the law requires;</li>
            <li>protects them as described in the Privacy Policy;</li>
            <li>uses only the service providers listed in the Privacy Policy, under written agreements as strict as these, and tells the clinic before adding or replacing one;</li>
            <li>helps the clinic answer patients&apos; requests and meet its own duties under the Proclamation;</li>
            <li>tells the clinic without delay of any breach affecting its records, with what is known, so it can notify the Authority within 72 hours;</li>
            <li>at the end, lets the clinic export its records and then deletes them (see &ldquo;Ending&rdquo;), unless the law requires us to keep them;</li>
            <li>gives the clinic, on request, the information it needs to check we keep these commitments.</li>
          </Bullets>
        </>
      ),
    },
    {
      id: "availability",
      title: "Availability and support",
      body: (
        <>
          <p>
            We work to keep the HMIS cloud available at all times, back it up regularly, and fix problems quickly, but we cannot promise it will never be interrupted: maintenance, internet
            cuts and events beyond our control happen. Screens already open keep working through a short loss of connection and send their changes when it is back. A clinic that cannot
            rely on its internet should run HMIS on its own server.
          </p>
          <p>
            We improve HMIS over time. We do not remove a feature a clinic&apos;s plan includes without telling the clinic in advance. Support is given by phone and email during working
            hours.
          </p>
        </>
      ),
    },
    {
      id: "server",
      title: "Clinics on their own server",
      body: (
        <Bullets>
          <li>
            We grant the clinic a licence to use HMIS on its server for as long as its subscription is paid. The server checks its licence with the HMIS cloud regularly; without a valid
            licence it becomes read-only.
          </li>
          <li>The licence is for that clinic only. Do not copy it, share it or change it.</li>
          <li>The clinic looks after the server, its physical security and its backup disks. We help set it up and keep the software up to date.</li>
        </Bullets>
      ),
    },
    {
      id: "ending",
      title: "Ending",
      body: (
        <>
          <p>
            The clinic may cancel at any time; HMIS keeps working until the end of the period paid. We may suspend a clinic for unpaid invoices after the grace period, or at once for a
            serious breach of these terms or to stop a security risk; we may end the agreement for a breach not put right within 30 days of our notice.
          </p>
          <p>
            After cancellation the clinic&apos;s records stay available, read-only, for <strong className="text-(--l-ink)">{f.retentionDays} days</strong> so it can export them. Then we delete
            them; backups containing them expire within 90 days. Invoices and payment records are kept as tax law requires.
          </p>
        </>
      ),
    },
    {
      id: "ip",
      title: "Ownership of the software",
      body: (
        <p>
          HMIS, its design and its code belong to {us}. The clinic receives the right to use it for its own work while these terms apply; nothing else passes to it. Suggestions a clinic
          makes may be used to improve HMIS without payment.
        </p>
      ),
    },
    {
      id: "confidential",
      title: "Confidentiality",
      body: (
        <p>
          Each side keeps confidential what it learns about the other&apos;s business (prices agreed, plans, security details), uses it only for this agreement, and shares it only when the
          law requires. Patient data is covered by the commitments above.
        </p>
      ),
    },
    {
      id: "liability",
      title: "Liability",
      body: (
        <Bullets>
          <li>Apart from what these terms promise, HMIS is provided as it is, without other warranties.</li>
          <li>Neither side is liable for lost profits, lost business or other indirect losses.</li>
          <li>Our total liability under this agreement in any 12 months is limited to the fees the clinic paid us in those 12 months.</li>
          <li>Nothing in these terms limits liability for fraud, for harm caused on purpose or by gross negligence, or anything else the law does not allow to be limited.</li>
          <li>The clinic is responsible for claims that arise from what it records or from breaking these terms.</li>
        </Bullets>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: (
        <p>
          We may change these terms. We tell clinics at least 30 days before a change applies, and change the date and version above. A clinic that does not accept a change may cancel
          before it applies, without paying for any period after that.
        </p>
      ),
    },
    {
      id: "law",
      title: "Law and disputes",
      body: (
        <p>
          These terms are governed by the laws of the Federal Democratic Republic of Ethiopia. We will first try to settle any dispute by talking, for at least 30 days; if that fails, the
          competent courts in Addis Ababa decide.
        </p>
      ),
    },
    {
      id: "language",
      title: "Language",
      body: (
        <p>These terms and the Privacy Policy are published in English and in Amharic. If the two versions differ, the English version applies.</p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <>
          <p>Notices to {providerName === "HMIS" ? "us" : providerName}:</p>
          <ContactBlock facts={f} />
          <p>We send notices to the clinic&apos;s contact phone and email in its account, and in HMIS itself.</p>
        </>
      ),
    },
  ];
}

export function termsSummaryEn() {
  return (
      <>
        <strong className="text-(--l-ink)">In short:</strong> you pay for your plan, we run HMIS and look after your data on your instructions, in Ethiopia. Your records are yours to
        export at any time. Clinical decisions stay with your clinicians. If an invoice goes unpaid past the grace period, HMIS becomes read-only (nothing is deleted). Paid periods are
        not refunded; the free trial is there to try first.
      </>
  );
}
