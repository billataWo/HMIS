# Clinic servers and the HMIS cloud

For the HMIS support team. How a clinic keeps working when the internet goes down, and how its
data still reaches the cloud.

| Clinic works on | When the internet is down | Data in the cloud |
|---|---|---|
| **The cloud** (default) | Each PC keeps working with the work it already had ([browser offline mode](../offline/README.md)); PCs see each other's work once the connection is back | Lives there |
| **A clinic server** (a small PC at the clinic) | Keeps working normally: every screen, every rule | A read-only copy, updated within seconds whenever the internet is up |

With a clinic server, staff use HMIS over the clinic's own network. Each change is kept on the
server and sent to the cloud when there is a connection; after an outage it catches up on its own.
In the cloud, the owner or the head office can sign in from anywhere with their usual phone number
and password to look up patients and run reports. Entering or changing records there is refused
(the clinic server is where the work happens), and every page shows how fresh the copy is.

## Setting up a clinic server

The clinic is created in the cloud first (as for any clinic), then moved onto its server.

1. **On the cloud server**, issue the clinic server's token. From now on the clinic's cloud copy is
   read-only, so do this when the clinic is ready to switch:
   ```sh
   node apps/api/dist/sync/cli.js token create <clinic id> "Clinic server, Bahir Dar"
   ```
   It prints `SYNC_TOKEN=…` once. Send it to the technician over a private channel.
2. **On the clinic server** (a PC with a second disk and a UPS; database and backups as in
   [docs/backup](../backup/README.md)), set in the API's environment:
   ```sh
   SYNC_CLOUD_URL=https://cloud.example.et   # the cloud API
   SYNC_TOKEN=…                              # from step 1
   ```
   Run the migrations (`pnpm db:migrate` / `prisma migrate deploy`, and `pnpm db:app-role`), but
   **not** the seed.
3. Copy the clinic down from the cloud, then start the API and web app:
   ```sh
   node apps/api/dist/sync/cli.js bootstrap
   ```
   It copies every record of the clinic (staff, patients, prices, history) and turns capture on.
4. Check **Settings → Cloud sync** on the clinic server ("Connected") and in the cloud (the copy
   shows "Last update from it just now").

A clinic that has been running on a server without sync (no cloud copy yet): on the cloud,
`token create <its clinic id> "<server name>" --new` (the id is in the clinic server's `Tenant`
table); then on the clinic server set `SYNC_CLOUD_URL`/`SYNC_TOKEN` and run
`node apps/api/dist/sync/cli.js enable --snapshot`, which sends everything it has.

## Everyday

- **Settings → Cloud sync** on the clinic server shows when it last sent, how many changes are
  waiting and why, if they are. Admins see a banner when the server has been offline for over an
  hour. Nothing needs doing: it catches up when the internet is back.
- `node apps/api/dist/sync/cli.js status` shows the same on the command line;
  `token list` on the cloud shows every clinic server and when it last called in.
- **Upgrades**: update the cloud first, then the clinic servers. A clinic server that is newer
  than the cloud keeps its changes waiting until the cloud is updated.

## When things go wrong

| Situation | What to do |
|---|---|
| Changes waiting, "Cannot reach the cloud" | The internet or the cloud is down. Nothing to do; it retries on its own. |
| "update the cloud first" | Upgrade the cloud to the clinic server's version. |
| Another error on Settings → Cloud sync | The cloud refused a change, for example a staff phone number already used by another clinic. The changes keep waiting; fix the cause on the clinic server (e.g. change the phone) and they go through. |
| The clinic server is lost or broken | Restore it from its backups (docs/backup/RESTORE.md). If the backups are gone too, install a new server and **bootstrap** it from the cloud copy: you lose only what had not reached the cloud. |
| A clinic server was restored to an earlier time | Afterwards run `cli.js enable --snapshot`. Records created after the restore point stay in the cloud copy until a clean-up tool exists: tell the clinic. |
| Moving the clinic back to the cloud | `cli.js token revoke <id>` on the cloud: the cloud copy becomes the clinic's working copy again within 15 seconds. Stop using the clinic server. |
| A token leaked | Revoke it and issue a new one; the clinic server only needs the new `SYNC_TOKEN`. |

## Privacy

The copy in the cloud is the same clinic data under the same protections: per-clinic row-level
security, the same accounts and roles, and the cloud's own backups. Clinic servers send over
HTTPS only (put the cloud API behind TLS), and each token can only ever write its own clinic.
