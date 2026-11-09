# Installing an HMIS server

For the technician setting up a clinic server or the HMIS cloud server. One command installs
everything; this guide covers what to prepare before it and what to do after it.

```
 PCs and tablets ──HTTPS──▶ Caddy ──▶ web app ──▶ API ──▶ PostgreSQL ◀── backup worker ──▶ backup disk
 (clinic network)          :80/:443                                                    └──▶ off-site copy
```

Only Caddy is reachable from the network (ports 80 and 443). The web app, the API and the database
are on a private network inside the server. The database listens only on the server itself.

| | Clinic server | Cloud server |
|---|---|---|
| Who opens it | Staff on the clinic's network | Anyone, over the internet |
| Address | The server's fixed IP on the clinic network, e.g. `192.168.1.10` | A domain, e.g. `hmis.example.et` |
| HTTPS certificate | The server's own certificate authority, trusted once on each PC and tablet | Public (Let's Encrypt), automatic |

## Before you start

- **Hardware (clinic server).** 4 cores, 8 GB RAM and a 256 GB SSD, plus a **second disk for
  backups**. It also needs TPM 2.0 (switched on in the BIOS) and a **UPS**.
- **Ubuntu Server 24.04 LTS**, installed with **full-disk encryption** (see
  [disk encryption](../security/disk-encryption.md), steps 1–3, which also prepare the backup disk
  at `/mnt/backup`).
- **A fixed address.** In the clinic's router, reserve the server's IP address (a DHCP
  reservation). Every PC opens HMIS at this address.
- **Cloud server:** a domain whose DNS points at the server, and ports 80 and 443 open to the
  internet.
- **The off-site storage and alerts** from the [backup guide](../backup/README.md) (these can be
  added after installing).

## Install

1. Copy HMIS to the server, e.g. `/opt/hmis` (`git clone`, or from a USB stick).
2. Run:
   ```sh
   sudo bash /opt/hmis/deploy/hmis install
   ```
   It installs Docker if needed and asks for the address, the server's name and the backup disk.
   It then:
   - writes `deploy/.env` with fresh random secrets (readable by root only);
   - builds and starts everything;
   - schedules the daily disk-encryption check;
   - offers to create the clinic and its first admin.

   The admin's temporary password is shown once. At their first sign-in, the admin chooses their
   own password and sets up two-step sign-in.
3. **Print the backup encryption key** it shows, and put it in the clinic's sealed envelope with
   the other keys ([keys and recovery](../security/disk-encryption.md#keys-and-recovery)). Without
   it the backups cannot be read.
4. Fill in the off-site storage and alerts in `deploy/.env` ([backup guide](../backup/README.md),
   step 2). Then run `sudo deploy/hmis up`.
5. On a clinic server, make each PC and tablet trust the server (below).
6. Work through the [go-live checklist](../security/README.md#before-a-server-goes-live-checklist).

The install can be re-run safely: it keeps `deploy/.env`.

**The HMIS cloud**: answer "yes" to the first question. The installer then sets up the
platform console and its first operator instead of a clinic ([HMIS as a service](../saas/README.md)).

**A clinic server that works with the cloud** ([clinic servers](../sync/README.md)): answer "no"
when the installer offers to create the clinic. Put `SYNC_CLOUD_URL` and `SYNC_TOKEN` in
`deploy/.env`, run `sudo deploy/hmis up`, then copy the clinic down with
`sudo deploy/hmis sync bootstrap`.

## Trust the server (clinic server, each PC and tablet)

A clinic server makes its own HTTPS certificates. Each PC and tablet must trust its
certificate authority once. Until then, the browser shows "Your connection is not private": tell
staff never to click past that warning.

The installer prints the authority's **fingerprint** (`sudo deploy/hmis ca-cert` shows it
again). Check it on each device before trusting the file.

**Windows (Chrome, Edge).**
1. Open `http://<server address>/hmis-ca.crt` and save the file, or copy `deploy/hmis-ca.crt`
   by USB stick.
2. Double-click the file → **Details**: check that the SHA-256 fingerprint matches the one the
   installer printed.
3. **General** → **Install Certificate** → **Local Machine** → **Place all certificates in the
   following store** → **Trusted Root Certification Authorities** → Finish.
   - Or, in an administrator PowerShell: `certutil -addstore -f Root hmis-ca.crt`.
4. Open `https://<server address>`. There is no warning. Then in Chrome or Edge, install the app
   (the install icon in the address bar) for offline mode.

**Android.**
1. Download `http://<server address>/hmis-ca.crt`.
2. Go to Settings → Security → More security settings → Encryption & credentials → **Install a
   certificate** → **CA certificate**.
3. Open `https://<server address>` in Chrome.

Firefox keeps its own list. Use Chrome or Edge, or import the file in Firefox under Settings →
Privacy & Security → Certificates.

**Keep the authority.** If the server is reinstalled, its authority is new, and every PC must trust
the new one. To avoid that, copy it to the keys USB stick after installing, and put it back
before re-running the install:
```sh
sudo docker run --rm -v hmis_caddy_data:/data -v "$PWD":/out alpine tar czf /out/hmis-caddy-ca.tgz -C /data caddy/pki
# after a reinstall, before `deploy/hmis install`:
sudo docker volume create hmis_caddy_data
sudo docker run --rm -v hmis_caddy_data:/data -v "$PWD":/in alpine tar xzf /in/hmis-caddy-ca.tgz -C /data
```
The file is a private key: keep it like the other keys.

## Everyday commands

| Command (`sudo deploy/hmis …`) | What it does |
|---|---|
| `status` | The containers and the backups |
| `logs [caddy\|web\|api\|migrate\|db\|backup]` | Recent messages |
| `clinic create --name "…" --admin-name "…" --admin-phone 09…` | Another clinic on this server (cloud), with its first admin and the starter price list |
| `clinic list` | The clinics on this server |
| `clinic reset-admin <phone>` | A temporary password for an admin locked out with no other admin to help. It also resets their two-step sign-in |
| `sync status` / `sync token create …` | Clinic server ↔ cloud ([clinic servers](../sync/README.md)) |
| `ca-cert` | The certificate authority file and its fingerprint |
| `host-check` | Check the disk encryption now (also runs daily) |
| `up` | Rebuild and restart, after an update or a change to `deploy/.env` |
| `stop` | Stop HMIS (the data stays) |

## Updating HMIS

1. Take a backup first: `sudo docker compose -f deploy/compose.yml exec backup hmis-backup now`.
2. Get the new version (`git pull`, or copy it over the old folder, keeping `deploy/.env`).
3. Run `sudo deploy/hmis up`. New database migrations are applied before the API starts. If one
   fails, the old API is not replaced: see `sudo deploy/hmis logs migrate`.

With clinic servers: update the cloud first, then the clinic servers.

## How the database is protected

The API never connects as the PostgreSQL superuser. Before each start, `hmis-db-roles` sets up
two roles:
- **`hmis_owner`** owns the tables. It runs the migrations and the few lookups across clinics
  (sign-in, sync). It is not a superuser: it cannot read the server's files, run programs on it,
  create roles or open other databases.
- **`hmis_app`** handles every request, under row-level security: it sees only the clinic of
  the person signed in.

The superuser's password is given only to the database and the backup worker. A database made
by an older version, where everything ran as the superuser, is moved over to `hmis_owner`
automatically.
