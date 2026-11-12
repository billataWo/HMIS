import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Starting a clinic's drug list: the starter list, bulk import, and pack sizes. */
describe('drug list', () => {
  let tenantId: string;
  let pharmacist: Staff, doctor: Staff, admin: Staff;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Drug List Clinic ${Date.now()}`)).id;
    [pharmacist, doctor, admin] = await Promise.all([makeStaff(tenantId, 'PHARMACIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'ADMIN')]);
  });

  const amox = { genericName: 'Amoxicillin', strength: '500 mg', form: 'capsule', unit: 'capsule', drugClass: 'penicillin', sellPrice: 5, packSize: 100, packName: 'box' };

  it('offers the starter list, marking what the clinic already has', async () => {
    const before = (await api.get('/drugs/starter').set(bearer(pharmacist.token)).expect(200)).body;
    expect(before.length).toBeGreaterThan(50);
    const row = before.find((d: { genericName: string; strength: string }) => d.genericName === 'Amoxicillin' && d.strength === '500 mg');
    expect(row).toMatchObject({ form: 'capsule', drugClass: 'penicillin', packSize: 100, packName: 'box', inList: false });
    // No prices in the starter list: the clinic sets them.
    expect(before.every((d: Record<string, unknown>) => !('sellPrice' in d))).toBe(true);
    await api.get('/drugs/starter').set(bearer(doctor.token)).expect(403);

    await api.post('/drugs/bulk').set(bearer(pharmacist.token)).send({ items: [amox] }).expect(201);
    const after = (await api.get('/drugs/starter').set(bearer(pharmacist.token)).expect(200)).body;
    expect(after.find((d: { genericName: string; strength: string }) => d.genericName === 'Amoxicillin' && d.strength === '500 mg').inList).toBe(true);
  });

  it('imports many at once, skipping drugs already in the list (any case or spacing)', async () => {
    const res = (
      await api
        .post('/drugs/bulk')
        .set(bearer(admin.token))
        .send({
          items: [
            { ...amox, genericName: 'amoxicillin ', strength: '500  mg' }, // already there
            { genericName: 'Paracetamol', strength: '500 mg', form: 'tablet', unit: 'tablet', sellPrice: 2, reorderLevel: 200, packSize: 100, packName: 'box' },
            { genericName: 'ORS', form: 'sachet', unit: 'sachet', sellPrice: 0 },
            { genericName: 'Paracetamol', strength: '500 mg', form: 'tablet', unit: 'tablet', sellPrice: 3 }, // twice in the same file
          ],
        })
        .expect(201)
    ).body;
    expect(res.created).toEqual(['Paracetamol 500 mg tablet', 'ORS sachet']);
    expect(res.skipped).toEqual(['amoxicillin 500  mg capsule', 'Paracetamol 500 mg tablet']);
    const para = await db.drug.findFirstOrThrow({ where: { tenantId, genericName: 'Paracetamol' } });
    expect(para).toMatchObject({ reorderLevel: 200, packSize: 100, packName: 'box' });
    expect(Number(para.sellPrice)).toBe(2);
    const audit = await db.auditLog.findFirst({ where: { tenantId, action: 'drug.import' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.data).toMatchObject({ created: 2, skipped: 2 });
  });

  it('refuses the whole import when a row is wrong, naming the row', async () => {
    const res = await api
      .post('/drugs/bulk')
      .set(bearer(pharmacist.token))
      .send({ items: [{ genericName: 'Ibuprofen', form: 'tablet', unit: 'tablet', sellPrice: 1 }, { genericName: 'Bad', form: 'tablet', unit: 'tablet', sellPrice: -1, packSize: 1 }] })
      .expect(400);
    const fields = res.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['items.1.sellPrice', 'items.1.packSize']));
    expect(await db.drug.count({ where: { tenantId, genericName: 'Ibuprofen' } })).toBe(0);
    await api.post('/drugs/bulk').set(bearer(doctor.token)).send({ items: [amox] }).expect(403);
    await api.post('/drugs/bulk').set(bearer(pharmacist.token)).send({ items: [] }).expect(400);
  });

  it('keeps the pack size on the drug and on purchase orders', async () => {
    const drug = (await api.post('/drugs').set(bearer(pharmacist.token)).send({ genericName: 'Cotrimoxazole', strength: '960 mg', form: 'tablet', unit: 'tablet', sellPrice: 1.5, packSize: 100, packName: 'box' }).expect(201)).body;
    expect(drug).toMatchObject({ packSize: 100, packName: 'box' });
    const cleared = (await api.patch(`/drugs/${drug.id}`).set(bearer(pharmacist.token)).send({ packSize: null, packName: null }).expect(200)).body;
    expect(cleared).toMatchObject({ packSize: null, packName: null });
    await api.patch(`/drugs/${drug.id}`).set(bearer(pharmacist.token)).send({ packSize: 1 }).expect(400);

    const supplier = (await api.post('/suppliers').set(bearer(pharmacist.token)).send({ name: `Pack Supplier ${Date.now()}` }).expect(201)).body;
    const para = await db.drug.findFirstOrThrow({ where: { tenantId, genericName: 'Paracetamol' } });
    const po = (await api.post('/purchase-orders').set(bearer(pharmacist.token)).send({ supplierId: supplier.id, lines: [{ drugId: para.id, quantity: 500, unitCost: 0.85 }] }).expect(201)).body;
    const got = (await api.get(`/purchase-orders/${po.id}`).set(bearer(pharmacist.token)).expect(200)).body;
    expect(got.lines[0].drug).toMatchObject({ packSize: 100, packName: 'box' });
  });

  it('lists prescription items in the same order every time', async () => {
    const desk = await makeStaff(tenantId, 'RECEPTIONIST');
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Order', fatherName: 'Test', sex: 'MALE' }).expect(201)).body;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body.id;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const [para, ors] = await Promise.all([
      db.drug.findFirstOrThrow({ where: { tenantId, genericName: 'Paracetamol' } }),
      db.drug.findFirstOrThrow({ where: { tenantId, genericName: 'ORS' } }),
    ]);
    const rx = (
      await api
        .post(`/visits/${visitId}/prescriptions`)
        .set(bearer(doctor.token))
        .send({ items: [{ drugId: para.id, dose: '1 g', frequency: 'TID', quantity: 18 }, { drugId: ors.id, dose: '1 sachet', frequency: 'PRN', quantity: 4 }] })
        .expect(201)
    ).body;
    const names = (r: { items: { drug: { genericName: string } }[] }) => r.items.map((i) => i.drug.genericName);
    expect(names(rx)).toEqual(['ORS', 'Paracetamol']);
    for (let n = 0; n < 3; n++) {
      const list = (await api.get(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).expect(200)).body;
      expect(names(list[0])).toEqual(['ORS', 'Paracetamol']);
    }
  });
});
