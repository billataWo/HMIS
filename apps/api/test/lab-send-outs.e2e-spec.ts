import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Tests done at a reference lab: sent, tracked, the result entered when it comes back. */
describe('lab: send-out tests', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, tech: Staff, admin: Staff, pharmacist: Staff;
  let tsh: string, hb: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Lab Send-out Clinic ${Date.now()}`)).id;
    [desk, doctor, tech, admin, pharmacist] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'ADMIN'),
      makeStaff(tenantId, 'PHARMACIST'),
    ]);
    tsh = (await db.labTest.create({ data: { tenantId, name: 'TSH', unit: 'mIU/L', refLow: '0.4', refHigh: '4', price: '0', resultOptions: [], specimen: 'SERUM', tatMinutes: 3 * 24 * 60 } })).id;
    hb = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', price: '0', resultOptions: [] } })).id;
  });

  /** A test ordered for a new patient; its sample taken unless asked not to. */
  const ordered = async (labTestId: string, collect = true) => {
    const patientId = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Send', fatherName: 'Out', sex: 'MALE', ageYears: 60 }).expect(201)).body.id;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const [o] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [labTestId] }).expect(201)).body;
    if (collect) await api.post(`/lab-orders/${o.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    return { visitId, id: o.id as string };
  };
  const send = (id: string, body: object, who = tech) => api.post(`/lab-orders/${id}/send`).set(bearer(who.token)).send(body);

  it('marks a test as sent out, with its usual reference lab', async () => {
    const t = (await api.patch(`/catalog/lab-tests/${tsh}`).set(bearer(admin.token)).send({ sendOut: true, referenceLab: 'Ethio Reference Lab' }).expect(200)).body;
    expect(t).toMatchObject({ sendOut: true, referenceLab: 'Ethio Reference Lab' });
  });

  it('sends a sample once it is taken, and tracks it until the result comes back', async () => {
    const before = await ordered(tsh, false);
    await send(before.id, { to: 'Ethio Reference Lab' }).expect(409); // no sample yet
    const { visitId, id } = await ordered(tsh);
    await send(id, { to: 'Ethio Reference Lab' }, pharmacist).expect(403);
    await send(id, { to: ' ' }).expect(400);
    const sent = (await send(id, { to: 'Ethio Reference Lab', ref: 'ERL-5531' }).expect(201)).body;
    expect(sent).toMatchObject({ status: 'SAMPLE_COLLECTED', sentTo: 'Ethio Reference Lab', sentRef: 'ERL-5531' });
    expect(sent.sentAt).toBeTruthy();
    await send(id, { to: 'Other Lab' }).expect(409); // already out

    const out = (await api.get('/lab/send-outs').set(bearer(tech.token)).expect(200)).body;
    const mine = out.outstanding.find((o: { id: string }) => o.id === id);
    expect(mine).toMatchObject({ sentTo: 'Ethio Reference Lab', targetMinutes: 3 * 24 * 60, visit: { id: visitId } });
    expect(out.sent.some((o: { id: string }) => o.id === id)).toBe(true); // on today's dispatch list
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const old = (await api.get(`/lab/send-outs?day=${yesterday}`).set(bearer(tech.token)).expect(200)).body;
    expect(old.sent.some((o: { id: string }) => o.id === id)).toBe(false);
    await api.get('/lab/send-outs?day=13-11-2026').set(bearer(tech.token)).expect(400);
    await api.get('/lab/send-outs').set(bearer(doctor.token)).expect(403);
    // The doctor sees where it is.
    const forDoctor = (await api.get(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).expect(200)).body;
    expect(forDoctor[0].sentTo).toBe('Ethio Reference Lab');

    // The result comes back: entered and released as usual; the report says where it was done.
    await api.post(`/lab-orders/${id}/result`).set(bearer(tech.token)).send({ value: '7.2' }).expect(201);
    await api.post(`/lab-orders/${id}/unsend`).set(bearer(tech.token)).expect(409); // the result is in
    await api.post(`/lab-orders/${id}/verify`).set(bearer(tech.token)).send({}).expect(201);
    const report = (await api.get(`/visits/${visitId}/lab-report`).set(bearer(doctor.token)).expect(200)).body;
    expect(report.labOrders[0]).toMatchObject({ resultValue: '7.2', resultFlag: 'H', sentTo: 'Ethio Reference Lab', sentRef: 'ERL-5531' });
    const after = (await api.get('/lab/send-outs').set(bearer(tech.token)).expect(200)).body;
    expect(after.outstanding.some((o: { id: string }) => o.id === id)).toBe(false);
  });

  it('can send any test (the analyser is down), and take it back if it never left', async () => {
    const { id } = await ordered(hb);
    await send(id, { to: 'St. Paul Hospital lab' }).expect(201);
    const back = (await api.post(`/lab-orders/${id}/unsend`).set(bearer(tech.token)).expect(201)).body;
    expect(back).toMatchObject({ sentTo: null, sentAt: null, status: 'SAMPLE_COLLECTED' });
    await api.post(`/lab-orders/${id}/unsend`).set(bearer(tech.token)).expect(409);
    // Labs used before are suggested.
    const labs = (await api.get('/lab/reference-labs').set(bearer(tech.token)).expect(200)).body;
    expect(labs).toEqual(expect.arrayContaining(['Ethio Reference Lab']));
  });

  it("starts again when the reference lab rejects the sample", async () => {
    const { id } = await ordered(tsh);
    await send(id, { to: 'Ethio Reference Lab', ref: 'ERL-9' }).expect(201);
    await api.post(`/lab-orders/${id}/reject`).set(bearer(tech.token)).send({ reason: 'HAEMOLYSED', note: 'reported by the reference lab' }).expect(201);
    const o = await db.labOrder.findUniqueOrThrow({ where: { id } });
    expect(o).toMatchObject({ status: 'ORDERED', sentTo: null, sentRef: null, sentAt: null, rejectReason: 'Haemolysed: reported by the reference lab' });
    await api.post(`/lab-orders/${id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    await send(id, { to: 'Ethio Reference Lab' }).expect(201);
  });
});
