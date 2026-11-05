# HMIS: clinic management system

Multi-tenant, offline-first clinic management system for Ethiopian private clinics (with their in-house pharmacy and lab). See [the startup plan](Hospital%20Management%20System%20Startup%20Plan.md) for scope and roadmap.

## Structure

| Path | What |
| --- | --- |
| `apps/web` | Staff web app: Next.js, React, TypeScript, Tailwind |
| `apps/api` | Backend API: NestJS |
| `packages/db` | PostgreSQL schema and migrations (Prisma), shared by the API |
| `docker-compose.yml` | Local PostgreSQL 17 and Redis 7 |

## First-time setup

Requires Node.js, pnpm and Docker Desktop.

```sh
cp .env.example .env
cp .env.example packages/db/.env
cp .env.example apps/api/.env
pnpm install                    # also generates and builds the Prisma client
pnpm db:up                      # start Postgres + Redis (Docker Desktop must be running)
pnpm db:migrate                 # create tables
pnpm db:app-role                # let the API's restricted database role log in
pnpm db:seed                    # demo clinic, admin user, sample drugs/tests
pnpm dev                        # web on :3000, api on :4000
```

Open `http://localhost:3000` and sign in with one of the demo accounts:

| Role | Phone | Password |
| --- | --- | --- |
| Admin | `0911000000` | `admin123` |
| Doctor | `0911000001` | `doctor123` |
| Receptionist | `0911000002` | `reception123` |
| Pharmacist | `0911000003` | `pharmacy123` |
| Cashier | `0911000004` | `cashier123` |
| Lab technician | `0911000005` | `lab123` |

`pnpm db:seed` is safe to re-run: it only adds missing staff, services, lab tests and drugs (with stock).

The waiting-room TV screen is at `http://localhost:3000/display` (sign in once on that screen as the receptionist). It shows only queue numbers and doctor names, never patient names. Check the API is talking to the database: `http://localhost:4000/health`.

## Tests

```sh
pnpm --filter api test:e2e
```

The end-to-end tests run against a separate `hmis_test` database (create it once with `docker exec hmis-postgres-1 psql -U hmis -c "CREATE DATABASE hmis_test"`). They apply migrations but never wipe data; each run creates its own clinics and random phone numbers.

## API so far

| Endpoint | Who | What |
| --- | --- | --- |
| `POST /auth/login` | anyone | Phone + password → token (12 h). Any phone format works: `09…`, `+2519…`, `9…` |
| `GET /auth/me` | signed in | Current user and facility |
| `GET /patients?q=` | signed in | Search by MRN, phone, or name words (English or Amharic) |
| `GET /patients/:id` | signed in | Patient with family members and visit history |
| `POST /patients` | admin, reception, nurse, doctor | Register; MRN assigned automatically per facility; age or exact birth date; `relativeId` links a family |
| `GET/POST /users`, `PATCH /users/:id` | admin | Staff accounts, roles, deactivation |
| `POST /visits` | admin, reception, nurse | Check in: next queue number for the day, optional doctor, consultation fee charged automatically, optional `appointmentId` |
| `GET /queue?day=&doctorId=` | signed in | The day's queue (default today, Addis Ababa time) |
| `PATCH /visits/:id/status` | doctor, nurse, admin (front desk: cancel only) | Waiting → with doctor → lab / pharmacy → done. Cancelling drops uninvoiced charges |
| `GET /appointments?day=` or `?patientId=` | signed in | A day's appointments, or a patient's upcoming ones |
| `POST /appointments`, `PATCH /appointments/:id` | admin, reception, nurse, doctor | Book; mark cancelled or no-show |
| `GET /lookups/doctors`, `/lookups/services` | signed in | Dropdown lists |
| `GET /visits/:id` | admin, doctor, nurse | Consultation record with the patient's last 5 completed visits |
| `PATCH /visits/:id` | doctor (all fields), nurse (vitals + chief complaint) | Vitals and clinical notes; locked once the visit is completed |
| `POST /visits/:id/diagnoses`, `DELETE /visits/:id/diagnoses/:diagnosisId` | doctor | ICD-11 diagnoses; exactly one is primary |
| `GET /icd11?q=` | admin, doctor, nurse | Search the common-diagnosis starter list (English, Amharic, code) |

