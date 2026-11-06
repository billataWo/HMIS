# Restoring the HMIS database

For the support technician. A restore **replaces** the live database, so read this through once
before starting, and tell the clinic that HMIS will be unavailable (usually 10–60 minutes).

You need: shell access to the server, the `deploy/.env` file (it holds `BACKUP_ENCRYPTION_KEY`),
and for a new server the sealed copy of that key.

## 1. Decide what you are restoring to

| Situation | Restore |
|---|---|
| Data deleted or changed by mistake at a known time (e.g. 10:42) | `--time` a minute or two **before** it |
| Database disk failed or the database is corrupt | latest (no `--time`) |
| Server lost, stolen or burnt; backup disk gone | `--from offsite` onto a new server |
| Ransomware: files on the server encrypted, backups may be tampered with | `--from offsite --offsite-as-of` a moment **before** the attack |

If only a few records are affected, it may be better to restore into a separate database and
copy those records back, rather than rolling the whole clinic back (anything entered after the
restore point is lost). Ask before choosing.

Times are clinic time (Africa/Addis_Ababa) unless you add an offset.

## 2. Stop everything that writes to the database

```sh
cd deploy
# stop the API and web app first, however they are run, then:
docker compose stop backup db
```

## 3. Restore

```sh
# see the options
docker compose run --rm restore hmis-backup restore --help

# to a moment in time, from the backup disk
docker compose run --rm restore hmis-backup restore --time "2026-11-06 10:40"

# the latest state, from the backup disk
docker compose run --rm restore hmis-backup restore

# from the off-site copy (new server, or the backup disk is gone)
docker compose run --rm restore hmis-backup restore --from offsite

# from the off-site copy as it was before a ransomware attack, to a moment before it
docker compose run --rm restore hmis-backup restore --from offsite \
  --offsite-as-of "2026-11-05 22:00" --time "2026-11-05 21:30"
```

The script:

1. refuses to run while the database is up;
2. for `--from offsite`, downloads the off-site copy (with `--offsite-as-of`, the locked
   versions from that moment) and makes it the local repository (the previous local repository
   is kept beside it as `pgbackrest.before-restore-<time>`);
3. shows the backups it can see, and asks you to type `RESTORE`;
4. copies the current database files to `/backup/pre-restore/<time>` (nothing is thrown away);
5. restores, and records the restore (shown in Settings → Backups once everything is running).

## 4. Start and check

```sh
docker compose up -d db
docker compose logs -f db      # wait for "database system is ready to accept connections"
```

PostgreSQL replays the changes up to the target; with a `--time` it stops there and opens the
database. Then check with the clinic: the last patients registered, the last invoices, and that
what was lost is back (or that the mistake is gone).

```sh
docker compose up -d backup
# start the API and web app
docker compose exec backup hmis-backup now full    # a fresh full backup of the restored database
```

## 5. Afterwards

- Write down what happened, when, what was restored to, and who did it (the restore itself is
  already in the backup records).
- If personal data may have been exposed (stolen disk, stolen key, ransomware), the clinic must
  assess and, where required, notify the Authority and the patients **within 72 hours**
  (Proclamation 1321/2024 arts. 43–44).
- Once everyone is satisfied, delete `/backup/pre-restore/<time>` (it is an unencrypted copy of
  the database) and any `pgbackrest.before-restore-*` folder.
- If you restored to an earlier time, re-apply any erasure requests made after that time.

## If the restore fails

- **"cannot be read (wrong BACKUP_ENCRYPTION_KEY?)"**: the key in `.env` is not the one the
  backups were made with. Use the sealed copy.
- **"The database is running"**: `docker compose stop db`.
- **pgBackRest errors**: the old database files are untouched in `/backup/pre-restore/<time>`.
  Copy them back into the database volume to return to where you started, then call for help.
- **No usable local repository**: try `--from offsite`.
- **Off-site download fails**: check the internet link and the `OFFSITE_S3_*` settings; a
  provider console can also download the `pgbackrest/<site>/` folder into `/backup/pgbackrest`.

## Reading a long-term archive

The monthly archives (`hmis-YYYY-MM-DD.dump.age`) restore into any PostgreSQL version, on any
machine, with the private key from the safe:

```sh
sha256sum -c hmis-2026-11-01.dump.age.sha256    # the file is intact
age -d -i hmis-archive.key hmis-2026-11-01.dump.age > hmis.dump
createdb hmis_archive && pg_restore -d hmis_archive --no-owner hmis.dump
```

Delete the decrypted `hmis.dump` when done.
