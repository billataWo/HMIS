# HMIS as a service

For the HMIS team. HMIS is sold as a subscription. Clinics ask for it on a public page, the team
approves them in the **platform console**, and each clinic pays per plan: a monthly or yearly
invoice, plus VAT.

| How a clinic runs HMIS | Where its subscription is kept and enforced |
|---|---|
| **HMIS cloud** | In the cloud database, directly |
| **Clinic server, synced to the cloud** | In the cloud; the clinic server fetches its signed licence every hour |
| **Own server only** | In the cloud, for billing; a signed licence file installed on the server |

## Setting up the HMIS cloud

The cloud server is installed like any server ([installing a server](../install/README.md)).
When the installer asks whether this is the cloud, answer **yes**. It then sets
`HMIS_PLATFORM=1` and creates the first operator (you), owner of the console. Then:

**On AletCloud** (no installer and no shell), set these in the app's environment variables
instead. Saving them rebuilds the app:
- `HMIS_PLATFORM=1`: turns on the console, the plans, `/request` and the front page.
- `HMIS_PUBLIC_URL=https://hmis.app.aletcloud.com`: where payers come back to.
- `HMIS_FIRST_OPERATOR_EMAIL` (and `HMIS_FIRST_OPERATOR_NAME`): at the next start, if there are no
  operators yet, this one is created as owner. Its temporary password is in the app logs under
  "FIRST SIGN-IN". Until that owner has signed in, every start logs a new one (an older one stops
  working), so restart the app if you missed it. Sign in, then remove the variable.
- Lost passwords (no shell to run `reset`): `HMIS_RESET_OPERATOR_EMAIL=<operator email>` or
  `HMIS_RESET_CLINIC_ADMIN=<admin phone, or a clinic's name if it has one admin>`. Each start then
  logs a temporary password under "PASSWORD RESET" (two-step sign-in is kept) until that person
  signs in; with no single match, the log lists who there is. Remove the variable afterwards.
  Changing variables during a deploy can start two copies of the app, each logging a password:
  only the last one written works.
