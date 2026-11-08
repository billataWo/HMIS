# Working offline in the browser

For clinics that use HMIS in the cloud (no clinic server). How staff keep working when the
internet drops, and what to tell them. For clinics that need *every* PC to keep sharing work
during an outage, use a clinic server instead ([docs/sync](../sync/README.md)).

## What staff see

- **The sidebar shows whether this PC is ready.** It says **"Ready for offline · 10:42"** once
  the PC has kept today's work (refreshed every 3 minutes while connected). It changes to:
  - **"Offline: open the offline workspace"** when the connection drops;
  - **"Sending N offline items…"** when the connection is back;
  - **"N offline items need attention"** when the server refused something.
- **The offline workspace** (`/offline`) opens by itself whenever HMIS can't be reached, even
  after closing and reopening the browser. It has one area per role:

| Role | Can do offline |
|---|---|
| Reception / nurse | Find patients known on this PC, register new patients (with the duplicate warning), check in with the consultation fee, see today's queue |
| Doctor | For today's patients: call in, vitals and notes, diagnosis (common ICD-11 list), lab orders, prescriptions (tests and drugs ordered earlier are shown, so they are not ordered twice), send to lab or pharmacy, complete |
| Cashier | Take payments toward what each visit owes, including part payments and instalments, but never more than is owed. Cash, or Telebirr with its transaction number. Print a provisional receipt |
| Lab | Take samples, enter single-value results, verify |
| Pharmacy | Bill prescriptions and hand over what has been paid for |
| Admin | Front desk, cashier, lab and pharmacy (consultation is the doctors' own work) |

When the connection is back, the work is sent in the order it was done, through the normal API,
with every normal check: pay-first, stock, allergy and interaction alerts, duplicate patients.
New patients get their card number (MRN) and queue number then.

## The limits (tell staff)

- **Each PC only knows what it had and what it did.** A patient registered at reception during an
  outage only appears on the doctor's PC once reception's PC has sent it.
- **Work is sent as the person who did it**, so they must sign in again if their sign-in has
  expired (12 hours). The sign-in page lists any work waiting, and whose it is.
- **The workspace locks when the sign-in expires**, even offline: nobody can then see that
  person's patients or record work in their name. Waiting work is kept and sent once they sign in.
- **Things that need the server wait:** panel results (CBC, urinalysis), diagnoses outside the
  common list, and any screen not in the offline workspace.
- **Refusals land in "Needs attention"** with the reason and what to do. The usual one is a bill
  paid on two PCs: the second payment is refused ("Nothing is owed on this visit any more"), and
  the cashier must give that money back. Duplicate patients can be confirmed ("Different person:
  register anyway") or removed. Refused prescriptions list the allergy or interaction alerts.
- **A cloud copy of a clinic that has its own clinic server** has no offline work areas: that
  clinic works on its clinic server.
- **Offline mode runs only in a production build** (`next build` + `next start`, over HTTPS or on
  `localhost`). In development (`pnpm dev`) the service worker is removed, so it can never serve
  old code.

## How it works

| Piece | Where |
|---|---|
| Service worker: keeps the workspace and the app's files; shows the workspace when a page can't load | `apps/web/public/sw.js` |
| Status chip; keeps the PC ready and sends queued work | `apps/web/src/components/offline-agent.tsx` |
| The day's data for this user, in one download | `apps/web/src/app/offline/snapshot/route.ts` |
| Sends one queued request with the user's sign-in and an `Idempotency-Key` (only listed endpoints) | `apps/web/src/app/offline/replay/route.ts` |
| Browser store (IndexedDB), queue, replay, temporary ids → real ids | `apps/web/src/lib/offline/` |
| The workspace | `apps/web/src/app/offline/` |
| Applies each request once: the key is claimed *before* the work runs, so two copies (two tabs, a lost reply) can never both run. A repeat gets the stored reply | `apps/api/src/common/idempotency.interceptor.ts` |
| Only one tab sends at a time (a browser lock); work is sent in the order of a counter, not the PC clock | `apps/web/src/lib/offline/engine.ts` |
| Server time on every reply (`X-Server-Time`): decides which sent work a snapshot already includes, whatever the PC clock says | `apps/api/src/common/server-time.interceptor.ts` |
| A payment toward everything a visit owes (bills what is not invoiced, then pays open invoices oldest first) | `POST /visits/:id/payments` |
| What each visit still owes (unbilled charges plus open invoice balances), for the cashier's list | `GET /billing/owed` |
| Drug list with stock, and the ICD-11 list, for offline use | `GET /offline/reference` |

Privacy:
- **What the browser keeps:** only the signed-in person's working day.
- **On sign-out:** the data is removed from the browser. Work not yet sent is kept until it is sent.
- **When someone else signs in on the same PC:** the previous person's data is replaced.
- **When the sign-in expires:** the workspace locks (see above).
