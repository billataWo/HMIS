import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp, recordDiagnosis } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** The hand-offs between doctor, lab and pharmacy within one visit. */
describe('doctor, lab and pharmacy hand-offs', () => {
  let tenantId: string;
  let doctor: Staff, desk: Staff, tech: Staff, pharmacist: Staff;
  let hbTest: string, drugId: string;

  async function openVisit() {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Flow', fatherName: 'Patient', sex: 'FEMALE' }).expect(201)).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body;
    await move(v.id, 'IN_CONSULTATION').expect(200);
    await recordDiagnosis(v.id);
    return v.id as string;
  }
  const move = (visitId: string, status: string, token = doctor.token) => api.patch(`/visits/${visitId}/status`).set(bearer(token)).send({ status });
  const orderHb = async (visitId: string) => (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hbTest] }).expect(201)).body[0];
  const lab = (id: string, step: 'collect' | 'result' | 'verify', body: object = {}) => api.post(`/lab-orders/${id}/${step}`).set(bearer(tech.token)).send(body).expect(201);
  const prescribe = async (visitId: string, quantity = 4) =>
    (await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId, dose: '1 tab', frequency: 'BID', durationDays: 2, quantity }] }).expect(201)).body;
  const dispenseAll = (rx: { id: string; items: { id: string; quantity: number }[] }) =>
    api
      .post(`/prescriptions/${rx.id}/dispense`)
      .set(bearer(pharmacist.token))
      .send({ items: rx.items.map((i) => ({ itemId: i.id, quantity: i.quantity })) })
      .expect(201);
  const status = async (visitId: string) => (await db.visit.findUniqueOrThrow({ where: { id: visitId } })).status;
  const queueEntry = async (visitId: string) =>
    (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body.visits.find((v: { id: string }) => v.id === visitId);

  beforeAll(async () => {
    tenantId = (await makeClinic('Flow Clinic')).id;
    [doctor, desk, tech, pharmacist] = await Promise.all([
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'PHARMACIST'),
    ]);
    hbTest = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', price: '100.00' } })).id;
    drugId = (await db.drug.create({ data: { tenantId, genericName: 'Paracetamol', form: 'tablet', unit: 'tablet', sellPrice: '1.50' } })).id;
    await db.stockBatch.create({ data: { drugId, batchNo: 'PCM-1', expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: 500, costPrice: '1.00' } });
  });

  it("won't complete a visit while a lab result hasn't reached the doctor", async () => {
    const visitId = await openVisit();
    const hb = await orderHb(visitId);
    const refused = await move(visitId, 'COMPLETED').expect(409);
    expect(refused.body.message).toContain('Hemoglobin');
    expect((await queueEntry(visitId)).labPending).toBe(true);

    await move(visitId, 'AWAITING_LAB').expect(200);
    await move(visitId, 'COMPLETED').expect(409);
    await lab(hb.id, 'collect');
    await lab(hb.id, 'result', { value: '13' });
    await move(visitId, 'COMPLETED').expect(409); // entered but not verified
    await lab(hb.id, 'verify');

    const entry = await queueEntry(visitId);
    expect([entry.labPending, entry.labReady]).toEqual([false, true]);
    await move(visitId, 'IN_CONSULTATION').expect(200); // back to the doctor with the result
    await move(visitId, 'COMPLETED').expect(200);
  });

  it('lets a cancelled test (sample never taken) stop blocking completion', async () => {
    const visitId = await openVisit();
    const hb = await orderHb(visitId);
    await api.post(`/lab-orders/${hb.id}/cancel`).set(bearer(doctor.token)).expect(201);
    await move(visitId, 'COMPLETED').expect(200);
  });

  it('sends a patient with drugs to collect to the pharmacy instead of closing the visit', async () => {
    const visitId = await openVisit();
    const rx = await prescribe(visitId);
    const refused = await move(visitId, 'COMPLETED').expect(409);
    expect(refused.body.message).toContain('pharmacy');
    expect((await queueEntry(visitId)).rxPending).toBe(true);

    await move(visitId, 'AWAITING_PHARMACY').expect(200);
    await dispenseAll(rx);
    expect(await status(visitId)).toBe('COMPLETED');
    expect((await queueEntry(visitId)).rxPending).toBe(false);
  });

  it("keeps the visit open after dispensing if a result is still on its way, and lets the patient go back to the doctor", async () => {
    const visitId = await openVisit();
    const hb = await orderHb(visitId);
    const rx = await prescribe(visitId);
    await move(visitId, 'AWAITING_PHARMACY').expect(200);
    await dispenseAll(rx);
    expect(await status(visitId)).toBe('AWAITING_PHARMACY'); // not closed: Hb result unseen
    await move(visitId, 'COMPLETED').expect(409);

    await lab(hb.id, 'collect');
    await lab(hb.id, 'result', { value: '9' });
    await lab(hb.id, 'verify');
    await move(visitId, 'IN_CONSULTATION').expect(200); // pharmacy -> doctor is now allowed
    await move(visitId, 'COMPLETED').expect(200);
  });

  it('lets staff close a pharmacy visit when the patient leaves without the drugs', async () => {
    const visitId = await openVisit();
    await prescribe(visitId);
    await move(visitId, 'AWAITING_PHARMACY').expect(200);
    await move(visitId, 'COMPLETED').expect(200);
  });
});