| `GET /drugs?q=` | admin, doctor, nurse, pharmacist | Drug search with usable (non-expired) stock |
| `GET/POST /visits/:id/prescriptions`, `POST /prescriptions/:id/cancel` | doctor prescribes and cancels; pharmacist reads | Allergy, interaction and duplicate checks; see below |
| `GET /pharmacy/queue` | pharmacist, admin | Prescriptions waiting, oldest first, plus today's dispensed |
| `POST /prescriptions/:id/dispense` | pharmacist, admin | First-expiry-first-out from non-expired batches, all-or-nothing; logs stock movements and charges the visit |

| `GET /billing/pending` | cashier, admin | Visits with unbilled charges |
| `POST /invoices`, `GET /invoices?day=&status=&patientId=`, `GET /invoices/:id` | cashier, admin | Invoice all unbilled charges of a visit (patient, credit company or insurer); discounts are admin-only and need a reason |
| `POST /invoices/:id/payments` | cashier, admin | Cash, Telebirr, Chapa, bank; partial payments; a transaction reference is required for non-cash and can only be used once |
| `POST /invoices/:id/void` | admin | Unpaid invoices only, with a reason; charges return to "to bill" |
| `GET /billing/daily?day=`, `POST /billing/closings` | cashier, admin | Takings by cashier and method; each cashier closes their own drawer once a day (expected vs counted cash), after which they can't take more payments that day |

| `POST /prescriptions/:id/bill` | pharmacist, admin | Pay-first: send units to the cashier as charges before dispensing |
| `GET /lab/tests`, `GET/POST /visits/:id/lab-orders`, `POST /lab-orders/:id/cancel` | doctor orders and cancels (before the sample); clinical staff and lab read | Each paid test creates a charge |
| `GET /lab/worklist`, `POST /lab-orders/:id/collect`, `/result`, `/verify` | lab technician, admin | Sample → result (numeric results flagged H/L against the range; qualitative tests take one of their answers) → verified. Clinicians only see values once verified |
| `GET /visits/:id/lab-report` | clinical staff, lab | Verified results for printing (`/lab-report/<visit id>`) |
| `GET /settings`, `PATCH /settings` (admin) | signed in / admin | Clinic name, phone, address and the pay-first switch |
| `GET /inventory?filter=low\|expiring\|expired\|inactive&q=` | pharmacist, admin | Usable stock, expiring (90 days) and expired quantities, stock value at cost, low-stock flags |
| `POST /drugs`, `PATCH /drugs/:id`, `GET /drugs/:id/stock` | pharmacist, admin | Drug list (price changes audited old → new); batches and stock history |
| `POST /inventory/receipts` | pharmacist, admin | Receive a delivery (supplier, delivery note, batch, expiry, cost); warns when cost is above the selling price |
| `POST /inventory/adjustments` | pharmacist, admin | Damaged, lost, returned or count correction, with a reason; never below zero |
| `POST /inventory/expired/write-off` | pharmacist, admin | Zero all expired batches and record the loss |
| `GET/POST /suppliers`, `PATCH /suppliers/:id` | pharmacist, admin | Supplier list (phone, contact, TIN) |
| `GET/POST /catalog/services`, `PATCH /catalog/services/:id`, same for `/catalog/lab-tests` | admin | Prices and lab test catalogue; price changes audited |
| `GET /reports/dashboard?from=&to=` | admin | Visits, waiting time, money collected by method, delivered-but-unbilled services, patient and insurer balances, top diagnoses, lab, pharmacy, stock value and losses, daily trend (max one year) |
| `GET /reports/moh-monthly?ecYear=&ecMonth=` | admin | Monthly OPD report for an Ethiopian calendar month: visits by age group and sex, new vs repeat, top 10 primary diagnoses by sex, malaria tests and positives. CSV download at `/reports/moh/csv?y=&m=` |