- Backups: `HMIS_BACKUP_RECIPIENT` and a bucket turn on the nightly encrypted backup
  ([docs/backup](../backup/README.md#app-hosting-aletcloud-the-nightly-backup)). Without it,
  `HMIS_BACKUPS_MANAGED_BY` names the host's own database backups instead of a warning.
- `HMIS_LICENCE_PRIVATE_KEY`: the whole key as `keygen` prints it, from `-----BEGIN PRIVATE KEY-----`
  to `-----END PRIVATE KEY-----`, with the `\n`s, without the quotes. See Licences.

Then:

1. Sign in at `https://<cloud address>/platform/login` with the temporary password. Choose your
   own password (12+ characters) and set up two-step sign-in: every operator must.
2. **Settings**: the free trial length, the grace period, VAT, the bank account clinics pay into
   (shown on every open invoice), and the support phone and email.
3. **Plans**: three suggested plans (Basic, Standard, Hospital) come with it. Set the real
   names, prices, staff limits and modules.
4. **Operators**: add the rest of the team:
   - **Support** handles requests and looks at clinics;
   - **Billing** also handles subscriptions, invoices and payments;
   - **Owner** can do everything, including plans, prices, operators and settings.

The public pages:
- `https://<cloud address>/welcome`, the front page for clinics that do not use HMIS yet: what it
  does, how it runs, privacy, the plans and prices (from **Plans**, with the trial length, VAT and
  support contacts from **Settings**), and common questions. Visitors who are not signed in and
  open the cloud's address arrive here. Browsers that clinic staff have signed in on go straight
  to the sign-in instead.
- `https://<cloud address>/request`, the request form. Each plan's button on the front page opens
  it with that plan chosen (`/request?plan=STANDARD`).

The front page describes only what HMIS does now; keep it that way when its text changes
(`apps/web/src/app/welcome/page.tsx`).

## A clinic, from request to paying customer

1. **Request.** The clinic fills in `/request`: name, place, licence number, contact, the plan
   and how it wants to run HMIS. It gets a reference such as `R-13FC6C`.
2. **Approve** (Requests). Call the clinic first to check the details. The page warns when a
   clinic with a similar name or the same phone already exists. Approving does four things:
   - creates the clinic and its first admin;
   - adds the starter price list;
   - starts the free trial;
   - shows the admin's temporary password once. Give it to them by phone or in person.

   At the first sign-in, the admin chooses a password and sets up two-step sign-in.
3. **Invoice.** It is issued automatically, 10 days before the trial or paid period ends
   (Settings: on or off, and how many days before). Clinics HMIS suspended or cancelled, clinics
   with no end date, and clinics whose last invoice HMIS voided are left alone. *Issue the next
   invoice* on the clinic's page does it by hand. Either way:
   - the period follows on from the trial, or from the last paid period;
   - VAT is added;
   - the clinic admin sees it under Settings → Subscription, with the ways to pay.
4. **Payment.**
   - **Online**: *Pay with telebirr* or *Pay with Chapa* (cards, telebirr, CBE Birr, M-Pesa,
     bank accounts). The payment counts as soon as HMIS has asked the provider itself and it
     says it is paid; the clinic works normally again within seconds. Nothing to confirm by hand.
   - **Bank transfer**: the clinic pays and reports the transaction number. Check the bank
     statement, then **confirm** it (Overview → *Payments to confirm*), or mark it *not received*.
   - Money received some other way (cash, a transfer they did not report) is recorded on the
     invoice with *Record a payment*.
   - A fully paid invoice moves the clinic's paid-until date to the end of the period.

## The subscription's states

| State | What the clinic can do | When |
|---|---|---|
| **Trial** | Everything | Until the trial ends |
| **Active** | Everything | Until the end of the paid period ("no end date" for a free clinic) |
| **Overdue** | Everything; admins see a warning with the days left | During the grace period (14 days by default) after the end |
| **Suspended** | Read-only: look up and print records, pay the bill. Nothing new can be saved | After the grace period; or suspended by HMIS by hand |
| **Cancelled** | Read-only | Cancelled by HMIS; open invoices are voided |

No job needs to run for this: the state follows from the dates at every request. Paying a
suspended clinic's invoice makes it work again within seconds. If a clinic was suspended for a
long time, its next invoice starts on the day it is issued: read-only months are not charged.

Changing a plan's staff limit or modules applies to all its clinics at once. A price change
applies from their next invoice. A module missing from a clinic's plan cannot be *changed*
(records already made can still be looked at). The modules are:
- **Credit & insurance**: credit companies and insurers;
- **Purchase orders**;
- **Clinic server**: used by the licences.

A staff limit stops new staff accounts and reactivations, never existing ones.

Clinics created before subscriptions existed (and the Demo Clinic) have the Hospital plan with no
end date. Nothing changed for them until HMIS agrees a plan with them.

## Online payment (Chapa and telebirr)

Turned on in the cloud's environment (the keys never go in the database): `deploy/.env` and then
`sudo deploy/hmis up` on its own server, or the app's environment variables on AletCloud. Settings in the console shows which are on.

- `HMIS_PUBLIC_URL`: the cloud's address, e.g. `https://hmis.example.et` (the installer sets it).
  Payers and payment reports come back there.
- **Chapa**: `CHAPA_SECRET_KEY` from the Chapa dashboard. Also set the dashboard's webhook URL to
  `<HMIS_PUBLIC_URL>/public/payments/chapa/webhook` and its secret as `CHAPA_WEBHOOK_SECRET`.
  Test first with Chapa's test key (`CHASECK_TEST-…`): no real money moves.
- **telebirr** (H5 web checkout, from the telebirr merchant agreement): `TELEBIRR_API_URL`,
  `TELEBIRR_WEB_URL`, `TELEBIRR_FABRIC_APP_ID`, `TELEBIRR_APP_SECRET`, `TELEBIRR_MERCHANT_APP_ID`,
  `TELEBIRR_MERCHANT_CODE`, `TELEBIRR_PRIVATE_KEY` (the merchant key registered with telebirr), and
  `TELEBIRR_PUBLIC_KEY` (telebirr's, to check its notifications).
  - **Before going live, pay one invoice in telebirr's sandbox.** The request signing follows
    telebirr's merchant guide (RSA-PSS), but has only been tested against a stand-in, not
    telebirr itself.
  - If the sandbox uses its own certificate, give Node its authority with
    `NODE_EXTRA_CA_CERTS`. Never switch certificate checks off.

**How a payment is confirmed:**
- The provider's word arrives in up to four ways: the payer coming back, Chapa's callback,
  the webhook (signed), and telebirr's notification (signed). Each one only makes HMIS **ask the
  provider itself**. A forged notification, or a made-up address typed by the payer, cannot
  mark an invoice paid.
- What counts is what the provider says was paid, in birr. Less than the invoice is a part
  payment; the next checkout asks only for the rest.
- Each checkout is recorded once, however many confirmations arrive.
- When nobody comes back, the server asks again every five minutes for a day.
- If an invoice was paid another way, or voided, while the clinic was paying online, the money
  shows on the Overview under **Paid online, not applied**: refund it, or record it on another
  invoice.

## Licences (clinic servers and own-server installs)

A licence is one line of text signed by HMIS. It names the clinic, its plan (staff limit and
modules), its trial or paid-until date and the grace period. The server applies it exactly like
the cloud applies a subscription: trial, active, overdue, then read-only. It works without
internet until its dates run out. A changed or forged licence is refused, and so is an older
licence than the one installed.

**The licence keys** (created 2026-11-11): HMIS's public key is built into
`apps/api/src/licence/public-key.ts`, so every server checks licences against it. The private
key is only in the HMIS cloud's environment, as `HMIS_LICENCE_PRIVATE_KEY` on one line (as
`keygen` prints it), with a printed copy in the safe: whoever has it can issue licences.
- On the cloud's own server: in `deploy/.env`, then `sudo deploy/hmis up`.
- On AletCloud: in the app's environment variables (saving them rebuilds the app).

Console → Settings then shows "Licences: can be issued". If the private key is not the pair of
the built-in public key, it says so and issues no licence, since every server would refuse it.

If the private key is lost or leaked: run `node apps/api/dist/licence/cli.js keygen` on an
offline computer, put the new public key into `public-key.ts` and the new private key into the
cloud, and update every server. An updated server no longer accepts licences signed with the old
key, so issue new ones: clinic servers fetch theirs within the hour; own-server installs need a
new file.

**A clinic server synced to the cloud** fetches a fresh licence every hour with its sync token. A
payment in the cloud, a plan change or a suspension reaches it within the hour. The clinic's
admins pay HMIS's invoices in the cloud (Settings → Subscription there); the clinic server's page
links to it.

**An own-server install:**
1. The request is approved with "Own server only".
2. On the clinic's page in the console, *Download the licence file* and give it to the
   technician.
3. The installer asks for it ("Does HMIS bill this clinic?" → yes, then the file). It creates the
   clinic with the same id as in the cloud, and installs the licence.
4. After each payment, download a new licence and send it to the clinic. Their admin installs
   it in Settings → Subscription, or a technician runs `sudo deploy/hmis licence install <file>`.

A clinic with no end date (free) gets a licence for a year at a time.

Servers installed with "HMIS bills this clinic" have `HMIS_LICENCE=required`: without a valid
licence they are read-only, with a banner saying so. Other servers (your own development, servers
installed before licences) are not limited. `sudo deploy/hmis licence status` shows what a server
has.

## Data export, and closing an account

**A patient's record** (the right of access and data portability, Proclamation 1321/2024): an
admin opens the patient and chooses **Export record**. That gives a JSON file with the patient's
details, visits, vital signs, notes, diagnoses, prescriptions, lab results, documents,
appointments and bills. It is in the clinic's audit log.

**All of a clinic's records:** Settings → **Your data**, by an admin, with the password asked
again.
- A compressed file (`.ndjson.gz`, JSON lines) with every record of the clinic, in the format
  clinic servers are copied with.
- It works even when the clinic is read-only or cancelled: a clinic that leaves can always
  take its data.
- Staff password hashes and two-step keys are never in it.
- Every export is in the audit log, and the console shows when the clinic last exported.

**Moving a clinic to another HMIS server** (e.g. from the cloud to its own server):
1. Install the new server.
2. Run `sudo deploy/hmis clinic import <file>`.
3. Then `deploy/hmis clinic reset-admin <phone>` gives the admin a new password, and the admin
   gives the others theirs.

**Deleting a cancelled clinic's records** (console → the clinic, Owner only):
1. The subscription must be cancelled, and the clinic has **60 days** to export its data
   (Settings → *Days a cancelled clinic has to export its records*).
2. After that, type the clinic's name to confirm.
3. Deleted: every patient, visit, bill, stock record, staff account and audit entry of the
   clinic, and its waiting-room screens.
4. Kept: the clinic's name, its subscription and HMIS's invoices (HMIS's own accounts).
5. Its clinic servers are disconnected first. The deletion runs as that clinic under row-level
   security, and refuses to run if any table it would empty lacks it.
6. History records who deleted what.

The records still exist in the backups until those expire:
- 14 days for the point-in-time copies;
- the monthly archives and the off-site copy, as set in the backup guide.

Tell the clinic so in the data processing agreement.

## Security

- Operators are not clinic staff. They sign in at `/platform` with their own email and
  password, and two-step sign-in is required. Their sessions are signed with a separate key, so
  neither kind of sign-in works on the other side.
- Every action in the console is in **History**, with the operator and their address: approvals,
  plan changes, suspensions, invoices, payments and sign-ins.
- The console and the request page exist only where `HMIS_PLATFORM=1` (the cloud). Clinic servers
  do not have them.
- Subscriptions, invoices and requests are never sent between clinic servers and the cloud. A
  clinic sees only its own invoices (row-level security).
- Operators can see every clinic's subscription, but not its patients: the console shows only
  counts.

## Commands on the cloud server

| `sudo deploy/hmis …` | |
|---|---|
| `platform add-operator --name "…" --email … --role OWNER\|BILLING\|SUPPORT` | Another operator (also possible in the console) |
| `platform list` | The operators |
| `platform reset <email>` | Lost phone or password: a temporary password, and two-step sign-in set up again |
| `clinic create … --plan BASIC [--trial-days 30]` | A clinic without a request (usually approve a request instead) |

## Still to do before selling

- Pay one invoice in telebirr's sandbox (see Online payment).
- Have a lawyer review the Terms of Service (`/terms`, which include the data processing
  agreement of art. 16) and the Privacy Policy (`/privacy`), and fill in the provider's details in
  `apps/web/src/lib/legal.ts` (legal name, address, registrations). Change `version` there whenever
  either document changes: each request records the version it accepted.
- Register with the Ethiopian Communications Authority as controller and processor (Proclamation
  No. 1321/2024, art. 33).
