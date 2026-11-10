# HMIS security

How HMIS protects patient data, what was checked in the security review, and what the person
installing a server must still do. Related: [backups](../backup/README.md),
[clinic servers](../sync/README.md), [offline mode](../offline/README.md),
[installing a server](../install/README.md), [HMIS as a service](../saas/README.md).

## How it is protected

| Area | Protection |
|---|---|
| Separating clinics | Every query is filtered by clinic in the API, and PostgreSQL row-level security enforces it again on every clinic table (a test fails if a new table is left out). The API's normal database role cannot see another clinic's rows. |
| Sign-in | bcrypt-hashed passwords; temporary passwords must be replaced at first sign-in; unknown phone numbers take as long as known ones. **Two-step sign-in** (authenticator app codes, which work offline) is required for admins and optional for everyone else. Each code works once; wrong codes lock. There are one-time recovery codes for a lost phone, and another admin can reset it. |
| Guessing passwords | Wrong passwords are limited per account and address (5), per account from anywhere (20) and per address across accounts (30), each for 15 minutes. One person cannot lock a colleague out, and one password cannot be tried on every staff phone. |
| Sessions | 12-hour sign-in token in a cookie that scripts cannot read (httpOnly, SameSite, Secure over HTTPS). The account, role and clinic are checked again on every request: deactivating someone takes effect within 15 seconds. Changing or resetting a password ends every other sign-in of that account. |
| Permissions | Every endpoint has a role check; non-clinical staff see that a visit happened, not its complaint or diagnoses. |
| Waiting-room screen | It has its own key, paired once with a 6-digit code from Settings → Screens, which can read only queue numbers and doctors. It is never a staff sign-in, and it can be revoked. |
| Disks | Full-disk encryption on clinic servers (LUKS, unlocked by the TPM after a power cut) and PCs (BitLocker). The server check (`deploy/host-check.sh`) reports to Settings → Backups. See [disk encryption](disk-encryption.md). |
| Audit | Sign-ins (with address), failed attempts, lockouts and every change are in the audit log; the application cannot alter backup records. |
| Web pages | Content Security Policy (scripts, connections and frames only from the site itself), no framing by other sites, `nosniff`, `same-origin` referrers, HSTS over HTTPS. No raw HTML is ever inserted into pages; redirects stay on the site. |
| Server | Only HTTPS (Caddy, ports 80/443) is reachable; the web app, API and database are on a private network inside the server. The API connects as `hmis_owner` (owns the tables, not a superuser) and `hmis_app` (row-level security); the superuser's password is given only to the database and the backup worker. Secrets are generated at install, in a file only root can read. |
| Platform console (HMIS cloud) | HMIS staff (operators) sign in separately from clinics, with a session key of their own and two-step sign-in required; roles Owner / Billing / Support; every action in History. Operators see subscriptions and counts, never patients. A clinic sees only its own invoices. |
| Data export and deletion | A patient's record (Export record) and the whole clinic (Settings → Your data, password again) for data portability, audited, without staff sign-in secrets. Exports and deletions run only under row-level security and refuse otherwise. A cancelled clinic's records are deleted only after its export period, by an owner, confirmed by name. |
| Database queries | Parameterised everywhere; the few built from table names take them from the database catalogue, never from a request. |
| Backups | AES-256 encrypted, off-site copy write-once (object lock), restore tests weekly, archive key kept offline. |
| Clinic servers | Each has its own 256-bit token (stored hashed, revocable) that can only ever write its own clinic (row-level security). |
| Offline mode | Only listed requests can be replayed, only from the site itself, each applied once. A browser keeps only the signed-in person's working day, deletes it on sign-out and when the sign-in expires. |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities (November 2026). |

## Security review, November 2026

Fixed:
- **Password guessing.** It was limited only per phone number, so trying one password on many accounts was not stopped. It is now limited per address too, and one person can no longer lock a colleague out.
- **Old sign-ins.** They stayed valid after a password change or reset. Now they end.
- **Web security headers.** There were none, so other sites could frame HMIS (clickjacking). Headers are added.
- **Development database.** It was reachable from the whole network with a known password, along with an unused Redis with no password. It is now limited to the computer itself, and Redis is removed.
- **JWT secret.** A weak secret was accepted in production. The API now refuses to start with one.
- **Sign-in auditing.** Sign-ins were not in the audit log. Now they are.
- **Offline data.** Patient data stayed in the browser after the sign-in expired. It is now deleted.
- **Software banners.** The API and web app announced their server software. They no longer do.

