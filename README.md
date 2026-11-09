# HMIS: clinic management system

Multi-tenant, offline-first clinic management system for Ethiopian private clinics (with their in-house pharmacy and lab). See [the startup plan](Hospital%20Management%20System%20Startup%20Plan.md) for scope and roadmap.

## Structure

| Path | What |
| --- | --- |
| `apps/web` | Staff web app: Next.js, React, TypeScript, Tailwind |
| `apps/api` | Backend API: NestJS |
| `packages/db` | PostgreSQL schema and migrations (Prisma), shared by the API |
| `docker-compose.yml` | Local PostgreSQL 17 for development (this computer only, no backups) |
| `deploy/` | The server: `hmis` (install and run), Compose file, app images, Caddy (HTTPS), database with automatic backups, the off-site WORM store |
| `docs/backup/` | Backup guide and the restore runbook |
| `docs/security/` | How patient data is protected, the security review, and the go-live checklist |

## First-time setup

Requires Node.js, pnpm and Docker Desktop.

```sh
cp .env.example .env
cp .env.example packages/db/.env
cp .env.example apps/api/.env
pnpm install                    # also generates and builds the Prisma client
pnpm db:up                      # start Postgres (Docker Desktop must be running)
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
| `POST /patients` | admin, reception, nurse; doctors too if Settings → "Doctors can register new patients" is on (everyone else can search and view) | Register; MRN assigned automatically per facility; age or exact birth date; `relativeId` links a family |
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
| `GET /settings`, `PATCH /settings` (admin) | signed in / admin | Clinic name, phone, address, the pay-first switch and whether doctors can register patients (off by default) |
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

**Patient flow between doctor, lab and pharmacy.**
- **Lab:** the doctor orders tests (Lab tests on the consultation screen), then sends the patient to the lab. The lab works from its worklist of ordered tests. When every result is verified, the queue shows "Results ready", and the doctor brings the patient back and reviews them.
- **Pharmacy:** the doctor writes a prescription and sends the patient to the pharmacy. The visit closes by itself once everything is dispensed.
- **Completing a visit:** this is refused while a lab result hasn't been verified, since an unseen result is a safety risk. Cancel tests whose sample was never taken. It's also refused while drugs are still to be collected; send the patient to the pharmacy instead.
- **Patient leaves the pharmacy without the drugs:** clinical staff can still close the visit from the queue with "Close: patient left".
- **Back to the doctor:** a patient at the lab or the pharmacy can be sent back to the doctor.
- **Buttons:** the queue and consultation screens only offer moves that will succeed, and explain why the others are unavailable.
- **Registration:** a likely duplicate (same phone, or same first and father's name) is shown before a new card is created; reception confirms if it's really a different person. Family members may share a phone.
- **Orders:** tests and prescriptions are ordered once the doctor has called the patient in.
- **Diagnosis:** a diagnosis is required before completing a visit or sending the patient to the pharmacy, since the visit record and the monthly MoH report depend on it. Sending to the lab doesn't need one.
- **Money owed:** the queue and the consultation screen show anything still to pay, such as procedures, so patients don't leave owing.
- **Pharmacy sales:** counter sales appear in the patient's history as "Pharmacy sale" and can't take consultation notes, diagnoses or orders.
- **Unfinished visits:** these stay at the top of the queue, marked "Open since …", until they're finished; for example, a fasting sample taken the next morning. A patient can have only one open visit. The waiting-room TV shows today's numbers only.
- **Refunds:** for a service the patient paid for but never received, an admin opens the invoice and removes that line. Examples: a test whose sample was never taken, drugs not handed over (refundable in part), or a consultation the patient left before. The linked test is cancelled or the drugs released, the invoice total drops, and any overpayment is recorded as a refund. Refunds come out of the day's takings and the cash drawer. Nothing is deleted: the line stays on the invoice, marked "removed and refunded", with the reason.
- **Uncollected prescriptions:** the pharmacist can close what's left of a prescription the patient won't collect. Unpaid drug charges drop off the cashier's list; paid but undelivered drugs must be refunded first.

**Prescribing safety.** An allergy match (by drug name or class, so "Penicillin" catches amoxicillin) blocks the prescription until the doctor confirms and writes a reason. A known interaction or duplicate therapy needs confirmation. Accepted alerts and the reason are stored with the prescription and shown to the pharmacist. The interaction list in `apps/api/src/prescriptions/drug-safety.ts` is a small starter set of well-established pairs, not a full interaction database: have the clinical advisor review and extend it.

Clinical content (complaints, notes, diagnoses) is only returned to admins, doctors and nurses. The audit log records which fields changed, never their content.

The ICD-11 starter list is in `apps/api/src/consultation/icd11-common.ts`. Have the clinical advisor check it against the [WHO ICD-11 browser](https://icd.who.int/browse/2024-01/mms/en) and add the clinic's own top diagnoses; doctors can also enter any code by hand.
| `PATCH /patients/:id` | front desk (all details); doctors and nurses (allergies) | Correct a patient's record; allergies feed the prescribing checks at once |
| `POST /auth/password` | signed in | Change your own password. Passwords set by an admin are temporary and must be changed at first sign-in |
| `GET/POST /visits/:id/procedures`, `DELETE …/:chargeId` | doctor, nurse, admin (cashier reads) | Procedures given in the visit (injection, dressing, ECG…); each creates its charge |
| `GET/POST /visits/:id/documents`, `GET /documents/:id` | doctor issues; clinical staff read | Medical (sick-leave) certificates and referral letters, printed at `/document/<id>` |
| `POST /pharmacy/walk-in` | pharmacist, admin | Over-the-counter sale to a customer who did not see a doctor; then cashier and dispense as usual |
| `GET/POST /payers`, `PATCH /payers/:id`, `GET /payers/:id/statement`, `POST /payers/:id/settlements` | cashier, admin (admin adds and edits) | Credit companies and insurers: balance, statement, one payment applied to the oldest invoices |
| `GET/POST /purchase-orders`, `PATCH /purchase-orders/:id`, `POST …/order`, `POST …/cancel` | pharmacist, admin | Purchase orders; deliveries received against an order (`purchaseOrderId` on receipts) fill it |
| `GET /inventory/batches`, `POST /inventory/counts` | pharmacist, admin | Stock count: counted batches are set to what's on the shelf; each difference is recorded |
| `GET /audit` | admin | Audit log with filters (day, staff member, area) |
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

## Servers

A clinic server or the cloud server is installed with `sudo bash deploy/hmis install` ([docs/install/README.md](docs/install/README.md)). [`deploy/compose.yml`](deploy/compose.yml) runs Caddy (HTTPS, the only way in), the web app, the API (as `hmis_owner`/`hmis_app`, never the database superuser), PostgreSQL and the backup worker. Migrations are applied automatically before the API starts. New clinics: `sudo deploy/hmis clinic create ...`.

On the HMIS cloud (`HMIS_PLATFORM=1`) HMIS runs as a service ([docs/saas/README.md](docs/saas/README.md)): clinics ask on `/request`, HMIS staff approve them and look after plans, subscriptions, invoices and payments in the platform console (`/platform`); a suspended clinic becomes read-only.

## Backups

Production runs the database from [`deploy/compose.yml`](deploy/compose.yml), with a backup worker beside it. The full guide is in [docs/backup/README.md](docs/backup/README.md), and disaster recovery in [docs/backup/RESTORE.md](docs/backup/RESTORE.md).

- **3-2-1:** the live database; an encrypted pgBackRest repository on a second disk; and a mirror in S3-compatible storage in Ethiopia with object lock (COMPLIANCE, so nobody can delete locked versions).
- **Automatic:** a full backup weekly, a differential nightly and an incremental hourly. WAL is archived at least every minute, which allows point-in-time restore over the last 14 days.
- **Long-term archive:** monthly, a `pg_dump` encrypted with age to an offline key.
- **Tested:** each week the latest backup is restored into a throw-away database and checked with `pg_amcheck`, and the repository is verified. Each month the same restore test runs from the off-site copy.
- **Alerts:** Telegram, email and a heartbeat URL.
- **In the app:** admins see **Settings → Backups** (`GET /backups/status`), and a banner when something is failing. The worker writes `BackupEvent` rows, which the app's database role can only read. Restores run on the server, never from the app.
- **Commands:** `pnpm backup:status`, `pnpm backup:now` and `pnpm backup:test`; they run `hmis-backup` in the backup container.

## Clinic servers and cloud sync

A clinic can work on its own server at the clinic (the **clinic server**), which keeps working without internet, while the cloud keeps a read-only copy that is updated within seconds whenever there is a connection. The operator guide is [docs/sync/README.md](docs/sync/README.md); the design is in [apps/api/src/sync/README.md](apps/api/src/sync/README.md).

- **Capture:** a trigger on every clinic table writes each change to `SyncOutbox`. This only happens on a clinic server with capture enabled.
- **Sending:** the API's sync agent (`SYNC_CLOUD_URL`, `SYNC_TOKEN`) sends changes in commit-safe order to the cloud's `/sync/push`. They stay queued while offline.
- **Applying:** the cloud applies changes as `hmis_app` under the clinic's row-level security, so a clinic server can only ever write its own clinic.
- **Read-only cloud copy:** while a clinic has a clinic server, its cloud copy refuses changes (`CLOUD_COPY_READ_ONLY`), but staff can still sign in there to look things up. Every page shows how fresh the copy is.
- **Setup and status:**
  - `sudo deploy/hmis sync …` (`node apps/api/dist/sync/cli.js` in the API container) handles tokens (on the cloud), and bootstrap, enable and status (on the clinic server).
  - Settings → Cloud sync shows the status in the app.
- **Rules for developers:**
  - A migration that adds a clinic table must call `SELECT hmis_sync_attach('Table')`; `test/sync.e2e-spec.ts` checks this.
  - Upgrade the cloud before the clinic servers.

## Browser offline mode

Cloud-hosted clinics keep working through an internet outage, each PC with the work it already had ([docs/offline/README.md](docs/offline/README.md)).

- **Preparing:** a service worker (`public/sw.js`) keeps the offline workspace (`/offline`) and shows it whenever a page can't load. While online, each PC keeps the signed-in person's working day in IndexedDB, refreshed every 3 minutes.
- **Working offline:** reception, doctor, cashier, lab and pharmacy work is queued with temporary ids for new records.
- **Sending:** when the connection returns, queued work is replayed in order through `/offline/replay`, which adds the sign-in and an `Idempotency-Key`. The API (`IdempotencyInterceptor`) applies each key once, so a resend after a lost reply never registers or charges twice.
- **Refusals:** the server's normal rules apply on replay. Anything refused lands in "Needs attention" with what to do.

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

**Sign-in security.** Each request re-checks the staff account, so deactivating someone or changing their role takes effect within about 15 seconds, not when their 12-hour sign-in expires. Five wrong passwords lock that phone number for 15 minutes. The lock is kept in the API's memory, so it's per server.

**Lab panels.** A test with components (CBC, urinalysis…) takes one result per component, each flagged against its own range. Define components in Settings → Prices, one per line: `name | unit | low-high | answer/answer`. The seeded ranges are common adult values; have the clinical advisor confirm them.

**Language.** English or Amharic, chosen per browser in the sidebar. Untranslated text stays in English, and the dictionary is in `apps/web/src/lib/i18n.ts`. So far the sidebar, Home, the queue and visit statuses are translated. Have a native speaker review new entries.

## UI conventions

- **Colours:** the primary colour is the `brand-*` scale (medical teal) and neutrals are `slate-*`, both defined in `apps/web/src/app/globals.css`. Change the brand scale there to re-theme the whole app. Light and dark mode follow the device setting.
- **Fonts:** Inter for Latin text, with Noto Sans Ethiopic for Amharic.
- **Components:** use the shared pieces in `apps/web/src/components/ui.tsx` (buttons, inputs, `Card`, `Badge`, `Notice`, `EmptyState`, `StatCard`, `PageHeader`) rather than one-off styles. Panels use the `surface` class. A size utility added after `inputClass` or `buttonClass` (such as `w-40` or `px-3 py-1 text-xs`) always wins.
- **Icons:** `lucide-react` outline icons, never emoji or text arrows. Icon-only buttons need an `aria-label`.
- **Motion:** use the `motion` library through `apps/web/src/components/motion.tsx`: page entrances, staggered lists and tiles, banners, the mobile menu, the active-page marker in the sidebar, and the waiting-room "now serving" pop. Keep it short (about 240 ms in, faster out) and only animate transform and opacity. Users with "reduce motion" turned on get no animation.
- **Allergies** always show with `AllergyAlert` (red, with an icon and a label), never colour alone.
- **Design guidance:** the UI UX Pro Max skill is installed in `.claude/skills/ui-ux-pro-max/` for Claude Code. Its search script needs Python 3, which isn't installed on this machine yet.
