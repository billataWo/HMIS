# HMIS security

How HMIS protects patient data, what was checked in the security review, and what the person
installing a server must still do. Related: [backups](../backup/README.md),
[clinic servers](../sync/README.md), [offline mode](../offline/README.md).

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

## Before a server goes live (checklist)

- [ ] **HTTPS only**, through a reverse proxy (e.g. Caddy) that *replaces* `X-Forwarded-For` with
      the real client address. The sign-in cookie, offline mode and HSTS all require HTTPS, and
      the password limits per address rely on that header.
- [ ] **Strong secrets**: `JWT_SECRET` of 48+ random characters (`openssl rand -base64 48`), unique
      database passwords, and the backup encryption key printed and stored away from the server.
- [ ] **Database roles**: the API must not connect as the PostgreSQL superuser. Use a separate
      owner role for migrations and the API's few cross-clinic lookups, keep the superuser for
      backups and administration only. (To be done in the server installation setup.)
- [ ] **Only the web app and `/sync/*` reachable from outside**: the API, PostgreSQL and backup
      storage stay on the server's private network.
- [ ] **Full-disk encryption** on clinic servers and on PCs used for offline mode
      ([how](disk-encryption.md)), checked daily with `deploy/host-check.sh`.
- [ ] **Two-step sign-in** set up by every admin (HMIS requires it at their first sign-in), and
      the recovery codes printed and kept safe.
- [ ] **The waiting-room screen** connected through Settings → Screens (never signed in as staff).
- [ ] Set `TRUSTED_PROXIES` when the web app runs on a different machine or container than the API.

## Still to do

- Separate database owner role (above), as part of the server installation.
- Patient and clinic data export for data-portability requests (Proclamation 1321/2024 art. 32).

## Reporting a problem

If you find a security problem, tell the HMIS team privately first and do not post it publicly,
so clinics can be protected before it becomes known.
