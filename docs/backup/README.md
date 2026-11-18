# HMIS backups

How HMIS protects clinic data against disk failure, mistakes, theft, fire and ransomware: how it
works, how to set it up, and what it does for Ethiopia's Personal Data Protection Proclamation
No. 1321/2024. For recovering from a problem, see [RESTORE.md](RESTORE.md).

All clinic data lives in PostgreSQL (patients, visits, results, invoices, stock, audit log); the
app stores no files of its own. Backing up the database therefore backs up everything.

## Targets

| | Target | How |
|---|---|---|
| Data that can be lost (RPO) | about 1 minute | Every change (WAL) is archived to the backup disk at least once a minute |
| Time to recover (RTO) | under 1 hour | Measured every week by the restore test and shown in Settings → Backups |
| Point-in-time restore | any moment in the last 14 days | Full + differential + incremental backups plus continuous WAL |
| Off-site history | 90 days of versions, the last 30 locked | S3 object lock (WORM) |
| Long-term | monthly archive, 10 years (configurable) | Encrypted `pg_dump`, readable by any future PostgreSQL |

## How it works

```
 clinic server                                                     second site in Ethiopia
┌─────────────────────────────────────────────────────────┐       ┌─────────────────────────┐
│  disk A: PostgreSQL ──WAL every ≤60 s──┐                │       │ S3 storage, object lock │
│                                        ▼                │ every │ (versioned, COMPLIANCE) │
│  disk B: /backup/pgbackrest  (encrypted, AES-256)  ─────┼──5 min┼─▶ pgbackrest/<site>/... │
│          /backup/archive     (monthly, age-encrypted) ──┼───────┼─▶ archive/<site>/...    │
│                                                         │       └─────────────────────────┘
│  backup worker: schedules, restore tests, verification, │
│                 health checks, alerts, status records   │──▶ Telegram / email / heartbeat
└─────────────────────────────────────────────────────────┘
```

- **3-2-1**: three copies (the live database, the backup disk, off-site), on two kinds of storage
  (local disk and object storage), one of them at another site.
- **Automatic**: a full backup weekly, a differential nightly (01:00), an incremental every hour,
  and continuous WAL archiving in between. The schedule is decided from what is actually in the
  repository, so a server that was switched off catches up instead of skipping.
