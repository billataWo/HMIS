import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
type Store = { id: string; name: string; dispensary: boolean; active: boolean; units: number };

/** Several stores: the Settings switch, receiving into a store, transfers, dispensing from the dispensary. */
describe('stores and transfers', () => {
  let tenantId: string;
  let admin: Staff, desk: Staff, doctor: Staff, pharmacist: Staff;
  let amox: string;
  const expiry = (months: number) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  const stores = async () => (await api.get('/stores').set(bearer(pharmacist.token)).expect(200)).body as { multiStore: boolean; stores: Store[] };
  const storeNamed = async (name: string) => (await stores()).stores.find((s) => s.name === name)!;
  const receive = (body: object) => api.post('/inventory/receipts').set(bearer(pharmacist.token)).send(body);

  beforeAll(async () => {
    tenantId = (await makeClinic(`Stores Clinic ${Date.now()}`)).id;
    [admin, desk, doctor, pharmacist] = await Promise.all([makeStaff(tenantId, 'ADMIN'), makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'PHARMACIST')]);
    amox = (await api.post('/drugs').set(bearer(pharmacist.token)).send({ genericName: 'Amoxicillin', strength: '500 mg', form: 'capsule', unit: 'capsule', sellPrice: 5 }).expect(201)).body.id;
    // Stock from before the switch: one store, no store on the batch.
    await receive({ items: [{ drugId: amox, batchNo: 'OLD-1', expiryDate: expiry(10), quantity: 40, costPrice: 2 }] }).expect(201);
  });

  it('is off by default: no stores, transfers refused', async () => {
    expect(await stores()).toEqual({ multiStore: false, stores: [] });
    expect((await db.stockBatch.findFirstOrThrow({ where: { drugId: amox } })).storeId).toBeNull();
    await api.post('/stores').set(bearer(pharmacist.token)).send({ name: 'Ward' }).expect(409);
  });

  it('switching on creates a Main store and a Dispensary and puts current stock in the dispensary', async () => {
    await api.patch('/settings').set(bearer(pharmacist.token)).send({ multiStore: true }).expect(403);
    expect((await api.patch('/settings').set(bearer(admin.token)).send({ multiStore: true }).expect(200)).body.multiStore).toBe(true);
    const s = await stores();
    expect(s.stores.map((x) => [x.name, x.dispensary, x.units])).toEqual([
      ['Main store', false, 0],
      ['Dispensary', true, 40],
    ]);
    // Switching on again changes nothing.
    await api.patch('/settings').set(bearer(admin.token)).send({ multiStore: true }).expect(200);
    expect((await stores()).stores).toHaveLength(2);
  });

  it('receives into the main store by default, or into the store chosen', async () => {
    await receive({ items: [{ drugId: amox, batchNo: 'NEW-1', expiryDate: expiry(6), quantity: 300, costPrice: 2.5 }] }).expect(201);
    const main = await storeNamed('Main store');
    expect(main.units).toBe(300);
    const disp = await storeNamed('Dispensary');
    await receive({ storeId: disp.id, items: [{ drugId: amox, batchNo: 'DSP-1', expiryDate: expiry(12), quantity: 10, costPrice: 2 }] }).expect(201);
    expect((await storeNamed('Dispensary')).units).toBe(50);
    const inv = (await api.get('/inventory').set(bearer(pharmacist.token)).expect(200)).body;
    expect(inv.summary.multiStore).toBe(true);
    const row = inv.drugs.find((d: { id: string }) => d.id === amox);
    expect(row.onHand).toBe(350);
    expect(Object.fromEntries(row.byStore.map((b: { name: string; quantity: number }) => [b.name, b.quantity]))).toEqual({ 'Main store': 300, Dispensary: 50 });
  });

  it('dispenses only from the dispensary, and says when the rest is in another store', async () => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Store', fatherName: 'Test', sex: 'MALE' }).expect(201)).body;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body.id;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const rx = (await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: amox, dose: '500 mg', frequency: 'TID', quantity: 60 }] }).expect(201)).body;
    const q = (await api.get('/pharmacy/queue').set(bearer(pharmacist.token)).expect(200)).body;
    const item = q.open.find((o: { id: string }) => o.id === rx.id).items[0];
    expect({ inStock: item.inStock, elsewhere: item.elsewhere }).toEqual({ inStock: 50, elsewhere: 300 });
    const res = await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 60 }] }).expect(409);
    expect(res.body.message).toMatch(/Not enough Amoxicillin in the dispensary: 50 capsule there.*Transfer more from another store first/);
    // Nothing left the main store.
    expect((await storeNamed('Main store')).units).toBe(300);
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 50 }] }).expect(201);
    expect((await storeNamed('Dispensary')).units).toBe(0);
  });

  it('transfers earliest expiry first, keeping batch, expiry and cost, as permanent movements', async () => {
    const main = await storeNamed('Main store');
    const disp = await storeNamed('Dispensary');
    // Another, earlier-expiring batch in the main store: it goes first.
    await receive({ storeId: main.id, items: [{ drugId: amox, batchNo: 'EARLY-1', expiryDate: expiry(3), quantity: 20, costPrice: 2.2 }] }).expect(201);
    const t = (await api.post('/inventory/transfers').set(bearer(pharmacist.token)).send({ fromStoreId: main.id, toStoreId: disp.id, note: 'Weekly top-up', items: [{ drugId: amox, quantity: 50 }] }).expect(201)).body;
    expect(t.number).toMatch(/^TR-\d{5}$/);
    const moved = await db.stockBatch.findMany({ where: { drugId: amox, storeId: disp.id, quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' } });
    expect(moved.map((b) => [b.batchNo, b.quantity, Number(b.costPrice)])).toEqual([
      ['EARLY-1', 20, 2.2],
      ['NEW-1', 30, 2.5],
    ]);
    expect((await storeNamed('Main store')).units).toBe(270); // 300 + 20 received - 50 moved
    const moves = await db.stockMovement.findMany({ where: { reference: t.id }, orderBy: { quantity: 'asc' } });
    expect(moves.map((m) => [m.type, m.quantity])).toEqual([
      ['TRANSFER_OUT', -30],
      ['TRANSFER_OUT', -20],
      ['TRANSFER_IN', 20],
      ['TRANSFER_IN', 30],
    ]);
    expect(moves[0].reason).toBe(`${t.number}: Main store → Dispensary`);
    // A second transfer of the same batch tops it up rather than making another.
    await api.post('/inventory/transfers').set(bearer(pharmacist.token)).send({ fromStoreId: main.id, toStoreId: disp.id, items: [{ drugId: amox, quantity: 5 }] }).expect(201);
    expect(await db.stockBatch.count({ where: { drugId: amox, storeId: disp.id, batchNo: 'NEW-1' } })).toBe(1);

    const list = (await api.get('/inventory/transfers').set(bearer(pharmacist.token)).expect(200)).body;
    expect(list[1]).toMatchObject({ number: t.number, from: 'Main store', to: 'Dispensary', note: 'Weekly top-up', by: 'PHARMACIST user' });
    expect(list[1].lines.map((l: { batchNo: string; quantity: number }) => [l.batchNo, l.quantity])).toEqual(expect.arrayContaining([['EARLY-1', 20], ['NEW-1', 30]]));
  });

  it('refuses transfers it cannot do', async () => {
    const main = await storeNamed('Main store');
    const disp = await storeNamed('Dispensary');
    const send = (body: object, who = pharmacist) => api.post('/inventory/transfers').set(bearer(who.token)).send(body);
    expect((await send({ fromStoreId: main.id, toStoreId: disp.id, items: [{ drugId: amox, quantity: 10_000 }] }).expect(409)).body.message).toMatch(/Main store has only 265 capsule of Amoxicillin in date/);
    await send({ fromStoreId: main.id, toStoreId: main.id, items: [{ drugId: amox, quantity: 1 }] }).expect(400);
    await send({ fromStoreId: main.id, toStoreId: disp.id, items: [{ drugId: amox, quantity: 1 }] }, doctor).expect(403);
    // A failed transfer leaves nothing behind.
    expect((await storeNamed('Main store')).units).toBe(265);
  });

  it('manages stores: add, rename, keep a dispensary, no closing a store that holds stock', async () => {
    const ward = (await api.post('/stores').set(bearer(pharmacist.token)).send({ name: 'Ward 1', dispensary: true }).expect(201)).body;
    await api.post('/stores').set(bearer(pharmacist.token)).send({ name: 'ward 1' }).expect(409);
    await api.patch(`/stores/${ward.id}`).set(bearer(pharmacist.token)).send({ name: 'Ward A' }).expect(200);
    const disp = await storeNamed('Dispensary');
    expect((await api.patch(`/stores/${disp.id}`).set(bearer(pharmacist.token)).send({ active: false }).expect(409)).body.message).toMatch(/still holds/);
    // Two dispensaries: one may stop dispensing; the last one may not.
    await api.patch(`/stores/${ward.id}`).set(bearer(pharmacist.token)).send({ dispensary: false }).expect(200);
    expect((await api.patch(`/stores/${disp.id}`).set(bearer(pharmacist.token)).send({ dispensary: false }).expect(409)).body.message).toMatch(/Keep at least one dispensary/);
    await api.patch(`/stores/${ward.id}`).set(bearer(pharmacist.token)).send({ active: false }).expect(200);
  });

  it('switching off makes all stock dispensable again, keeping the stores', async () => {
    await api.patch('/settings').set(bearer(admin.token)).send({ multiStore: false }).expect(200);
    const q = await db.stockBatch.aggregate({ where: { drugId: amox, quantity: { gt: 0 } }, _sum: { quantity: true } });
    const drugs = (await api.get('/drugs?q=amox').set(bearer(doctor.token)).expect(200)).body;
    expect(drugs[0].inStock).toBe(q._sum.quantity);
    expect((await stores()).stores.length).toBe(3);
  });
});
