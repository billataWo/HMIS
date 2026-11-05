# Hospital Management System Startup Plan

Nov 5, 2026 · @Bill

Start with private clinics (plus their in-house pharmacy and lab), win 3–5 pilots, then expand to hospitals. Many Ethiopian clinics, pharmacies and mid-size hospitals still run on paper, Excel or old desktop software. The biggest risk is not technology: it is trying to build everything for everyone at once.

## 1. Start narrow, then expand

A complete hospital system covers dozens of modules. Building all of them first means two years without a paying customer. Pick one segment to start:

| Segment | Why | Difficulty |
| --- | --- | --- |
| Pharmacies | Simple workflow (stock, sales, expiry), thousands of them, fast decisions, obvious pain: stockouts, expired drugs, cash leakage | Easiest |
| Private clinics (general, dental, maternal, specialty) | Adds patient records, appointments, lab and billing | Medium |
| Hospitals | Long sales cycles, complex workflows, procurement processes; approach once you have proof and references | Hardest |

**Recommendation:** launch with clinics plus their in-house pharmacy and lab. That one product already holds the core of a hospital system, and each clinic you sign becomes a reference for larger customers.

Before writing code, interview 20–30 facility owners, doctors, cashiers and pharmacists. Ask what wastes their time and what loses them money. The rest of this plan should come from those answers.

## 2. Real problems the system must solve

The product wins if it fixes these, not if it has the most features.

| Area | Problem today |
| --- | --- |
| Patient records | Paper cards get lost; doctors can't see a patient's history |
| Queues | Patients wait for hours with no appointment or queue system |
| Revenue leakage | Services are delivered but never billed; cash goes missing |
| Pharmacy | Drugs expire on the shelf, stock runs out unexpectedly, no batch tracking |
| Lab | Results are handwritten, delayed or lost |
| Insurance | Claims to the Ethiopian Health Insurance Service (CBHI/SHI) and private insurers are slow and error-prone |
| Reporting | Monthly reports to the MoH and Regional Health Bureau are compiled by hand |
| Infrastructure | Unstable internet and power outages |

## 3. Features by module

Build the nine core modules for the MVP; everything else waits for paying customers.

### Core (MVP)

1. **Patient registration:** unique medical record number, search by phone number, family linking, Amharic and English names.
2. **Appointments and queue:** booking, walk-in queue, waiting-room display, SMS reminders.
3. **Electronic medical record (OPD):** vitals, complaints, diagnosis with ICD-11 codes, clinical notes, templates for common cases, full visit history.
4. **E-prescription:** prescriptions go straight to the pharmacy, with drug-interaction and allergy alerts.
5. **Lab:** doctor orders, sample tracking, result entry with normal ranges, printable or SMS results.
6. **Pharmacy and inventory:** batch and expiry tracking, first-expiry-first-out dispensing, reorder alerts, suppliers and purchase orders, stock transfers.
7. **Billing and cashier:** every service creates a charge automatically; cash, Telebirr, Chapa and bank payments; credit and insurance patients; daily cash closing; receipts.
8. **Users and roles:** each role (doctor, nurse, cashier, pharmacist, admin) sees only what it needs; full audit log of who did what.
9. **Dashboard and reports:** daily revenue, patient counts, top diagnoses, stock value, MoH/HMIS reports generated automatically.

### Phase 2

- Inpatient management: admissions, wards and beds, nursing charts, discharge summaries
- Radiology and imaging
- Insurance claim management
- Multi-branch support for clinic chains
- Integration with DHIS2, the national health reporting system
- Lab machine integration (HL7), so results flow in automatically

### Phase 3

- Patient mobile app: booking, results, payments, reminders
- Telemedicine
- HR, payroll and staff scheduling
- Analytics and AI assistance, such as forecasting drug demand

## 4. Architecture and technology

Build a multi-tenant, offline-first SaaS on a TypeScript stack: Next.js, NestJS and PostgreSQL, with Flutter for mobile.

| Layer | Recommendation |
| --- | --- |
| Web app (staff) | Next.js + React + TypeScript, Tailwind, shadcn/ui |
| Backend | NestJS (TypeScript), REST or tRPC; modular structure from day one |
| Database | PostgreSQL, with Prisma or Drizzle as the ORM |
| Mobile | Flutter (patient app, doctor app) |
| Cache and queues | Redis, BullMQ (SMS, reports, sync jobs) |
| Offline support | Local-first sync with IndexedDB/SQLite (look at PowerSync or ElectricSQL) |
| Files | S3-compatible storage for lab PDFs and images |
| Infrastructure | Docker; local cloud or data center for data residency, with backups |
| Monitoring | Sentry, plus uptime monitoring |

### Key decisions

- **Multi-tenant SaaS.** One system serves many facilities, each facility's data strictly isolated (a tenant ID on every table, plus PostgreSQL row-level security).
- **Offline-first.** A major differentiator in Ethiopia: the clinic keeps working when the internet drops and syncs when it returns. Large hospitals get an on-premise local server that syncs to the cloud.
- **Standards.** HL7 FHIR for data exchange, ICD-11 for diagnoses, LOINC for lab tests. This makes the product credible and ready to integrate with government and insurance systems.
- **Security.** Encryption, strong passwords or 2FA, audit logs, automatic backups. Comply with Ethiopia's Personal Data Protection Proclamation (2024) and check MoH requirements for digital health systems.
- **Localization.** Full Amharic interface, Ethiopian calendar alongside the Gregorian one, ETB currency.

## 5. Business model: how to sell it

Sell a monthly or yearly subscription per facility, in tiers, with setup fees and on-premise licenses as extra revenue.

### Subscription tiers

| Plan | Includes | Price level |
| --- | --- | --- |
| Pharmacy | Inventory and sales only | Low |
| Clinic | EMR, lab, pharmacy, billing | Medium |
| Hospital | All modules | Priced by number of beds or users |
| Add-ons | SMS bundles, extra branches, patient app | Per add-on |

### Other revenue

- **One-time setup fee** for installation, data migration and staff training.
- **Annual prepayment discount** (for example, pay for 10 months, get 12). This improves cash flow.
- **On-premise license plus yearly maintenance** for big hospitals or government facilities that want their own servers.

Set exact prices only after the customer interviews. Ask what facilities lose today to expired stock and missing cash, and price well below that so the system clearly pays for itself.

### Sales strategy

1. **Free pilots:** give 3–5 clinics free use for 2–3 months in exchange for feedback and testimonials.
2. **Direct, in-person sales:** healthcare buyers trust people more than ads. Visit facilities and demo live on their own workflow.
3. **Associations and networks:** pharmacy associations, private health facility associations, and medical suppliers who already visit every clinic and could partner with you.
4. **Referral rewards:** a free month for each new client an existing client brings.
5. **Local support as the selling point:** fast phone and Telegram support, onsite training, help with data migration. Open-source systems like OpenMRS are free, but they don't come with this.

## 6. Roadmap

&#91;embedded content: roadmap · 4 phases\]

Discovery, MVP and pilots take about 6–8 months together; paid plans start once the pilots are stable.

## 7. Team and risks

You can build the MVP yourself, but you will soon need three more people.

- **Clinical advisor:** a doctor or pharmacist who reviews workflows. Essential.
- **Salesperson** who knows the health sector.
- **Support and onboarding person.**

| Risk | Mitigation |
| --- | --- |
| Staff resistance to change | Keep the interface very simple; train staff well |
| Fear of data loss | Show customers your backups and offline mode |
| Legal and licensing requirements | Talk to the MoH and register the business properly early |
| Scope creep | Say "Phase 2" often |