The MoH report's age bands and indicators are a first version; confirm them against the Regional Health Bureau's current reporting form (and DHIS2 data set) before submitting.

Printable receipts (sized for 80 mm thermal printers) are at `/receipt/<invoice id>`.

**Pay before service** (on by default, Settings → Payment). The doctor can't call a patient in until the consultation fee is paid; the lab can't take a sample until the test is paid; the pharmacist sends the drugs to the cashier and can then dispense only what was paid. Charges billed to a credit company or insurer count as settled, and free tests and drugs (price 0) never wait for the cashier. With the switch off, everything is billed at the end of the visit.

**Prescribing safety.** An allergy match (by drug name or class, so "Penicillin" catches amoxicillin) blocks the prescription until the doctor confirms and writes a reason. A known interaction or duplicate therapy needs confirmation. Accepted alerts and the reason are stored with the prescription and shown to the pharmacist. The interaction list in `apps/api/src/prescriptions/drug-safety.ts` is a small starter set of well-established pairs, not a full interaction database: have the clinical advisor review and extend it.

Clinical content (complaints, notes, diagnoses) is only returned to admins, doctors and nurses. The audit log records which fields changed, never their content.

The ICD-11 starter list is in `apps/api/src/consultation/icd11-common.ts`. Have the clinical advisor check it against the [WHO ICD-11 browser](https://icd.who.int/browse/2024-01/mms/en) and add the clinic's own top diagnoses; doctors can also enter any code by hand.
| `GET /health` | anyone | API and database status |

## MVP modules (from the plan)

1. Patient registration
2. Appointments and queue
3. EMR (OPD visits, vitals, ICD-11 diagnoses)
4. E-prescription
5. Lab orders and results
6. Pharmacy and inventory (batches, expiry, FEFO)
7. Billing and cashier (cash, Telebirr, Chapa, bank; credit and insurance)
8. Users, roles and audit log
9. Dashboard and reports

The database schema for all nine is in place in `packages/db/prisma/schema.prisma`. The API and UI are built module by module. Done so far: users and roles (8, without the audit log viewer), patient registration (1), appointments and queue (2, without SMS reminders, which need an SMS provider account), the consultation record (3), e-prescription (4), pharmacy and inventory (6, without purchase orders and stock transfers), billing and cashier (7), the lab (5, without SMS results or analyser integration), and dashboard and reports (9). All nine MVP modules now have a first version.

To check a production build while `pnpm dev` is running, build into a separate folder: `NEXT_DIST_DIR=.next-check pnpm --filter web build`.

## Clinic isolation (row-level security)

Two independent walls keep each clinic's data private:

1. **The API** filters every query by the signed-in user's clinic.
2. **PostgreSQL row-level security.** The API connects as `hmis_app` (`APP_DATABASE_URL`), a role that does not own the tables, so policies apply to it. Every query runs in a transaction that first sets `app.tenant_id` to the request's clinic; rows of other clinics are invisible and can't be written, including child rows (charges, diagnoses, prescription items, stock batches and movements) through their parent. With no clinic set, nothing is visible.

The owner connection (`DATABASE_URL`) bypasses RLS and is used only for migrations, the seed, tests' own setup, and sign-in (looking up a phone number before the clinic is known). If `APP_DATABASE_URL` is missing the API falls back to the owner connection and logs a warning; don't run like that in production. The e2e tests run the API as `hmis_app`, and `test/rls.e2e-spec.ts` checks the database wall on its own, with no filter in the queries.

## Conventions

- Every tenant-owned row carries `tenantId`, and API queries always filter by it, even though row-level security would also catch a missing filter.
- Money is `Decimal(12,2)` in ETB. Never use floats for money.
- Every billable action (consultation, lab order, dispensing) creates a `Charge` automatically.
- Writes that matter (create/void/dispense/payment) are recorded in `AuditLog`.
