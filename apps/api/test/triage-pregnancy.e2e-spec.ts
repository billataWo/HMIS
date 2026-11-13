import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Triage priority orders the queue; pregnancy and breastfeeding are checked when prescribing. */
describe('triage priority and pregnancy-safe prescribing', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, doctor: Staff;
  const drugs: Record<string, string> = {};

  beforeAll(async () => {
    tenantId = (await makeClinic(`Triage Clinic ${Date.now()}`)).id;
    [desk, nurse, doctor] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'NURSE'), makeStaff(tenantId, 'DOCTOR')]);
    for (const [name, cls] of [
      ['Misoprostol', 'prostaglandin'],
      ['Warfarin', 'anticoagulant'],
      ['Codeine phosphate', 'opioid'],
      ['Paracetamol', 'analgesic'],
      ['Ibuprofen', 'nsaid'],
    ]) {
      drugs[name] = (await db.drug.create({ data: { tenantId, genericName: name, drugClass: cls, form: 'tablet', unit: 'tablet', sellPrice: '1' } })).id;
    }
  });

  const checkIn = async (sex: 'MALE' | 'FEMALE', ageYears = 30) => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Triage', fatherName: 'Patient', sex, ageYears }).expect(201)).body.id;
    return (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p }).expect(201)).body.id as string;
  };
  const triage = (visitId: string, body: object, who = nurse) => api.patch(`/visits/${visitId}`).set(bearer(who.token)).send(body);
  const prescribe = (visitId: string, name: string, extra: object = {}) =>
    api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: drugs[name], dose: '1 tablet', frequency: 'OD', quantity: 1 }], ...extra });
  const callIn = (visitId: string) => api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);

  it('puts an emergency at the top of the queue, whoever came first', async () => {
    const first = await checkIn('MALE');
    const second = await checkIn('MALE');
    await triage(second, { triageLevel: 'PURPLE' }).expect(400);
    await triage(second, { triageLevel: 'RED', spo2: 84, pulse: 128 }).expect(200);
    await triage(first, { triageLevel: 'GREEN' }).expect(200);
    const v = await db.visit.findUniqueOrThrow({ where: { id: second } });
    expect([v.triageLevel, v.triagedById, !!v.triagedAt]).toEqual(['RED', nurse.id, true]);
    const queue = (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body.visits.map((x: { id: string }) => x.id);
    expect(queue.indexOf(second)).toBeLessThan(queue.indexOf(first));
  });

  it('records pregnancy for women only, with a recent last period, and MUAC', async () => {
    const man = await checkIn('MALE');
    await triage(man, { pregnancyStatus: 'PREGNANT' }).expect(409);
    const woman = await checkIn('FEMALE');
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await triage(woman, { pregnancyStatus: 'PREGNANT', lmpDate: future }).expect(400);
    const lmp = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10); // 10 weeks
    await triage(woman, { pregnancyStatus: 'PREGNANT', lmpDate: lmp, breastfeeding: false, muacMm: 228 }).expect(200);
    const v = await db.visit.findUniqueOrThrow({ where: { id: woman } });
    expect([v.pregnancyStatus, v.lmpDate?.toISOString().slice(0, 10), v.breastfeeding, v.muacMm]).toEqual(['PREGNANT', lmp, false, 228]);
  });

  it('blocks what is not given in pregnancy unless the doctor gives a reason', async () => {
    const visitId = await checkIn('FEMALE');
    const lmp = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
    await triage(visitId, { pregnancyStatus: 'PREGNANT', lmpDate: lmp }).expect(200);
    await callIn(visitId);

    const first = (await prescribe(visitId, 'Misoprostol').expect(409)).body;
    expect(first.alerts[0]).toMatchObject({ type: 'PREGNANCY', severity: 'BLOCK' });
    expect(first.alerts[0].message).toMatch(/is 10 weeks pregnant/);
    const noReason = (await prescribe(visitId, 'Misoprostol', { acknowledgeAlerts: true }).expect(409)).body;
    expect(noReason.message).toMatch(/despite the pregnancy or breastfeeding alert/);
    const rx = (await prescribe(visitId, 'Misoprostol', { acknowledgeAlerts: true, overrideReason: 'Incomplete miscarriage, per protocol' }).expect(201)).body;
    expect(rx.alerts[0].type).toBe('PREGNANCY');

    // Ibuprofen is fine at 10 weeks (the warning starts at 20); paracetamol always.
    await prescribe(visitId, 'Ibuprofen').expect(201);
    await prescribe(visitId, 'Paracetamol').expect(201);
  });

  it('asks the doctor to check pregnancy when it was not recorded, and warns while breastfeeding', async () => {
    const unknown = await checkIn('FEMALE', 25);
    await callIn(unknown);
    const ask = (await prescribe(unknown, 'Warfarin').expect(409)).body;
    expect(ask.alerts[0]).toMatchObject({ type: 'PREGNANCY', severity: 'MODERATE', message: expect.stringMatching(/ask whether she could be pregnant/) });
    await prescribe(unknown, 'Warfarin', { acknowledgeAlerts: true }).expect(201); // a reminder, no reason needed

    const feeding = await checkIn('FEMALE', 27);
    await triage(feeding, { pregnancyStatus: 'NOT_PREGNANT', breastfeeding: true }).expect(200);
    await callIn(feeding);
    const codeine = (await prescribe(feeding, 'Codeine phosphate').expect(409)).body;
    expect(codeine.alerts[0]).toMatchObject({ type: 'BREASTFEEDING', severity: 'MAJOR' });

    // A man is never asked.
    const man = await checkIn('MALE');
    await callIn(man);
    await prescribe(man, 'Warfarin').expect(201);
  });
});
