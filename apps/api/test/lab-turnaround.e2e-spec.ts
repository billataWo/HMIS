import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
type Work = { id: string; urgent: boolean; targetMinutes: number | null; labTest: { name: string } };

/** Urgent tests first on the bench, turnaround targets, and how fast the lab was. */
describe('lab: urgent tests and turnaround', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, tech: Staff, admin: Staff, pharmacist: Staff, cashier: Staff;
  let hb: string, film: string, glucose: string, patientId: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Lab TAT Clinic ${Date.now()}`)).id;
    [desk, doctor, tech, admin, pharmacist, cashier] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'ADMIN'),
      makeStaff(tenantId, 'PHARMACIST'),
      makeStaff(tenantId, 'CASHIER'),
    ]);
    const test = (name: string, tatMinutes: number | null) => db.labTest.create({ data: { tenantId, name, price: '0', resultOptions: [], tatMinutes } });
    hb = (await test('Hemoglobin', 90)).id;
    film = (await test('Malaria blood film', null)).id;
    glucose = (await test('Random blood glucose', 30)).id;
    patientId = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Fast', fatherName: 'Result', sex: 'MALE', ageYears: 50 }).expect(201)).body.id;
  });

  /** A new patient (one queue place each per day) called in to the doctor. */
  const newPatient = async (token: string) =>
    (await api.post('/patients').set(bearer(token)).send({ confirmDuplicate: true, firstName: 'Fast', fatherName: 'Result', sex: 'MALE', ageYears: 50 }).expect(201)).body.id as string;
  const consult = async () => {
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: await newPatient(desk.token) }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    return visitId;
  };
  const order = async (labTestIds: string[], urgent?: boolean) =>
    (await api.post(`/visits/${await consult()}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds, urgent }).expect(201)).body as { id: string; urgent: boolean }[];
  const worklist = async () => (await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body as { open: Work[]; verifiedToday: Work[] };

  it('puts urgent tests first on the bench, with the urgent target', async () => {
    const [routine] = await order([hb]);
    const [stat, statGlucose] = await order([film, glucose], true);
    expect(routine.urgent).toBe(false);
    expect(stat.urgent).toBe(true);
    const work = await worklist();
    const ids = work.open.map((o) => o.id);
    // Ordered later, but done first.
    expect(ids.indexOf(stat.id)).toBeLessThan(ids.indexOf(routine.id));
    expect(ids.indexOf(statGlucose.id)).toBeLessThan(ids.indexOf(routine.id));
    const byId = new Map(work.open.map((o) => [o.id, o]));
    expect(byId.get(routine.id)!.targetMinutes).toBe(90); // the test's own target
    expect(byId.get(stat.id)!.targetMinutes).toBe(60); // the clinic's urgent target (the test has none)
    expect(byId.get(statGlucose.id)!.targetMinutes).toBe(30); // the test's own is shorter still
  });

  it('lets the doctor or the lab make an open test urgent, not a finished one', async () => {
    const [o] = await order([hb]);
    await api.post(`/lab-orders/${o.id}/urgent`).set(bearer(pharmacist.token)).expect(403);
    await api.post(`/lab-orders/${o.id}/urgent`).set(bearer(cashier.token)).expect(403);
    expect((await api.post(`/lab-orders/${o.id}/urgent`).set(bearer(doctor.token)).expect(201)).body.urgent).toBe(true);
    await api.post(`/lab-orders/${o.id}/urgent`).set(bearer(tech.token)).expect(201); // already urgent: no change

    const [done] = await order([film]);
    await api.post(`/lab-orders/${done.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    await api.post(`/lab-orders/${done.id}/result`).set(bearer(tech.token)).send({ value: 'Negative' }).expect(201);
    await api.post(`/lab-orders/${done.id}/verify`).set(bearer(tech.token)).send({}).expect(201);
    await api.post(`/lab-orders/${done.id}/urgent`).set(bearer(tech.token)).expect(409);
    const log = await db.auditLog.findFirst({ where: { tenantId, action: 'lab.urgent', entityId: o.id } });
    expect(log).not.toBeNull();
  });

  it('takes urgent lab-only requests', async () => {
    const { visitId } = (await api.post('/lab/walk-in').set(bearer(desk.token)).send({ patientId, labTestIds: [film], urgent: true }).expect(201)).body;
    const [o] = await db.labOrder.findMany({ where: { visitId } });
    expect(o.urgent).toBe(true);
  });

  it('keeps targets in settings: per test, and the clinic’s urgent target', async () => {
    await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ tatMinutes: 2 }).expect(400);
    await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ tatMinutes: 45 }).expect(200);
    await api.patch('/settings').set(bearer(admin.token)).send({ labUrgentMinutes: 5 }).expect(400);
    expect((await api.patch('/settings').set(bearer(admin.token)).send({ labUrgentMinutes: 40 }).expect(200)).body.labUrgentMinutes).toBe(40);
    const [o] = await order([film], true);
    expect((await worklist()).open.find((x) => x.id === o.id)!.targetMinutes).toBe(40); // min(45, 40)
    // Clearing a target: routine tests then have none.
    await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ tatMinutes: null }).expect(200);
    const [routine] = await order([film]);
    expect((await worklist()).open.find((x) => x.id === routine.id)!.targetMinutes).toBeNull();
    await api.patch(`/catalog/lab-tests/${film}`).set(bearer(admin.token)).send({ tatMinutes: 45 }).expect(200);
    await api.patch('/settings').set(bearer(admin.token)).send({ labUrgentMinutes: 60 }).expect(200);
  });

  it('reports how fast the lab released results, against the targets', async () => {
    // A fresh clinic, so only these results count.
    const t2 = (await makeClinic(`Lab TAT Report ${Date.now()}`)).id;
    const [d2, doc2, lab2, admin2] = await Promise.all([makeStaff(t2, 'RECEPTIONIST'), makeStaff(t2, 'DOCTOR'), makeStaff(t2, 'LAB_TECH'), makeStaff(t2, 'ADMIN')]);
    const t = await db.labTest.create({ data: { tenantId: t2, name: 'Hemoglobin', price: '0', resultOptions: [], tatMinutes: 60 } });
    // Four results taking 20, 40, 90 and 30 (urgent) minutes; the last one is also amended.
    const took = [20, 40, 90, 30];
    const ids: string[] = [];
    for (const [i, m] of took.entries()) {
      const v = (await api.post('/visits').set(bearer(d2.token)).send({ patientId: await newPatient(d2.token) }).expect(201)).body.id;
      await api.patch(`/visits/${v}/status`).set(bearer(doc2.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
      const [o] = (await api.post(`/visits/${v}/lab-orders`).set(bearer(doc2.token)).send({ labTestIds: [t.id], urgent: i === 3 }).expect(201)).body;
      await api.post(`/lab-orders/${o.id}/collect`).set(bearer(lab2.token)).send({}).expect(201);
      await api.post(`/lab-orders/${o.id}/result`).set(bearer(lab2.token)).send({ value: '13' }).expect(201);
      await api.post(`/lab-orders/${o.id}/verify`).set(bearer(lab2.token)).send({}).expect(201);
      const verifiedAt = new Date();
      await db.labOrder.update({ where: { id: o.id }, data: { sampleCollectedAt: new Date(verifiedAt.getTime() - m * 60_000), verifiedAt } });
      ids.push(o.id);
    }
    let lab = (await api.get('/reports/dashboard').set(bearer(admin2.token)).expect(200)).body.lab;
    expect(lab.urgent).toBe(1);
    expect(lab.turnaround).toMatchObject({ count: 4, medianMinutes: 35, withTarget: 4, onTime: 3 });
    expect(lab.turnaround.urgent).toMatchObject({ count: 1, medianMinutes: 30, onTime: 1 });
    expect(lab.turnaround.tests[0]).toMatchObject({ name: 'Hemoglobin', count: 4, targetMinutes: 60, withTarget: 4, onTime: 3 });

    // An amended result's release time is the amendment's: it is left out.
    await api.post(`/lab-orders/${ids[2]}/amend`).set(bearer(lab2.token)).send({ value: '12.5', reason: 'Wrong sample tube read' }).expect(201);
    lab = (await api.get('/reports/dashboard').set(bearer(admin2.token)).expect(200)).body.lab;
    expect(lab.turnaround).toMatchObject({ count: 3, medianMinutes: 30, withTarget: 3, onTime: 3 });
  });
});
