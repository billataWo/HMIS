import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

const DAY = 86_400_000;
/** The clinic's day (Addis Ababa) shifted by whole days. */
const clinicDay = (by = 0) => new Date(Date.now() + 3 * 3_600_000 + by * DAY).toISOString().slice(0, 10);

/** Antenatal care: register, contacts on the 8-contact schedule, alerts, the due list, the tally, prescribing. */
describe('antenatal care', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, doctor: Staff, admin: Staff;

  beforeAll(async () => {
    tenantId = (await makeClinic(`ANC Clinic ${Date.now()}`)).id;
    [desk, nurse, doctor, admin] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'NURSE'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'ADMIN')]);
  });

  const woman = async (ageYears = 26, sex = 'FEMALE') =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Mother', fatherName: `Anc${Date.now() % 100000}`, sex, ageYears, phone: '0911333444' }).expect(201)).body.id as string;
  const register = (id: string, body: object, who = nurse) => api.post(`/patients/${id}/pregnancies`).set(bearer(who.token)).send({ gravida: 2, para: 1, ...body });

  it('registers one pregnancy at a time, from the last period or an ultrasound date', async () => {
    const id = await woman();
    await register(id, { lmp: clinicDay(-70) }, desk).expect(403);
    await register(await woman(30, 'MALE'), { lmp: clinicDay(-70) }).expect(409);
    await register(id, {}).expect(400); // a date is needed
    await register(id, { lmp: clinicDay(-70), para: 2 }).expect(400); // births must be fewer than pregnancies
    await register(id, { lmp: clinicDay(5) }).expect(409); // future
    const p = (await register(id, { lmp: clinicDay(-70), riskFactors: ['PREVIOUS_CAESAREAN'] }).expect(201)).body;
    expect(p.edd.slice(0, 10)).toBe(clinicDay(210)); // 280 days after the period
    await register(id, { lmp: clinicDay(-30) }).expect(409); // one at a time

    const us = await woman(40);
    const q = (await register(us, { edd: clinicDay(100), para: 5, gravida: 6 }).expect(201)).body;
    expect(q).toMatchObject({ eddSource: 'ULTRASOUND' });
    expect(q.lmp.slice(0, 10)).toBe(clinicDay(-180));
    const list = (await api.get(`/patients/${us}/pregnancies`).set(bearer(desk.token)).expect(200)).body;
    expect(list[0].gestation.weeks).toBe(25);
    expect(list[0].risks.map((r: { key: string }) => r.key)).toEqual(['AGE_35_PLUS', 'GRAND_MULTIPARA']);
  });

  it('numbers contacts, books the next on the 8-contact schedule and returns the alerts', async () => {
    const id = await woman();
    const p = (await register(id, { lmp: clinicDay(-70) }).expect(201)).body; // 10 weeks
    const first = (await api.post(`/pregnancies/${p.id}/contacts`).set(bearer(nurse.token)).send({ systolicBp: 110, diastolicBp: 70, hb: 12.1, syphilis: 'NEGATIVE', hiv: 'NEGATIVE', ifaTablets: 30 }).expect(201)).body;
    expect(first).toMatchObject({ contactNo: 1, gaWeeks: 10, alerts: [] });
    expect(first.nextContactOn.slice(0, 10)).toBe(clinicDay(70)); // 20 weeks
    await api.post(`/pregnancies/${p.id}/contacts`).set(bearer(nurse.token)).send({}).expect(409); // same day twice

    // A later contact (recorded today for a woman at 30 weeks) with pre-eclampsia signs.
    const late = await woman();
    const q = (await register(late, { lmp: clinicDay(-210) }).expect(201)).body;
    const c = (await api
      .post(`/pregnancies/${q.id}/contacts`)
      .set(bearer(doctor.token))
      .send({ systolicBp: 152, diastolicBp: 98, urineProtein: 'PLUS2', fetalHeartRate: 142, dangerSigns: ['HEADACHE'], hb: 9.8 })
      .expect(201)).body;
    expect(c.alerts.map((a: { level: string; text: string }) => `${a.level}: ${a.text}`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^URGENT: High blood pressure with protein/), expect.stringMatching(/^WARNING: Anaemia/), expect.stringMatching(/^URGENT: Danger sign: Severe headache/)]),
    );
    await api.post(`/pregnancies/${q.id}/contacts`).set(bearer(nurse.token)).send({ contactOn: clinicDay(1) }).expect(409);

    await api.post(`/pregnancies/${q.id}/end`).set(bearer(nurse.token)).send({ outcome: 'DELIVERED' }).expect(201);
    await api.post(`/pregnancies/${q.id}/contacts`).set(bearer(nurse.token)).send({ contactOn: clinicDay(-1) }).expect(409); // ended
    expect((await api.get(`/patients/${late}/pregnancies`).set(bearer(nurse.token)).expect(200)).body[0]).toMatchObject({ status: 'DELIVERED', outcome: 'DELIVERED' });
  });

  it('lists women late for their contact, and counts the month', async () => {
    const id = await woman();
    const p = (await register(id, { lmp: clinicDay(-200) }).expect(201)).body;
    // A contact a while back whose next date has long passed.
    await api.post(`/pregnancies/${p.id}/contacts`).set(bearer(nurse.token)).send({ contactOn: clinicDay(-60) }).expect(201);
    const due = (await api.get('/anc/due').set(bearer(desk.token)).expect(200)).body as { pregnancyId: string; late: boolean; daysLate: number }[];
    const row = due.find((r) => r.pregnancyId === p.id)!;
    expect(row.late).toBe(true);
    expect(row.daysLate).toBeGreaterThan(7);

    const tally = (await api.get('/reports/moh-monthly').set(bearer(admin.token)).expect(200)).body.anc;
    expect(tally.firstContacts).toBeGreaterThanOrEqual(2);
    expect(tally.firstBy12Weeks).toBeGreaterThanOrEqual(1);
    expect(tally.syphilisTested).toBeGreaterThanOrEqual(1);
  });

  it('treats a woman followed in antenatal care as pregnant when prescribing', async () => {
    const id = await woman();
    await register(id, { lmp: clinicDay(-100) }).expect(201);
    const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: id }).expect(201)).body.id;
    await api.patch(`/visits/${visit}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const drug = await db.drug.create({ data: { tenantId, genericName: 'Warfarin', strength: '5 mg', form: 'tablet', unit: 'tablet', sellPrice: '3' } });
    const r = await api.post(`/visits/${visit}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: drug.id, dose: '5 mg', frequency: 'OD', durationDays: 5, quantity: 5 }] }).expect(409);
    expect(r.body.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PREGNANCY', severity: 'BLOCK' })]));
  });

  it('voids a contact recorded by mistake, and flags an Rh-negative mother and a Td dose due', async () => {
    const id = await woman(24);
    const p = (await register(id, { lmp: clinicDay(-140), bloodGroup: 'O-' }).expect(201)).body; // 20 weeks
    const contact = (body: object = {}) => api.post(`/pregnancies/${p.id}/contacts`).set(bearer(nurse.token)).send(body);
    const first = (await contact({ contactOn: clinicDay(-7), systolicBp: 110, diastolicBp: 70 }).expect(201)).body;
    const wrong = (await contact({ systolicBp: 112, diastolicBp: 72 }).expect(201)).body;
    expect(wrong.contactNo).toBe(2);

    const voidIt = (cid: string, body: object, who = nurse) => api.post(`/anc-contacts/${cid}/void`).set(bearer(who.token)).send(body);
    await voidIt(wrong.id, { reason: 'x' }).expect(400);
    await voidIt(wrong.id, { reason: 'Entered for the wrong woman' }, desk).expect(403);
    await voidIt(first.id, { reason: 'Entered twice' }).expect(409); // only the latest
    await voidIt(wrong.id, { reason: 'Entered for the wrong woman' }).expect(201);
    await voidIt(wrong.id, { reason: 'Again' }).expect(409);

    // The day is free again and the next contact takes number 2; the voided one stays on record.
    const again = (await contact({ systolicBp: 108, diastolicBp: 70 }).expect(201)).body;
    expect(again.contactNo).toBe(2);
    const [view] = (await api.get(`/patients/${id}/pregnancies`).set(bearer(desk.token)).expect(200)).body;
    expect(view.contacts.map((c: { contactNo: number; voidedAt: string | null; voidReason: string | null }) => [c.contactNo, c.voidReason])).toEqual([
      [1, null],
      [2, 'Entered for the wrong woman'],
      [2, null],
    ]);
    expect(view.alerts.map((a: { text: string }) => a.text)).toEqual([expect.stringMatching(/^Rh-negative/), expect.stringMatching(/^Td 1 is due/)]);

    // Td 1 given today: Td 2 is not due for four weeks, so only the Rh alert is left.
    await api.post(`/patients/${id}/immunizations`).set(bearer(nurse.token)).send({ vaccine: 'TD', doseNo: 1 }).expect(201);
    const [after] = (await api.get(`/patients/${id}/pregnancies`).set(bearer(desk.token)).expect(200)).body;
    expect(after.alerts.map((a: { text: string }) => a.text)).toEqual([expect.stringMatching(/^Rh-negative/)]);
  });

});
