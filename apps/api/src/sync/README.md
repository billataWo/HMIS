# Clinic server → cloud sync (design)

For developers. To set it up, see [docs/sync/README.md](../../../../docs/sync/README.md).

A clinic that works on its own server (the clinic server) is the **single master** of its data.
The cloud keeps a **read-only copy** for remote look-ups, central reports and an extra copy.
Changes go one way only, so there are no conflicts to resolve.

## Capture (clinic server)

- **Trigger:** every clinic table has an `AFTER INSERT OR UPDATE OR DELETE` trigger,
  `hmis_sync_capture` (migration `20261110000000_clinic_server_sync`).
  - It writes one `SyncOutbox` row per changed row: table, `U` or `D`, primary key, the row as `to_jsonb`, and the writing transaction's `xid8`.
  - It is `SECURITY DEFINER`, so writes made by the restricted `hmis_app` role are captured too.
  - It does nothing unless `SyncState.enabled`, so the cloud and unsynced servers pay one indexed read per write.
- **New tables must be attached.** A migration that adds a clinic table must call
  `SELECT hmis_sync_attach('NewTable');`. `test/sync.e2e-spec.ts` fails for any table left
  out; server-only tables go in `NOT_SYNCED` in `engine.ts`.
- **Commit order:** `readOutbox` only returns rows whose `xid` is older than
  `pg_snapshot_xmin(pg_current_snapshot())`, i.e. from transactions older than every one still
  running.
  - Without this, a long transaction that commits late could leave a lower sequence number behind a cursor.
  - The agent deletes exactly the rows the cloud acknowledged, so there is no cursor at all.
  - For any one row, the sequence order is its commit order, because row locks serialise writers.
- **Enabling with a snapshot:** `enableCapture({ snapshot: true })` takes `SHARE` locks on every clinic table, then:
  1. turns capture on;
  2. queues every row, parents first;
  3. commits.

  The locks mean no write can fall between the copy and the capture. Writers wait a few seconds; the trigger's own query sees the new flag, because volatile functions take a fresh snapshot.

## Sending (clinic server)

- **The agent:** `SyncAgent` runs in the API when `SYNC_CLOUD_URL` and `SYNC_TOKEN` are set. Every `SYNC_INTERVAL_MS` (5 s) it:
  1. reads up to about 0.5 MB of ready changes;
  2. `POST`s them to `/sync/push`;
  3. deletes them on success.
- **Failures:** the changes stay in the outbox and the agent retries with exponential backoff (up to 5 minutes). Nothing is lost while offline, and the outbox is part of the database's backups.
- **Heartbeat:** with nothing to send, it calls in once a minute, so the cloud can show how fresh the copy is.

## Applying (cloud)

- **Authentication:** `/sync/push` uses the clinic server's token, stored as a SHA-256 hash in `SyncClient`, not a staff sign-in.
- **Row-level security is the boundary:** changes are applied through `applyChanges` **as `hmis_app` inside the clinic's tenant context**. A row of any other clinic is refused by the policies, whatever the clinic server sends.
- **Statements:**
  - Upserts: `INSERT … SELECT … FROM jsonb_populate_record(NULL::"T", row) ON CONFLICT (pk) DO UPDATE`, over the columns both sides have.
  - Deletes are by primary key.
  - Rows travel as JSON text exactly as PostgreSQL produced it, so decimals and timestamps are not re-encoded by JavaScript.
- **All or nothing:** one transaction per batch, with a savepoint per change. A change whose parent comes later in the batch is retried after the rest; anything else fails the whole batch, which the clinic server simply sends again later. The error is kept on `SyncClient.lastError` and returned to the clinic server.
- **Versions:** the clinic server sends its newest migration name. The cloud refuses a newer one (`CLOUD_OUTDATED`), so the order is: **upgrade the cloud first, then the clinic servers.**
- **Read-only copy:** `CloudCopyGuard` refuses every non-read request (`CLOUD_COPY_READ_ONLY`) for a clinic with an active `SyncClient`. Sign-in still works there, because staff accounts and password hashes are synced.

## Bootstrap and export

- **Export:** `/sync/export` (same token) streams the clinic as JSON lines, parents first, read under row-level security.
- **Bootstrap:** `cli.js bootstrap` loads that export into an empty clinic server through the same `applyChanges` as the clinic, then turns capture on without a snapshot, since the cloud already has everything.

## Known limits

- One clinic per clinic server, and one active clinic server per clinic.
- `TRUNCATE` is not captured (the app never truncates).
- **After restoring a clinic server from backup** to an earlier time, rows created after that time stay in the cloud copy. Run `enable --snapshot` so the cloud gets the restored state of every row; removing cloud-only rows (a reconcile step) is still to be built.
- The web app still shows edit buttons on the cloud copy; the API refuses them with a clear message.
