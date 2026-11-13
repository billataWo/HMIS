import type { Prisma } from '@hmis/db';
import { clinicDay, dayRange } from '../common/clinic-day.js';

type Db = Pick<Prisma.TransactionClient, 'labQcControl' | 'labQcResult' | 'labTestReagent' | 'labReagentLot' | 'labReagentMovement'>;

export type QcVerdict = { status: 'PASS' | 'WARN' | 'FAIL'; rule: string | null };

/**
 * Judges a numeric control run by the Westgard rules, from how many SDs it is from the mean (z).
 * `earlier`: this control's earlier runs, newest first; `otherLevels`: the latest run today of the
 * test's other controls (for R-4s). Breaking any rejection rule fails the run; 1-2s alone warns.
 */
export function westgard(z: number, earlier: number[], otherLevels: number[] = []): QcVerdict {
  const side = Math.sign(z);
  const run = [z, ...earlier];
  if (Math.abs(z) > 3) return { status: 'FAIL', rule: '1-3s' };
  if (Math.abs(z) > 2 && earlier.length && Math.abs(earlier[0]) > 2 && Math.sign(earlier[0]) === side) return { status: 'FAIL', rule: '2-2s' };
  if (Math.abs(z) > 2 && otherLevels.some((o) => Math.abs(o) > 2 && Math.sign(o) === -side)) return { status: 'FAIL', rule: 'R-4s' };
  if (run.length >= 4 && run.slice(0, 4).every((x) => Math.abs(x) > 1 && Math.sign(x) === side)) return { status: 'FAIL', rule: '4-1s' };
  if (side !== 0 && run.length >= 10 && run.slice(0, 10).every((x) => Math.sign(x) === side)) return { status: 'FAIL', rule: '10x' };
  if (Math.abs(z) > 2) return { status: 'WARN', rule: '1-2s' };
  return { status: 'PASS', rule: null };
}

export type QcState = {
  /** FAIL: the last run of a control failed (patient results held); DUE: not run today; WARN: a 1-2s today. */
  status: 'OK' | 'WARN' | 'DUE' | 'FAIL';
  /** "Level 1 (normal): 1-3s" — which control, and why. */
  detail: string | null;
};

/**
 * Where QC stands for each test that has controls (tests without controls are left out). A
 * failure stands until that control passes again, whatever the day.
 */
export async function qcStates(db: Db, tenantId: string, labTestIds?: string[]) {
  const controls = await db.labQcControl.findMany({
    where: { tenantId, active: true, ...(labTestIds && { labTestId: { in: labTestIds } }) },
    select: { id: true, name: true, labTestId: true, results: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, rule: true, createdAt: true } } },
  });
  const today = dayRange(clinicDay()).start;
  const states = new Map<string, QcState>();
  const rank = { OK: 0, WARN: 1, DUE: 2, FAIL: 3 } as const;
  for (const c of controls) {
    const last = c.results[0];
    const state: QcState =
      last?.status === 'FAIL'
        ? { status: 'FAIL', detail: `${c.name}: ${last.rule ?? 'failed'}` }
        : !last || last.createdAt < today
          ? { status: 'DUE', detail: `${c.name} not run today` }
          : last.status === 'WARN'
            ? { status: 'WARN', detail: `${c.name}: ${last.rule}` }
            : { status: 'OK', detail: null };
    const current = states.get(c.labTestId);
    if (!current || rank[state.status] > rank[current.status]) states.set(c.labTestId, state);
  }
  return states;
}

/**
 * Takes what a test uses from reagent stock, earliest expiry first, skipping expired lots. What
 * the stock on record can't cover is still written down (with no lot), so the count can be put
 * right. Returns the reagents that ran short.
 */
export async function useReagents(db: Db, tenantId: string, labTestId: string, type: 'USE' | 'QC', userId: string, labOrderId?: string) {
  const uses = await db.labTestReagent.findMany({ where: { tenantId, labTestId }, include: { reagent: { select: { id: true, name: true, active: true } } } });
  const short: string[] = [];
  const now = new Date();
  for (const u of uses.filter((x) => x.reagent.active)) {
    let need = u.perTest;
    const lots = await db.labReagentLot.findMany({
      where: { reagentId: u.reagentId, quantity: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });
    for (const lot of lots) {
      if (!need) break;
      const take = Math.min(need, lot.quantity);
      await db.labReagentLot.update({ where: { id: lot.id }, data: { quantity: { decrement: take } } });
      await db.labReagentMovement.create({ data: { tenantId, reagentId: u.reagentId, lotId: lot.id, type, quantity: -take, labOrderId, userId } });
      need -= take;
    }
    if (need) {
      await db.labReagentMovement.create({ data: { tenantId, reagentId: u.reagentId, type, quantity: -need, labOrderId, userId, reason: 'More used than the stock on record' } });
      short.push(u.reagent.name);
    }
  }
  return short;
}

/** Tests whose reagents (in use) can't cover one more test from unexpired stock. */
export async function reagentShortTests(db: Pick<Prisma.TransactionClient, 'labTestReagent'>, tenantId: string) {
  const now = new Date();
  const uses = await db.labTestReagent.findMany({
    where: { tenantId, reagent: { active: true } },
    select: {
      labTestId: true,
      perTest: true,
      reagent: { select: { name: true, lots: { where: { quantity: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { quantity: true } } } },
    },
  });
  const out = new Map<string, string[]>();
  for (const u of uses) {
    const onHand = u.reagent.lots.reduce((s, l) => s + l.quantity, 0);
    if (onHand < u.perTest) out.set(u.labTestId, [...(out.get(u.labTestId) ?? []), u.reagent.name]);
  }
  return out;
}
