import { flagResult } from '../src/lab/lab.controller.js';
import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

describe('flagging', () => {
  it('flags results against the reference range', () => {
    expect(flagResult(9.5, 12, 17)).toBe('L');
    expect(flagResult(18, 12, 17)).toBe('H');
    expect(flagResult(12, 12, 17)).toBe('N');
    expect(flagResult(200, null, 140)).toBe('H');
  });
});

describe('lab orders and results', () => {
  let tenantId: string;
  let doctor: Staff, nurse: Staff, desk: Staff, tech: Staff;
  const test: Record<string, string> = {};

  async function openVisit() {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Lab', fatherName: 'Patient', sex: 'FEMALE' }).expect(201)).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body;
    await api.patch(`/visits/${v.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    return v.id as string;
  }
  const order = (visitId: string, names: string[], token = doctor.token) =>
    api.post(`/visits/${visitId}/lab-orders`).set(bearer(token)).send({ labTestIds: names.map((n) => test[n]) });
  const act = (id: string, step: 'collect' | 'result' | 'verify' | 'cancel', body: object = {}, token = tech.token) =>
    api.post(`/lab-orders/${id}/${step}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    tenantId = (await makeClinic('Lab Clinic')).id;
    [doctor, nurse, desk, tech] = await Promise.all([
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'NURSE'),
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'LAB_TECH'),
    ]);
    const defs = [
      { name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', price: '100.00', resultOptions: [] },
      { name: 'Malaria blood film', price: '60.00', resultOptions: ['Negative', 'P. falciparum', 'P. vivax'] },
      { name: 'Urinalysis', price: '80.00', resultOptions: [] },
    ];
    for (const d of defs) test[d.name] = (await db.labTest.create({ data: { tenantId, ...d } })).id;
  });

  it('lets doctors order tests, charging each one', async () => {
    const visitId = await openVisit();
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'AWAITING_LAB' }).expect(409); // nothing ordered
    const res = await order(visitId, ['Hemoglobin', 'Malaria blood film']).expect(201);
    expect(res.body.map((o: { status: string }) => o.status)).toEqual(['ORDERED', 'ORDERED']);
    const charges = await db.charge.findMany({ where: { visitId, source: 'LAB' }, orderBy: { description: 'asc' } });
    expect(charges.map((c) => [c.description, c.unitPrice.toString()])).toEqual([
      ['Hemoglobin', '100'],
      ['Malaria blood film', '60'],
    ]);
    await order(visitId, ['Hemoglobin']).expect(409); // already ordered
    await order(visitId, ['Urinalysis'], nurse.token).expect(403);
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'AWAITING_LAB' }).expect(200);
  });

  it('walks a sample from collection to verified result, flagging abnormal values', async () => {
    const visitId = await openVisit();
    const [hb, film] = (await order(visitId, ['Hemoglobin', 'Malaria blood film']).expect(201)).body;

    await act(hb.id, 'result', { value: '9.5' }).expect(409); // sample first
    const collected = (await act(hb.id, 'collect').expect(201)).body;
    expect(collected.sampleId).toMatch(/^L-[0-9A-F]{8}$/);
    await act(hb.id, 'collect').expect(409);

    await act(hb.id, 'result', { value: 'abc' }).expect(409);
    expect((await act(hb.id, 'result', { value: '10' }).expect(201)).body.resultFlag).toBe('L');
    const corrected = (await act(hb.id, 'result', { value: '9.5', note: 'Repeated, confirmed' }).expect(201)).body;
    expect([corrected.resultValue, corrected.resultFlag, corrected.status]).toEqual(['9.5', 'L', 'RESULTED']);

    await act(film.id, 'collect', { sampleId: 'BF-001' }).expect(201);
    await act(film.id, 'result', { value: 'Maybe' }).expect(409);
    expect((await act(film.id, 'result', { value: 'P. falciparum' }).expect(201)).body.resultFlag).toBeNull();

    // Doctors don't see values until the lab verifies them.
    const before = (await api.get(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).expect(200)).body;
    expect(before.map((o: { resultValue: string | null }) => o.resultValue)).toEqual([null, null]);
    const queueBefore = (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body;
    expect(queueBefore.visits.find((v: { id: string }) => v.id === visitId).labReady).toBe(false);

    await act(hb.id, 'verify').expect(201);
    await act(film.id, 'verify').expect(201);
    await act(hb.id, 'result', { value: '14' }).expect(409); // locked after verification

    const after = (await api.get(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).expect(200)).body;
    expect(after.map((o: { resultValue: string }) => o.resultValue)).toEqual(['9.5', 'P. falciparum']);
    expect(after[0].verifiedBy.fullName).toBe('LAB_TECH user');
    const queueAfter = (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body;
    expect(queueAfter.visits.find((v: { id: string }) => v.id === visitId).labReady).toBe(true);

    const report = (await api.get(`/visits/${visitId}/lab-report`).set(bearer(doctor.token)).expect(200)).body;
    expect(report.labOrders).toHaveLength(2);
    expect(report.tenant.name).toBe('Lab Clinic');
  });

  it('only lab staff work the bench; worklist shows open tests', async () => {
    const visitId = await openVisit();
    const [u] = (await order(visitId, ['Urinalysis']).expect(201)).body;
    await act(u.id, 'collect', {}, doctor.token).expect(403);
    await api.get('/lab/worklist').set(bearer(doctor.token)).expect(403);
    const list = (await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body;
    const entry = list.open.find((o: { id: string }) => o.id === u.id);
    expect(entry.visit.patient.firstName).toBe('Lab');
    expect(entry.paid).toBe(false);
    expect(list.prepayment).toBe(false);
    await act(u.id, 'collect').expect(201);
    expect((await act(u.id, 'result', { value: 'Pus cells 2-4/hpf, no RBC' }).expect(201)).body.resultFlag).toBeNull();
  });

  it('lets the doctor cancel a test before the sample is taken, dropping its charge', async () => {
    const visitId = await openVisit();
    const [hb, u] = (await order(visitId, ['Hemoglobin', 'Urinalysis']).expect(201)).body;
    await act(hb.id, 'cancel', {}, tech.token).expect(403);
    await act(hb.id, 'cancel', {}, doctor.token).expect(201);
    expect(await db.charge.count({ where: { sourceId: hb.id } })).toBe(0);
    await order(visitId, ['Hemoglobin']).expect(201); // can be re-ordered after cancelling

    await act(u.id, 'collect').expect(201);
    await act(u.id, 'cancel', {}, doctor.token).expect(409);
  });

  it("keeps each clinic's lab private", async () => {
    const other = await makeClinic('Other Lab Clinic');
    const otherTech = await makeStaff(other.id, 'LAB_TECH');
    const otherDoctor = await makeStaff(other.id, 'DOCTOR');
    const visitId = await openVisit();
    const [hb] = (await order(visitId, ['Hemoglobin']).expect(201)).body;
    await act(hb.id, 'collect', {}, otherTech.token).expect(404);
    expect((await api.get('/lab/worklist').set(bearer(otherTech.token)).expect(200)).body.open).toEqual([]);
    await api.post(`/visits/${visitId}/lab-orders`).set(bearer(otherDoctor.token)).send({ labTestIds: [test.Hemoglobin] }).expect(404);
    expect((await api.get(`/visits/${visitId}/lab-orders`).set(bearer(otherDoctor.token)).expect(200)).body).toEqual([]);
  });
});