## Review of HMIS as a service, November 2026

Of everything added for the service: the platform console, requests, subscriptions, online
payments, licences, data export and deletion, and hosting on AletCloud.

Fixed:
- **Visitor addresses on AletCloud.** The web app passed on the *first* address in
  `X-Forwarded-For`. Caddy replaces that header, but AletCloud's router adds to it, so a visitor
  could write any address there and get round the per-address limits on sign-in, two-step codes
  and requests. The web app now takes the address the nearest proxy added (the last one;
  `HMIS_PROXY_HOPS` if more than one proxy adds to it).
- **Payments and clinic servers on AletCloud.** With no Caddy in front, `/sync/*` and
  `/public/payments/*` reached the web app and failed, so clinic servers could not sync and
  Chapa's and telebirr's notifications were lost. The web app now passes them to the API
  unchanged, without the visitor's cookies.
- **Console passwords.** With a stolen console session, the current password (asked for to change
  it or to move two-step sign-in to another phone) could be guessed without limit. It now locks
  after 5 wrong tries, and each one is in History.
- **Tables without row-level security.** Exports, deletions and a new clinic server's first copy
  read every clinic table under row-level security. A future table added without it would have
  put every clinic's rows in one clinic's export. They now refuse to run if any such table exists.
- **Licence keys.** A private key that is not the pair of the built-in public key would have
  signed licences that every server refuses. The cloud now refuses to issue them, and Settings in
  the console says why.

Checked, and sound: operators' sessions (own key, two-step, ended by password change or
deactivation); roles on every console action; approvals and payments recorded once even when two
people act at once; payments counted only from the provider's own answer, in birr; webhook
signatures compared in constant time; clinics see only their own invoices and checkouts; the
application role cannot read the console's tables (operators, requests, checkouts, licences);
read-only clinics cannot change anything, offline replays included; exports leave out sign-in
secrets.

Accepted:
- **Own-server licences.** Whoever runs the server can change its clock or its database, so a
  licence there is an agreement more than a lock. Synced clinic servers get theirs from the cloud
  every hour.
- **Signing out of the console** ends the session in that browser; the session itself stays valid
  until it expires (8 hours). Changing the password ends every session.

## Before a server goes live (checklist)

- [ ] **Installed with `deploy/hmis install`** ([guide](../install/README.md)). This gives HTTPS
      through Caddy (which replaces `X-Forwarded-For` with the real address), random secrets,
      the database roles, and only ports 80/443 open. Never run the API or web app on their own
      ports in production.
- [ ] **HTTPS without warnings** on every PC and tablet: on a clinic server, each device trusts
      the server's certificate authority after checking its fingerprint. Staff never click past
      a certificate warning.
- [ ] **The backup encryption key** printed and stored away from the server, and the server's
      certificate authority copied to the keys USB stick.
- [ ] **Full-disk encryption** on clinic servers and on PCs used for offline mode
      ([how](disk-encryption.md)), checked daily with `deploy/host-check.sh`.
- [ ] **Two-step sign-in** set up by every admin (HMIS requires it at their first sign-in), and
      the recovery codes printed and kept safe.
- [ ] **The waiting-room screen** connected through Settings → Screens (never signed in as staff).
- [ ] **On a hosting platform instead of our own server** (AletCloud): HTTPS by the platform, and
      `HMIS_PROXY_HOPS` set if more than one proxy there adds to `X-Forwarded-For` (default 1).

## Still to do

- Clinic staff: the current password, asked for to change it and for two-step sign-in, can be
  guessed without limit by someone holding a stolen session (fixed for the console; the same
  limit is still to add for clinics).
- Before selling HMIS as a service: see [HMIS as a service](../saas/README.md#still-to-do-before-selling).

## Reporting a problem

If you find a security problem, tell the HMIS team privately first and do not post it publicly,
so clinics can be protected before it becomes known.
