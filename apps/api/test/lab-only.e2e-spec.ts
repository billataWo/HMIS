import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Tests without a consultation (a request from outside, or the patient's own), and lab history. */
describe('lab-only visits and lab history', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, tech: Staff, cashier: Staff, pharmacist: Staff;
  let hb: string, film: string, patientId: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Lab Only Clinic ${Date.now()}`, { requirePrepayment: true })).id;
    [desk, doctor, tech, cashier, pharmacist] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'PHARMACIST'),
    ]);
    hb = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', price: '100', resultOptions: [] } })).id;
    film = (await db.labTest.create({ data: { tenantId, name: 'Malaria blood film', price: '60', resultOptions: ['Negative', 'Positive'] } })).id;
    patientId = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Outside', fatherName: 'Request', sex: 'FEMALE', ageYears: 30 }).expect(201)).body.id;
  });

  const walkIn = (body: object, who = tech) => api.post('/lab/walk-in').set(bearer(who.token)).send(body);
  const finish = async (orderId: string, value: string) => {
    await api.post(`/lab-orders/${orderId}/collect`).set(bearer(tech.token)).send({}).expect(201);
    await api.post(`/lab-orders/${orderId}/result`).set(bearer(tech.token)).send({ value }).expect(201);
    await api.post(`/lab-orders/${orderId}/verify`).set(bearer(tech.token)).send({}).expect(201);
  };

  it('takes a request at the lab or the front desk, for a registered patient', async () => {
    await walkIn({ patientId, labTestIds: [hb] }, doctor).expect(403);
    await walkIn({ patientId, labTestIds: [hb] }, pharmacist).expect(403);
    await walkIn({ labTestIds: [hb] }).expect(400);
    await walkIn({ patientId, labTestIds: [] }).expect(400);
    const res = (await walkIn({ patientId, labTestIds: [hb, film], requestedBy: 'Dr. Sara, Bole Clinic' }, desk).expect(201)).body;
    expect(res.tests).toBe(2);
    const visit = await db.visit.findUniqueOrThrow({ where: { id: res.visitId }, include: { labOrders: true, charges: true } });
    expect(visit).toMatchObject({ kind: 'LAB', status: 'AWAITING_LAB', queueNumber: 0, doctorId: null });
    expect(visit.labOrders.every((o) => o.requestedBy === 'Dr. Sara, Bole Clinic')).toBe(true);
    expect(visit.charges.map((c) => Number(c.unitPrice)).sort()).toEqual([100, 60]);
  });

  it('follows the usual path: not in the doctor’s queue, paid first, closes when the last result is out', async () => {
    const { visitId } = (await walkIn({ patientId, labTestIds: [hb, film] }).expect(201)).body;
    const queue = (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body;
    expect(queue.visits.some((v: { id: string }) => v.id === visitId)).toBe(false);
    const work = (await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body;
    const mine = work.open.filter((o: { visit: { id: string } }) => o.visit.id === visitId);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ paid: false, visit: { kind: 'LAB' } });
    // Pay first applies as for any test.
    await api.post(`/lab-orders/${mine[0].id}/collect`).set(bearer(tech.token)).send({}).expect(409);
    const pending = (await api.get('/billing/pending').set(bearer(cashier.token)).expect(200)).body;
    expect(pending.some((v: { id: string }) => v.id === visitId)).toBe(true);
    await api.post(`/visits/${visitId}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 160 }).expect(201);

    const [a, b] = mine.map((o: { id: string }) => o.id);
    await finish(a, '13.2');
    expect((await db.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe('AWAITING_LAB');
    await finish(b, 'Negative');
    expect((await db.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe('COMPLETED');
    const report = (await api.get(`/visits/${visitId}/lab-report`).set(bearer(tech.token)).expect(200)).body;
    expect(report).toMatchObject({ kind: 'LAB', doctor: null });
    expect(report.labOrders).toHaveLength(2);
  });

  it('is not a consultation: no notes, prescriptions, doctor’s orders or queue moves', async () => {
    const { visitId } = (await walkIn({ patientId, labTestIds: [film] }).expect(201)).body;
    await api.patch(`/visits/${visitId}`).set(bearer(doctor.token)).send({ chiefComplaint: 'x' }).expect(409);
    await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hb] }).expect(409);
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(409);
    const drug = await db.drug.create({ data: { tenantId, genericName: 'Paracetamol', form: 'tablet', unit: 'tablet', sellPrice: '1' } });
    await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: drug.id, dose: '1', frequency: 'OD', quantity: 1 }] }).expect(409);
  });

  it('lists a patient’s released results from every visit, newest first, to clinicians and the lab only', async () => {
    const list = (await api.get(`/patients/${patientId}/lab-results`).set(bearer(doctor.token)).expect(200)).body;
    expect(list.map((o: { labTest: { name: string }; resultValue: string }) => [o.labTest.name, o.resultValue])).toEqual([
      ['Malaria blood film', 'Negative'],
      ['Hemoglobin', '13.2'],
    ]);
    expect(list[0].visit.kind).toBe('LAB');
    await api.get(`/patients/${patientId}/lab-results`).set(bearer(tech.token)).expect(200);
    await api.get(`/patients/${patientId}/lab-results`).set(bearer(cashier.token)).expect(403);
    const other = await makeStaff((await makeClinic(`Other Lab Clinic ${Date.now()}`)).id, 'DOCTOR');
    await api.get(`/patients/${patientId}/lab-results`).set(bearer(other.token)).expect(404);
  });
});
