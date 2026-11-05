import { clinicDay } from '../src/common/clinic-day.js';
import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** YYYY-MM-DD, `days` from today in clinic time. */
function dayFromToday(days: number) {
  const d = new Date(`${clinicDay()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('inventory', () => {
  let tenantId: string;
  let pharmacist: Staff, admin: Staff, cashier: Staff;
  let drugId: string;

  const post = (url: string, body: object, token = pharmacist.token) => api.post(url).set(bearer(token)).send(body);
  const list = async (filter = 'all') => (await api.get('/inventory').query({ filter }).set(bearer(pharmacist.token)).expect(200)).body;

  beforeAll(async () => {
    tenantId = (await makeClinic('Inventory Clinic')).id;
    [pharmacist, admin, cashier] = await Promise.all([makeStaff(tenantId, 'PHARMACIST'), makeStaff(tenantId, 'ADMIN'), makeStaff(tenantId, 'CASHIER')]);
  });

  it('manages the drug list', async () => {
    const drug = { genericName: 'Ciprofloxacin', drugClass: 'fluoroquinolone', form: 'tablet', strength: '500 mg', unit: 'tablet', sellPrice: 6, reorderLevel: 50 };
    drugId = (await post('/drugs', drug).expect(201)).body.id;
    await post('/drugs', { ...drug, genericName: 'ciprofloxacin' }).expect(409);
    await post('/drugs', { ...drug, strength: '250 mg' }).expect(201); // a different strength is a different item
    await post('/drugs', drug, cashier.token).expect(403);

    await api.patch(`/drugs/${drugId}`).set(bearer(pharmacist.token)).send({ sellPrice: 6.5 }).expect(200);
    const audit = await db.auditLog.findFirst({ where: { entityId: drugId, action: 'drug.update' } });
    expect(audit?.data).toEqual(expect.objectContaining({ sellPrice: { from: '6', to: '6.50' } }));
  });

  it('receives deliveries into batches, topping up a known batch', async () => {
    const supplier = (await post('/suppliers', { name: 'EPSS Addis Ababa Hub', phone: '0115 000000', tin: '0001234567' }).expect(201)).body;
    await post('/suppliers', { name: 'epss addis ababa hub' }).expect(409);

    const res = await post('/inventory/receipts', {
      supplierId: supplier.id,
      receiptRef: 'DN-1001',
      items: [
        { drugId, batchNo: 'CIP-A', expiryDate: dayFromToday(30), quantity: 40, costPrice: 4 },
        { drugId, batchNo: 'CIP-B', expiryDate: dayFromToday(400), quantity: 100, costPrice: 7 }, // above the 6.50 sell price
      ],
    }).expect(201);
    expect(res.body.received).toHaveLength(2);
    expect(res.body.warnings).toEqual([expect.stringMatching(/cost 7\.00 is above the selling price 6\.5/)]);

    await post('/inventory/receipts', { items: [{ drugId, batchNo: 'CIP-A', expiryDate: dayFromToday(30), quantity: 10, costPrice: 4 }] }).expect(201);
    await post('/inventory/receipts', { items: [{ drugId, batchNo: 'CIP-A', expiryDate: dayFromToday(31), quantity: 1, costPrice: 4 }] }).expect(409);
    await post('/inventory/receipts', { items: [{ drugId, batchNo: 'OLD', expiryDate: dayFromToday(0), quantity: 1, costPrice: 4 }] }).expect(409);

    const stock = (await api.get(`/drugs/${drugId}/stock`).set(bearer(pharmacist.token)).expect(200)).body;
    const a = stock.batches.find((b: { batchNo: string }) => b.batchNo === 'CIP-A');
    expect([a.quantity, a.receiptRef, a.supplierRef.name]).toEqual([50, 'DN-1001', 'EPSS Addis Ababa Hub']);
    expect(stock.movements.filter((m: { type: string }) => m.type === 'RECEIPT')).toHaveLength(3);
    expect(stock.movements[0].userName).toBe('PHARMACIST user');
  });

  it('summarises stock, value and alerts', async () => {
    // An expired batch arriving from before this test (e.g. left on the shelf).
    await db.stockBatch.create({ data: { drugId, batchNo: 'CIP-OLD', expiryDate: new Date(dayFromToday(-5)), quantity: 12, costPrice: '3.00' } });
    const inv = await list();
    const cipro = inv.drugs.find((d: { id: string }) => d.id === drugId);
    expect(cipro).toEqual(expect.objectContaining({ onHand: 150, expiringSoon: 50, expiredQty: 12, low: false, stockValue: '900.00', expiredValue: '36.00' }));
    expect(inv.summary).toEqual(expect.objectContaining({ expiring: 1, expired: 1, expiredValue: '36.00' }));
    expect((await list('expired')).drugs.map((d: { id: string }) => d.id)).toEqual([drugId]);
    expect((await list('low')).drugs.map((d: { strength: string }) => d.strength)).toEqual(['250 mg']); // reorder 50, none in stock
    await api.get('/inventory').set(bearer(cashier.token)).expect(403);
  });

  it('adjusts stock only with a reason, never below zero', async () => {
    const batch = await db.stockBatch.findFirstOrThrow({ where: { drugId, batchNo: 'CIP-A' } });
    const adjust = (body: object) => post('/inventory/adjustments', { batchId: batch.id, ...body });
    expect((await adjust({ quantity: -3, reason: 'DAMAGED' }).expect(201)).body.quantity).toBe(47);
    await adjust({ quantity: -48, reason: 'LOST' }).expect(409);
    await adjust({ quantity: 5, reason: 'DAMAGED' }).expect(400); // only a count correction can add
    await adjust({ quantity: -1, reason: 'OTHER' }).expect(400); // needs a note
    expect((await adjust({ quantity: 2, reason: 'COUNT_CORRECTION', note: 'Recount on shelf' }).expect(201)).body.quantity).toBe(49);
    const moves = await db.stockMovement.findMany({ where: { batchId: batch.id, type: 'ADJUSTMENT' }, orderBy: { createdAt: 'asc' } });
    expect(moves.map((m) => [m.quantity, m.reason])).toEqual([
      [-3, 'DAMAGED'],
      [2, 'COUNT_CORRECTION: Recount on shelf'],
    ]);
  });

  it('writes off expired stock and records the loss', async () => {
    const res = (await post('/inventory/expired/write-off', {}).expect(201)).body;
    expect(res).toEqual(expect.objectContaining({ batches: 1, units: 12, value: '36.00' }));
    const old = await db.stockBatch.findFirstOrThrow({ where: { drugId, batchNo: 'CIP-OLD' } });
    expect(old.quantity).toBe(0);
    expect(await db.stockMovement.count({ where: { batchId: old.id, type: 'EXPIRED', quantity: -12 } })).toBe(1);
    expect((await post('/inventory/expired/write-off', {}).expect(201)).body.batches).toBe(0);
    expect((await list()).summary.expired).toBe(0);
  });

  it('keeps inventory private to the clinic', async () => {
    const other = await makeClinic('Other Inventory Clinic');
    const otherPh = await makeStaff(other.id, 'PHARMACIST');
    await api.get(`/drugs/${drugId}/stock`).set(bearer(otherPh.token)).expect(404);
    await api.patch(`/drugs/${drugId}`).set(bearer(otherPh.token)).send({ sellPrice: 1 }).expect(404);
    await post('/inventory/receipts', { items: [{ drugId, batchNo: 'X', expiryDate: dayFromToday(100), quantity: 1, costPrice: 1 }] }, otherPh.token).expect(404);
    const batch = await db.stockBatch.findFirstOrThrow({ where: { drugId, batchNo: 'CIP-B' } });
    await post('/inventory/adjustments', { batchId: batch.id, quantity: -1, reason: 'LOST' }, otherPh.token).expect(404);
    expect((await api.get('/inventory').set(bearer(otherPh.token)).expect(200)).body.drugs).toEqual([]);
    expect((await post('/inventory/expired/write-off', {}, otherPh.token).expect(201)).body.batches).toBe(0);
  });

  describe('price catalogue', () => {
    it('lets only admins manage service prices, auditing changes', async () => {
      await post('/catalog/services', { code: 'cons-spec', name: 'Specialist consultation', price: 300 }, pharmacist.token).expect(403);
      const s = (await post('/catalog/services', { code: 'cons-spec', name: 'Specialist consultation', price: 300 }, admin.token).expect(201)).body;
      expect(s.code).toBe('CONS-SPEC');
      await post('/catalog/services', { code: 'CONS-SPEC', name: 'Again', price: 1 }, admin.token).expect(409);
      await api.patch(`/catalog/services/${s.id}`).set(bearer(admin.token)).send({ price: 350 }).expect(200);
      const audit = await db.auditLog.findFirst({ where: { entityId: s.id, action: 'service.update' } });
      expect(audit?.data).toEqual(expect.objectContaining({ price: { from: '300', to: '350.00' } }));

      await api.patch(`/catalog/services/${s.id}`).set(bearer(admin.token)).send({ active: false }).expect(200);
      const lookup = (await api.get('/lookups/services').set(bearer(cashier.token)).expect(200)).body;
      expect(lookup.find((x: { id: string }) => x.id === s.id)).toBeUndefined(); // inactive services can't be charged
    });

    it('manages lab tests: numeric ranges or answer choices', async () => {
      const t = (await post('/catalog/lab-tests', { name: 'ALT', unit: 'U/L', refLow: 7, refHigh: 56, price: 150 }, admin.token).expect(201)).body;
      expect([t.refLow, t.refHigh, t.price]).toEqual(['7', '56', '150']);
      await post('/catalog/lab-tests', { name: 'Bad range', refLow: 10, refHigh: 5, price: 1 }, admin.token).expect(400);
      await post('/catalog/lab-tests', { name: 'Both', refLow: 1, refHigh: 5, resultOptions: ['Yes'], price: 1 }, admin.token).expect(400);
      await post('/catalog/lab-tests', { name: 'alt', price: 1 }, admin.token).expect(409);
      await api.patch(`/catalog/lab-tests/${t.id}`).set(bearer(admin.token)).send({ price: 180, refHigh: 40 }).expect(200);
      const all = (await api.get('/catalog/lab-tests').set(bearer(admin.token)).expect(200)).body;
      expect(all.find((x: { id: string }) => x.id === t.id)).toEqual(expect.objectContaining({ price: '180', refHigh: '40' }));
      await api.get('/catalog/lab-tests').set(bearer(pharmacist.token)).expect(403);
    });
  });
});
