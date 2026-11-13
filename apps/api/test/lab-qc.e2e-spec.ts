import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Quality control that holds patient results when it fails, and reagent stock used by each test. */
describe('lab: QC and reagents', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, tech: Staff;
  let hb: string, hiv: string;
  let level1: string, kit: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Lab QC Clinic ${Date.now()}`)).id;
    [desk, doctor, tech] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'LAB_TECH')]);
    hb = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', price: '0', resultOptions: [] } })).id;
    hiv = (await db.labTest.create({ data: { tenantId, name: 'HIV rapid test', price: '0', resultOptions: ['Non-reactive', 'Reactive'] } })).id;
  });

  /** A test ordered for a new patient, its sample taken. */
  const sampled = async (labTestId: string) => {
    const patientId = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Qc', fatherName: 'Patient', sex: 'FEMALE', ageYears: 33 }).expect(201)).body.id;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const [o] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [labTestId] }).expect(201)).body;
    await api.post(`/lab-orders/${o.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    return o.id as string;
  };
  const run = (controlId: string, value: string) => api.post('/lab/qc/results').set(bearer(tech.token)).send({ controlId, value });
  /** Where QC stands for a test, as the QC page shows it. */
  const qcOf = async (testId: string) =>
    (await api.get('/lab/qc').set(bearer(tech.token)).expect(200)).body.tests.find((t: { id: string }) => t.id === testId)?.state;

  it('sets up controls: a measured level (mean and SD) or a kit control (its answer)', async () => {
    const add = (body: object, who = tech) => api.post('/lab/qc/controls').set(bearer(who.token)).send(body);
    await add({ labTestId: hb, name: 'Level 1 (normal)', mean: 12 }).expect(400); // no SD
    await add({ labTestId: hb, name: 'Both', mean: 12, sd: 0.5, expected: 'x' }).expect(400);
    await add({ labTestId: hb, name: 'Level 1 (normal)', mean: 12, sd: 0.5 }, doctor).expect(403);
    level1 = (await add({ labTestId: hb, name: 'Level 1 (normal)', lot: 'QC-881', expiresAt: '2030-01-31', mean: 12, sd: 0.5 }).expect(201)).body.id;
    kit = (await add({ labTestId: hiv, name: 'Negative control', expected: 'Non-reactive' }).expect(201)).body.id;
    expect(await qcOf(hb)).toMatchObject({ status: 'DUE' }); // not run today
    const qc = (await api.get('/lab/qc').set(bearer(tech.token)).expect(200)).body;
    expect(qc.tests.map((t: { name: string }) => t.name)).toEqual(['Hemoglobin', 'HIV rapid test']);
  });

  it('judges runs by the Westgard rules; a failure holds patient results until a passing run', async () => {
    expect((await run(level1, '12.2').expect(201)).body).toMatchObject({ status: 'PASS', rule: null });
    expect(await qcOf(hb)).toMatchObject({ status: 'OK' });
    const order = await sampled(hb);
    await api.post(`/lab-orders/${order}/result`).set(bearer(tech.token)).send({ value: '13.1' }).expect(201);

    const fail = (await run(level1, '13.6').expect(201)).body; // 3.2 SD above the mean
    expect(fail).toMatchObject({ status: 'FAIL', rule: '1-3s' });
    expect(await qcOf(hb)).toMatchObject({ status: 'FAIL', detail: 'Level 1 (normal): 1-3s' });
    expect((await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body.qc[hb]).toMatchObject({ status: 'FAIL' }); // the bench says so too
    // Nothing goes out: not this result, nor a new one.
    const held = (await api.post(`/lab-orders/${order}/verify`).set(bearer(tech.token)).send({}).expect(409)).body;
    expect(held.code).toBe('QC_FAILED');
    const other = await sampled(hb);
    expect((await api.post(`/lab-orders/${other}/result`).set(bearer(tech.token)).send({ value: '12' }).expect(409)).body.code).toBe('QC_FAILED');

    await api.post(`/lab/qc/results/${fail.id}/action`).set(bearer(tech.token)).send({ action: 'Recalibrated the analyser' }).expect(201);
    expect((await run(level1, '12.1').expect(201)).body.status).toBe('PASS');
    await api.post(`/lab-orders/${order}/verify`).set(bearer(tech.token)).send({}).expect(201);
    await api.post(`/lab-orders/${other}/result`).set(bearer(tech.token)).send({ value: '12' }).expect(201);
  });

  it("fails a kit control that doesn't give its answer, and won't run an expired control", async () => {
    expect((await run(kit, 'Reactive').expect(201)).body).toMatchObject({ status: 'FAIL', rule: 'expected Non-reactive' });
    expect((await run(kit, 'non-reactive').expect(201)).body.status).toBe('PASS');
    const old = (await api.post('/lab/qc/controls').set(bearer(tech.token)).send({ labTestId: hiv, name: 'Old lot', expected: 'Reactive', expiresAt: '2020-01-01' }).expect(201)).body.id;
    await run(old, 'Reactive').expect(409);
  });

  it('keeps reagent stock: lots by expiry, used by tests and QC, counted, never edited', async () => {
    const r = (await api.post('/lab/reagents').set(bearer(tech.token)).send({ name: 'Hb cuvettes', unit: 'cuvette', reorderLevel: 2 }).expect(201)).body;
    await api.post('/lab/reagents').set(bearer(tech.token)).send({ name: 'hb cuvettes', unit: 'cuvette' }).expect(409);
    await api.put(`/lab/reagents/${r.id}/uses`).set(bearer(tech.token)).send({ uses: [{ labTestId: hb, perTest: 1 }] }).expect(200);
    const later = (await api.post(`/lab/reagents/${r.id}/receive`).set(bearer(tech.token)).send({ quantity: 3, lot: 'A', expiresAt: '2031-06-30' }).expect(201)).body;
    const sooner = (await api.post(`/lab/reagents/${r.id}/receive`).set(bearer(tech.token)).send({ quantity: 1, lot: 'B', expiresAt: '2029-06-30' }).expect(201)).body;
    await api.post(`/lab/reagents/${r.id}/receive`).set(bearer(tech.token)).send({ quantity: 1, expiresAt: '2020-06-30' }).expect(409);

    // A patient test takes from the lot that expires first; a correction takes nothing more.
    const o = await sampled(hb);
    await api.post(`/lab-orders/${o}/result`).set(bearer(tech.token)).send({ value: '12.5' }).expect(201);
    await api.post(`/lab-orders/${o}/result`).set(bearer(tech.token)).send({ value: '12.6' }).expect(201);
    expect((await db.labReagentLot.findUniqueOrThrow({ where: { id: sooner.id } })).quantity).toBe(0);
    expect((await db.labReagentLot.findUniqueOrThrow({ where: { id: later.id } })).quantity).toBe(3);
    // A QC run uses one too.
    await run(level1, '12').expect(201);
    expect((await db.labReagentLot.findUniqueOrThrow({ where: { id: later.id } })).quantity).toBe(2);
    // A sent-out test uses the reference lab's reagents.
    const out = await sampled(hb);
    await api.post(`/lab-orders/${out}/send`).set(bearer(tech.token)).send({ to: 'Reference Lab' }).expect(201);
    await api.post(`/lab-orders/${out}/result`).set(bearer(tech.token)).send({ value: '11' }).expect(201);
    expect((await db.labReagentLot.findUniqueOrThrow({ where: { id: later.id } })).quantity).toBe(2);

    let list = (await api.get('/lab/reagents').set(bearer(tech.token)).expect(200)).body.reagents[0];
    expect(list).toMatchObject({ onHand: 2, low: true, usedWithoutStock: 0 });
    expect(list.uses[0].labTest.name).toBe('Hemoglobin');

    // Run out: the bench flags the test, and what's used beyond the stock is still written down.
    await api.post(`/lab/reagents/${r.id}/adjust`).set(bearer(tech.token)).send({ lotId: later.id, quantity: -3, reason: 'DAMAGED' }).expect(409);
    await api.post(`/lab/reagents/${r.id}/adjust`).set(bearer(tech.token)).send({ lotId: later.id, quantity: -2, reason: 'DAMAGED' }).expect(201);
    expect((await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body.reagentShort[hb]).toEqual(['Hb cuvettes']);
    const extra = await sampled(hb);
    expect((await api.post(`/lab-orders/${extra}/result`).set(bearer(tech.token)).send({ value: '12' }).expect(201)).body.reagentShort).toEqual(['Hb cuvettes']);
    list = (await api.get('/lab/reagents').set(bearer(tech.token)).expect(200)).body.reagents[0];
    expect(list).toMatchObject({ onHand: 0, usedWithoutStock: 1 });
    // A count puts the stock right and settles it.
    await api.post(`/lab/reagents/${r.id}/adjust`).set(bearer(tech.token)).send({ lotId: later.id, quantity: 4, reason: 'COUNT' }).expect(201);
    list = (await api.get('/lab/reagents').set(bearer(tech.token)).expect(200)).body.reagents[0];
    expect(list).toMatchObject({ onHand: 4, usedWithoutStock: 0 });

    const moves = (await api.get(`/lab/reagents/${r.id}/movements`).set(bearer(tech.token)).expect(200)).body as { type: string }[];
    expect(moves.map((m) => m.type).sort()).toEqual(['ADJUST', 'ADJUST', 'ADJUST', 'QC', 'RECEIVE', 'RECEIVE', 'USE', 'USE'].sort());
    // The ledger is permanent.
    const any = await db.labReagentMovement.findFirstOrThrow({ where: { reagentId: r.id } });
    await expect(db.labReagentMovement.update({ where: { id: any.id }, data: { quantity: 100 } })).rejects.toThrow(/permanent record/);
    await api.get('/lab/reagents').set(bearer(doctor.token)).expect(403);
  });
});