- **Encrypted**: every file in the repository is AES-256 encrypted by pgBackRest before it is
  written, so the off-site provider only ever holds ciphertext. The monthly archive is encrypted
  to a public key ([age](https://age-encryption.org)) whose private key is kept off the server.
- **Immutable (WORM)**: the off-site bucket uses S3 object lock in COMPLIANCE mode. Deleting or
  overwriting a file only adds a new version; locked versions cannot be removed by anyone,
  including the storage administrator, until the lock expires. Each site's storage key can add
  files and mark them deleted, but cannot delete versions, shorten locks or see other sites.
- **Independent of the internet**: WAL goes to the local backup disk immediately; the off-site
  copy catches up whenever the link is up. An internet outage never fills the database disk.
- **Tested**: every week the latest backup is restored into a throw-away database, every table
  and index is checked for corruption (`pg_amcheck --heapallindexed`), the data is compared with
  the live database, and the recovery time is recorded. Once a month the same test runs from the
  off-site copy. Every week every file in the repository is re-read and checked against its
  checksum (`pgbackrest verify`).
- **Watched**: problems are sent by Telegram and/or email (once when they start, every 6 hours
  while they last, once when resolved). An outside heartbeat monitor raises the alarm if the
  server goes completely silent. Clinic admins see the status in **Settings → Backups**, and a red
  banner across the app when something needs action.

The pieces, all in [`deploy/`](../../deploy):

| File | What it is |
|---|---|
| `compose.yml` | The database (`db`), the backup worker (`backup`) and the disaster-recovery tool (`restore`) |
| `postgres/Dockerfile` | PostgreSQL 17 with pgBackRest, rclone and age |
| `postgres/pgbackrest.conf` | Repository, encryption, retention, compression |
| `postgres/scripts/` | `hmis-backup` (the command), the jobs, the restore script |
| `offsite/` | A self-hosted MinIO off-site store and the script that locks the bucket and issues site keys |

The backup worker writes every event to `BackupEvent` (read-only for the app) and to
`/backup/state/events.log`. Events that happen while the database is down are kept and written
later, including restores.

## Setting up a server

You need: a Linux server, a **second physical disk** for backups, and a storage key for the
off-site bucket (see below). Allow the backup disk about 3× the database size plus the monthly
archives. The backups are part of every HMIS server: the [installer](../install/README.md) sets
them up along with the rest.

1. Mount the backup disk, e.g. at `/mnt/backup` (encrypted:
   [disk encryption](../security/disk-encryption.md), step 3).
2. `sudo bash deploy/hmis install` asks for the backup disk and writes `deploy/.env`, including
   a random `BACKUP_ENCRYPTION_KEY`. **Without this key the backups cannot be read.** Print it,
   seal it, keep one copy in the clinic's safe and one with the support team. Then fill in, in
   `deploy/.env`:
   - The `OFFSITE_S3_*` values and `OFFSITE_LOCATION` from the off-site setup below.
   - `BACKUP_ARCHIVE_RECIPIENT`: on an offline computer, `age-keygen -o hmis-archive.key`; put the
     printed public key (`age1…`) here. Keep `hmis-archive.key` on two USB sticks (safe + support
     team), never on the server.
   - Alerts: `ALERT_TELEGRAM_*` and/or `ALERT_SMTP_URL` + `ALERT_EMAIL_*`, and
     `BACKUP_HEARTBEAT_URL` from your heartbeat monitor (set it to expect a ping every hour,
     with a 3-hour grace period).
3. `sudo deploy/hmis up` (re)starts everything with these settings.
4. Within a few minutes: `docker compose exec backup hmis-backup status` shows the first full
   backup and the first restore test; Settings → Backups shows them too.
5. Put a UPS on the server. PostgreSQL survives a power cut, but disks do not like many of them.

The development `docker-compose.yml` at the repository root has no backups on purpose.

### Off-site storage

Use S3-compatible object storage **located in Ethiopia** (art. 22 of the Proclamation), either
from a provider or self-hosted at a second site with [`deploy/offsite`](../../deploy/offsite).

Whatever the provider, the bucket must have:

- **Object lock enabled** (this also turns on versioning), with a default retention of
  **COMPLIANCE, 30 days**.
- A lifecycle rule deleting **noncurrent versions after 90 days**, and one expiring current
  objects under `archive/` after the long-term period (e.g. 10 years).
- One **key per server**, limited to `pgbackrest/<site>/*` and `archive/<site>/*`, allowed to
  list, read, write and delete objects (a delete only adds a marker), but **not** to delete object
  versions, bypass governance, or change the bucket's lock, versioning or lifecycle settings.
- HTTPS.

Self-hosted (on the second-site server):

```sh
cd deploy/offsite
printf 'MINIO_ROOT_USER=admin\nMINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -base64 30)" > .env
docker compose up -d minio
docker compose run --rm admin bucket                  # lock + lifecycle rules (safe to re-run)
docker compose run --rm admin site demo-clinic        # prints the OFFSITE_S3_* lines for that clinic
```

Put MinIO behind TLS before using it over the internet, and keep the root password off the clinic
servers. The default image (`bitnamilegacy/minio`) is a frozen build; for long-term production use
a maintained MinIO build or another S3 server that supports object lock (`MINIO_IMAGE=` in `.env`).

### Cloud deployment (many clinics on one server)

The same stack: the backup disk is a separate volume, the off-site bucket is in a second data
centre. One backup covers every clinic on the server; restoring one clinic's data without rolling
back the others is done by restoring into a separate database and copying that clinic's rows
(ask for help: it is a careful, manual job).

### App hosting (AletCloud): the nightly backup

App hosting with a managed database has no server to run this stack on (no pgBackRest, no WAL
archiving, no shell). There the API itself makes **one encrypted copy a night** and stores it in an
S3 bucket (`apps/api/src/backups/nightly.ts`):

- At `HMIS_BACKUP_HOUR` (default 2, server time), or soon after a start when tonight's copy is
  missing, every table is read in one consistent snapshot, gzipped and encrypted with
  [age](https://age-encryption.org) to `HMIS_BACKUP_RECIPIENT`, the **public** key of a key pair
  whose secret half is kept offline. The server can write copies but never read them.
- The copy is uploaded, read back and compared (SHA-256); a damaged upload is deleted and retried
  an hour later.
- Kept: every night for `HMIS_BACKUP_KEEP_DAYS` (30) days, then the first copy of each month for
  `HMIS_BACKUP_KEEP_MONTHS` (12) months. Older copies are deleted.
- Settings → Backups shows each copy, the check of the upload and when the last restore drill
  passed. A missed night is a warning, two missed nights a failure (banner for admins).

This is a smaller promise than the stack above: one copy a night (up to a day of work can be
lost), one storage provider, no object lock. Use it where nothing better can run.

Setting it up:

1. On a trusted computer (not the server), make the key pair:
   `node apps/api/dist/backups/cli.js keygen hmis-backup.key` (or `npx tsx src/backups/cli.ts
   keygen …` in `apps/api`). Keep `hmis-backup.key` offline in two places (e.g. two USB sticks in
   different places and the password manager). **Without it no copy can be read.**
2. Create a private bucket and an access key scoped to it (AletCloud: Object storage; the 5 GB tier
   is plenty for a database of a few hundred MB).
3. Set in the app's environment: `HMIS_BACKUP_RECIPIENT` (the printed `age1…` public key) and the
   bucket, either AletCloud's "connect to app" variables (`AWS_ENDPOINT_URL_S3`, `S3_BUCKET`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) or `HMIS_BACKUP_S3_ENDPOINT`,
   `HMIS_BACKUP_S3_BUCKET`, `HMIS_BACKUP_S3_ACCESS_KEY`, `HMIS_BACKUP_S3_SECRET_KEY`
   (`HMIS_BACKUP_S3_REGION`, `HMIS_BACKUP_S3_PREFIX` = `hmis-backups/`, `HMIS_BACKUP_SITE` to name
   it on the status page). Remove `HMIS_BACKUPS_MANAGED_BY`.
4. The backup needs one database connection of its own. On a small database (AletCloud's free
   plan: 10 connections, 3 reserved for the provider) keep `DB_POOL_MAX` at 3 or less: the API
   holds two pools of that size. A full database makes the backup wait and retry; if it stays
   full, Settings → Backups says "remaining connection slots are reserved" and it tries again an
   hour later.
5. After the restart, the first copy is made within a few minutes; check Settings → Backups.
6. Every few months, do a restore drill ([RESTORE.md](RESTORE.md#restoring-a-nightly-copy-app-hosting)).

## Everyday commands

Run in `deploy/` on the server.

| Command | What it does |
|---|---|
| `docker compose exec backup hmis-backup status` | Backups in the repository, off-site state, recent events |
| `docker compose exec backup hmis-backup now [full]` | Take a backup now (and copy it off-site) |
| `docker compose exec backup hmis-backup restore-test [offsite]` | Run a restore test now |
| `docker compose exec backup hmis-backup verify` | Check every backup file's checksum now |
| `docker compose exec backup hmis-backup archive` | Make the long-term archive now |
| `docker compose logs -f backup` | Follow what the worker is doing |

Take a full backup by hand before an upgrade, a migration or moving the server.

## What to do when an alert arrives

| Alert | Likely cause | Action |
|---|---|---|
| Backup failed | Backup disk full or unmounted, database down | `hmis-backup status`, `df -h`, `docker compose logs backup` |
| WAL archiving is failing | Backup disk full/unmounted, wrong encryption key | Fix quickly: the database disk fills while WAL waits |
| Off-site copy not updated | Internet down, key revoked, bucket full | Usually catches up by itself; check the link and `OFFSITE_*` |
| Restore test failed | A real problem with the backups | Read `/backup/state/restore-test-failed.log`; take a full backup; investigate the same day |
| Verification found problems | Failing backup disk, tampering | Replace the disk; take a full backup; check the off-site copy |
| Heartbeat monitor alarm | Whole server or worker down | Check the server |

## Privacy and compliance (Proclamation No. 1321/2024)

This is what the backup system does towards the Proclamation; it is not legal advice. Have the
clinic's data-protection lead confirm the retention periods and the Ministry of Health's record
keeping rules.

| Requirement | What HMIS does |
|---|---|
| Storage in Ethiopia (art. 22): personal data collected locally is stored on servers in Ethiopia; transferring sensitive (health) data abroad needs the Authority's approval | Off-site storage must be in Ethiopia; its location (`OFFSITE_LOCATION`) is recorded with every off-site copy and shown on the status page. No backup goes anywhere else. |
| Security of processing (art. 17(4)): encryption; confidentiality, integrity, availability and resilience; restoring access in a timely manner; regularly testing the measures | AES-256 encryption of every backup, keys held separately from the data; checksums verified weekly; object lock against deletion and ransomware; RPO ≈ 1 minute, RTO measured weekly; automatic restore tests weekly (local) and monthly (off-site). |
| Records of processing (art. 46): logging of processing operations, including transfers | Every backup, off-site copy, restore test, verification, archive and **restore** is recorded with time, result and location in `BackupEvent` and the server's event log. The application cannot alter these records. |
| Breach notification within 72 hours (arts. 43–44) | Alerts reach the support team within minutes. A lost or stolen backup disk or off-site key is a possible breach: the encryption is what lets you assess the risk; record what happened and decide on notification within 72 hours. |
| Retention and destruction (arts. 6, 15, 50) | Backups expire automatically: 14 days on the backup disk, 90 days of off-site versions, archives after the configured period. Expired data is deleted by pgBackRest and by the bucket's lifecycle rules. Destroy retired disks physically or by secure erase. |
| Erasure requests (art. 28) | A record erased from the live database stays in backups until they expire (at most the periods above); it is not restored into the live system unless the whole database is restored, in which case the erasure is applied again. Keep a list of erasures for that reason. |
| Least privilege | The database container never holds off-site keys; the backup worker reads the database files read-only; each server's off-site key sees only its own folder and cannot delete history; the archive's private key is offline. |

Sources: the [Proclamation's text (English)](https://www.metaappz.com/References/ethiopian_laws/federal/pr_1321_2024/en/txt).
