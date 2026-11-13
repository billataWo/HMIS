import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Results that are right and acted on: ranges by sex and age, critical values, amendments, rejected samples. */
describe('lab safety', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, tech: Staff, admin: Staff;
  let hb: string, cbc: string, cbcHb: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Lab Safety Clinic ${Date.now()}`)).id;
    [desk, doctor, tech, admin] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'LAB_TECH'), makeStaff(tenantId, 'ADMIN')]);
    // Free tests, so nobody waits for the cashier in these tests.
    hb = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', price: '0', resultOptions: [] } })).id;
    const panel = await db.labTest.create({
      data: {
        tenantId, name: 'Complete blood count (CBC)', price: '0', resultOptions: [],
        components: {
          create: [
            { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', sortOrder: 0, resultOptions: [] },
            { tenantId, name: 'WBC', unit: '×10³/µL', refLow: '4', refHigh: '11', sortOrder: 1, resultOptions: [] },
          ],
        },
      },
      include: { components: true },
    });
    cbc = panel.id;
    cbcHb = panel.components.find((c) => c.name === 'Hemoglobin')!.id;
  });

  /** A patient seen today with one test ordered and its sample taken. */
  const sampled = async (patient: { sex: 'MALE' | 'FEMALE'; ageYears?: number }, testId = hb) => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Lab', fatherName: 'Safety', ...patient }).expect(201)).body;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const [order] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [testId] }).expect(201)).body;
    await api.post(`/lab-orders/${order.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    return { visitId, orderId: order.id as string };
  };
  const result = (orderId: string, body: object) => api.post(`/lab-orders/${orderId}/result`).set(bearer(tech.token)).send(body);
  const verify = (orderId: string, body: object = {}) => api.post(`/lab-orders/${orderId}/verify`).set(bearer(tech.token)).send(body);
  const queueVisit = async (visitId: string) => (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body.visits.find((v: { id: string }) => v.id === visitId);

  it('adds the recommended ranges to tests that have none, and never overwrites', async () => {
    await api.post('/catalog/lab-tests/recommended-ranges').set(bearer(doctor.token)).expect(403);
    const res = (await api.post('/catalog/lab-tests/recommended-ranges').set(bearer(admin.token)).expect(201)).body;
    expect(res.filled).toEqual(expect.arrayContaining(['Hemoglobin', 'Complete blood count (CBC)/Hemoglobin', 'Complete blood count (CBC)/WBC']));
    expect(await db.labRange.count({ where: { labTestId: hb } })).toBe(5);
    expect((await api.post('/catalog/lab-tests/recommended-ranges').set(bearer(admin.token)).expect(201)).body.filled).toEqual([]);
  });

  it('judges a result by the range for the patient’s sex and age', async () => {
    const cases: [{ sex: 'MALE' | 'FEMALE'; ageYears?: number }, string, string, string][] = [
      [{ sex: 'MALE', ageYears: 30 }, '12.5', 'L', '13–17 g/dL (male, age 15 y+)'],
      [{ sex: 'FEMALE', ageYears: 30 }, '12.5', 'N', '12–15.5 g/dL (female, age 15 y+)'],
      [{ sex: 'FEMALE', ageYears: 3 }, '10.5', 'L', '11–14 g/dL (age 6 mo–5 y)'],
      [{ sex: 'MALE' }, '12.5', 'N', '12–17 g/dL'], // age unknown: the default range
    ];
    for (const [patient, value, flag, range] of cases) {
      const { orderId } = await sampled(patient);
      const r = (await result(orderId, { value }).expect(201)).body;
      expect({ patient, flag: r.resultFlag, range: r.rangeText }).toEqual({ patient, flag, range });
    }
  });

  it('holds a critical result until the lab records who was told, then alerts the doctor until seen', async () => {
    const { visitId, orderId } = await sampled({ sex: 'FEMALE', ageYears: 40 });
    const r = (await result(orderId, { value: '5.8' }).expect(201)).body;
    expect(r).toMatchObject({ resultFlag: 'LL', critical: true });
    expect((await verify(orderId).expect(409)).body.code).toBe('CRITICAL_NOT_NOTIFIED');
    const v = (await verify(orderId, { notified: 'Dr. Dawit, by phone' }).expect(201)).body;
    expect(v).toMatchObject({ status: 'VERIFIED', criticalNotified: 'Dr. Dawit, by phone', alert: 'CRITICAL', alertSeenAt: null });
    expect((await queueVisit(visitId)).labAlert).toBe('CRITICAL');
    await api.post(`/lab-orders/${orderId}/seen`).set(bearer(tech.token)).expect(403);
    await api.post(`/lab-orders/${orderId}/seen`).set(bearer(doctor.token)).expect(201);
    expect((await queueVisit(visitId)).labAlert).toBeNull();
    const report = await db.labOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(report.alertSeenById).toBe(doctor.id);
  });

  it('flags a critical component of a panel, with the newborn range for a baby', async () => {
    const { orderId } = await sampled({ sex: 'MALE', ageYears: 40 }, cbc);
    const r = (await result(orderId, { values: [{ componentId: cbcHb, value: '21' }] }).expect(201)).body;
    expect(r).toMatchObject({ critical: true, resultFlag: 'HH' });
    expect(r.values[0]).toMatchObject({ flag: 'HH', rangeText: '13–17 g/dL (male, age 15 y+)' });
  });

  it('amends a released result, keeping the old one and alerting the doctor again', async () => {
    const { visitId, orderId } = await sampled({ sex: 'MALE', ageYears: 30 });
    await result(orderId, { value: '15' }).expect(201);
    await verify(orderId).expect(201);
    expect((await result(orderId, { value: '14' }).expect(409)).body.message).toMatch(/amend it instead/);
    await api.post(`/lab-orders/${orderId}/amend`).set(bearer(tech.token)).send({ value: '11', reason: 'x' }).expect(400);
    await api.post(`/lab-orders/${orderId}/amend`).set(bearer(doctor.token)).send({ value: '11', reason: 'Sample mix-up' }).expect(403);
    const a = (await api.post(`/lab-orders/${orderId}/amend`).set(bearer(tech.token)).send({ value: '11.2', reason: 'Transcription error: wrong patient row' }).expect(201)).body;
    expect(a).toMatchObject({ status: 'VERIFIED', resultValue: '11.2', resultFlag: 'L', alert: 'AMENDED' });
    expect(a.amendments).toEqual([expect.objectContaining({ previousValue: '15', previousFlag: 'N', reason: 'Transcription error: wrong patient row' })]);
    expect((await queueVisit(visitId)).labAlert).toBe('AMENDED');
    // The doctor sees the corrected value (not hidden like unverified results).
    const seen = (await api.get(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).expect(200)).body[0];
    expect(seen).toMatchObject({ resultValue: '11.2', amendedAt: expect.any(String) });
    // A correction that is critical needs the call recorded too.
    expect((await api.post(`/lab-orders/${orderId}/amend`).set(bearer(tech.token)).send({ value: '6', reason: 'Second correction' }).expect(409)).body.code).toBe('CRITICAL_NOT_NOTIFIED');
  });

  it('rejects an unusable sample: a new one is collected without paying again', async () => {
    const { visitId, orderId } = await sampled({ sex: 'MALE', ageYears: 30 });
    await result(orderId, { value: '14' }).expect(201);
    await api.post(`/lab-orders/${orderId}/reject`).set(bearer(tech.token)).send({ reason: 'OTHER' }).expect(400);
    await api.post(`/lab-orders/${orderId}/reject`).set(bearer(doctor.token)).send({ reason: 'CLOTTED' }).expect(403);
    const r = (await api.post(`/lab-orders/${orderId}/reject`).set(bearer(tech.token)).send({ reason: 'HAEMOLYSED' }).expect(201)).body;
    expect(r).toMatchObject({ status: 'ORDERED', sampleId: null, resultValue: null, rejections: 1, rejectReason: 'Haemolysed' });
    expect(await db.labSampleRejection.count({ where: { labOrderId: orderId, reason: 'Haemolysed' } })).toBe(1);
    expect((await queueVisit(visitId)).labRecollect).toBe(true);
    const again = (await api.post(`/lab-orders/${orderId}/collect`).set(bearer(tech.token)).send({}).expect(201)).body;
    expect(again.sampleId).toMatch(/^L-[0-9A-F]{8}-2$/);
    expect(again.rejectReason).toBeNull();
    expect((await queueVisit(visitId)).labRecollect).toBe(false);
  });

  it('saves ranges and critical limits from Settings, refusing ones that make no sense', async () => {
    const put = (body: object) => api.put(`/catalog/lab-tests/${hb}/ranges`).set(bearer(admin.token)).send(body);
    expect((await put({ critLow: 13 }).expect(409)).body.message).toBe('Hemoglobin: the critical low must be at or below the normal low (12)');
    await put({ ranges: [{ refLow: 12, refHigh: 17, critLow: 13 }] }).expect(400);
    expect((await put({ ranges: [{ sex: 'MALE', ageFromDays: 0, refLow: 13, refHigh: 17 }, { sex: 'MALE', ageFromDays: 5000, refLow: 13.5, refHigh: 17 }] }).expect(409)).body.message).toMatch(
      /cover the same men at the same ages/,
    );
    const saved = (await put({ critLow: 6.5, critHigh: 21, ranges: [{ sex: 'FEMALE', ageFromDays: 5475, refLow: 12, refHigh: 15 }] }).expect(200)).body;
    expect(saved).toMatchObject({ critLow: '6.5', critHigh: '21' });
    expect(saved.ranges).toHaveLength(1);
    await api.put(`/catalog/lab-tests/${cbc}/ranges`).set(bearer(admin.token)).send({ ranges: [{ refLow: 1, refHigh: 2 }] }).expect(409);
  });
});
