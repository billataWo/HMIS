import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
type Order = { id: string; status: string; sampleId: string | null };

/** Specimens, one tube for the tests that share one, and its label. */
describe('lab: specimens, tubes and labels', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, tech: Staff, admin: Staff, pharmacist: Staff, cashier: Staff;
  let hb: string, a1c: string, creat: string, film: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Lab Tube Clinic ${Date.now()}`, { requirePrepayment: true })).id;
    [desk, doctor, tech, admin, pharmacist, cashier] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'ADMIN'),
      makeStaff(tenantId, 'PHARMACIST'),
      makeStaff(tenantId, 'CASHIER'),
    ]);
    const test = (name: string, specimen: string | null, price = '50') => db.labTest.create({ data: { tenantId, name, price, resultOptions: [], specimen } });
    hb = (await test('Hemoglobin', 'EDTA')).id;
    a1c = (await test('HbA1c', 'EDTA')).id;
    creat = (await test('Creatinine', 'SERUM')).id;
    film = (await test('Malaria blood film', null)).id;
  });

  /** A new patient seen by the doctor, with these tests ordered; paid unless asked not to. */
  const ordered = async (labTestIds: string[], pay = true) => {
    const patientId = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Tube', fatherName: 'Test', sex: 'FEMALE', ageYears: 40 }).expect(201)).body.id;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body.id as string;
    await db.visit.update({ where: { id: visitId }, data: { status: 'IN_CONSULTATION' } }); // the fee is not what is tested here
    const orders = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds }).expect(201)).body as Order[];
    if (pay) await api.post(`/visits/${visitId}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 50 * labTestIds.length }).expect(201);
    return { visitId, orders };
  };
  const collect = (orderIds: string[], body: object = {}, who = tech) => api.post('/lab/collect').set(bearer(who.token)).send({ orderIds, ...body });

  it('takes one tube for the tests on the same specimen: they share its number', async () => {
    const { orders } = await ordered([hb, a1c, creat]);
    const [o1, o2, o3] = orders.map((o) => o.id);
    await collect([o1, o2], {}, pharmacist).expect(403);
    const res = (await collect([o1, o3]).expect(409)).body;
    expect(res.message).toMatch(/Hemoglobin \(Whole blood, EDTA \(purple top\)\) and Creatinine \(Serum .*\) need different samples/);
    const tube = (await collect([o1, o2]).expect(201)).body as Order[];
    expect(tube.map((o) => o.status)).toEqual(['SAMPLE_COLLECTED', 'SAMPLE_COLLECTED']);
    expect(tube[0].sampleId).toBe(`L-${o1.slice(0, 8).toUpperCase()}`);
    expect(tube[1].sampleId).toBe(tube[0].sampleId);
    await collect([o2]).expect(409); // already taken
    // The serum test alone, with the number written on the tube.
    expect((await collect([o3], { sampleId: 'S-77' }).expect(201)).body[0].sampleId).toBe('S-77');
  });

  it("won't put two patients' tests, or unpaid tests, in one tube", async () => {
    const a = await ordered([hb]);
    const b = await ordered([hb]);
    await collect([a.orders[0].id, b.orders[0].id]).expect(409);
    const unpaid = await ordered([hb, a1c], false);
    const res = (await collect(unpaid.orders.map((o) => o.id)).expect(409)).body;
    expect(res.message).toMatch(/not been paid/);
    // Tests with no specimen set are taken one by one (the old way still works).
    const f = await ordered([film]);
    expect((await api.post(`/lab-orders/${f.orders[0].id}/collect`).set(bearer(tech.token)).send({}).expect(201)).body.status).toBe('SAMPLE_COLLECTED');
  });

  it('rejects the whole tube: every unreleased test on it needs a new sample', async () => {
    const { orders } = await ordered([hb, a1c]);
    const ids = orders.map((o) => o.id);
    await collect(ids).expect(201);
    await api.post(`/lab-orders/${ids[1]}/result`).set(bearer(tech.token)).send({ value: '6.1' }).expect(201);
    await api.post(`/lab-orders/${ids[0]}/reject`).set(bearer(tech.token)).send({ reason: 'CLOTTED' }).expect(201);
    const after = await db.labOrder.findMany({ where: { id: { in: ids } }, orderBy: { orderedAt: 'asc' } });
    expect(after.map((o) => [o.status, o.sampleId, o.rejectReason, o.resultValue])).toEqual([
      ['ORDERED', null, 'Clotted', null],
      ['ORDERED', null, 'Clotted', null],
    ]);
    expect(await db.labSampleRejection.count({ where: { labOrderId: { in: ids } } })).toBe(2);
    // The new tube gets a new number; the patient doesn't pay again.
    const again = (await collect(ids).expect(201)).body as Order[];
    expect(again[0].sampleId).toBe(`L-${ids[0].slice(0, 8).toUpperCase()}-2`);
    expect(again[1].sampleId).toBe(again[0].sampleId);
  });

  it('prints a label per tube, for the lab only', async () => {
    const { visitId, orders } = await ordered([hb, a1c, creat]);
    await collect([orders[0].id, orders[1].id]).expect(201);
    await collect([orders[2].id]).expect(201);
    await api.get(`/visits/${visitId}/lab-labels`).set(bearer(doctor.token)).expect(403);
    const labels = (await api.get(`/visits/${visitId}/lab-labels`).set(bearer(tech.token)).expect(200)).body;
    expect(labels.patient).toMatchObject({ firstName: 'Tube', sex: 'FEMALE' });
    expect(labels.tubes).toHaveLength(2);
    expect(labels.tubes[0]).toMatchObject({ specimen: 'EDTA', tests: ['Hemoglobin', 'HbA1c'], urgent: false });
    expect(labels.tubes[1]).toMatchObject({ specimen: 'SERUM', tests: ['Creatinine'] });
  });

  it('keeps the specimen in settings, and fills in the recommended ones without overwriting', async () => {
    await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ specimen: 'BLOOD' }).expect(400);
    expect((await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ specimen: 'CAPILLARY' }).expect(200)).body.specimen).toBe('CAPILLARY');
    await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ specimen: null }).expect(200);
    // Creatinine was set to serum by the clinic: kept. The film has none: filled in.
    await db.labTest.update({ where: { id: creat }, data: { specimen: 'HEPARIN', tatMinutes: 30 } });
    const res = (await api.post('/catalog/lab-tests/recommended-ranges').set(bearer(admin.token)).expect(201)).body;
    expect(res.targets).toContain('Malaria blood film');
    const [c, f] = await Promise.all([db.labTest.findUniqueOrThrow({ where: { id: creat } }), db.labTest.findUniqueOrThrow({ where: { id: film } })]);
    expect([c.specimen, c.tatMinutes]).toEqual(['HEPARIN', 30]);
    expect([f.specimen, f.tatMinutes]).toEqual(['CAPILLARY', 60]);
  });
});
