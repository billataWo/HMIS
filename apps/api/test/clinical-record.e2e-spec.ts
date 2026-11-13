import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** The record beyond one visit: problem list, vitals over time, addenda and the patient's summary. */
describe('problem list, vitals trend, addenda and visit summary', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, doctor: Staff, cashier: Staff;
  let patientId: string;
  let amlo: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Record Clinic ${Date.now()}`)).id;
    [desk, nurse, doctor, cashier] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'NURSE'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'CASHIER')]);
    patientId = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Chronic', fatherName: 'Care', sex: 'MALE', ageYears: 58 }).expect(201)).body.id;
    amlo = (await db.drug.create({ data: { tenantId, genericName: 'Amlodipine', strength: '5 mg', drugClass: 'calcium channel blocker', form: 'tablet', unit: 'tablet', sellPrice: '2' } })).id;
  });

  /** A consultation with these vitals, closed. */
  const visit = async (vitals: object, close = true) => {
    const id = (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body.id as string;
    await api.patch(`/visits/${id}`).set(bearer(nurse.token)).send(vitals).expect(200);
    await api.patch(`/visits/${id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    if (close) {
      await db.visit.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    }
    return id;
  };

  it('keeps the problem list: added by the doctor, once, and resolved later', async () => {
    const add = (body: object, who = doctor) => api.post(`/patients/${patientId}/problems`).set(bearer(who.token)).send(body);
    await add({ label: 'Hypertension' }, nurse).expect(403);
    const htn = (await add({ icd11Code: 'BA00', label: 'Essential hypertension', since: '2019-03-01' }).expect(201)).body;
    await add({ icd11Code: 'BA00', label: 'High blood pressure' }).expect(409); // already listed
    const dm = (await add({ label: 'Type 2 diabetes' }).expect(201)).body;
    await api.patch(`/problems/${dm.id}`).set(bearer(doctor.token)).send({ status: 'RESOLVED' }).expect(200);
    const list = (await api.get(`/patients/${patientId}/problems`).set(bearer(nurse.token)).expect(200)).body;
    expect(list.map((p: { label: string; status: string }) => [p.label, p.status])).toEqual([
      ['Essential hypertension', 'ACTIVE'],
      ['Type 2 diabetes', 'RESOLVED'],
    ]);
    expect(list[0].since.slice(0, 10)).toBe('2019-03-01');
    expect(list[1].resolvedAt).toBeTruthy();
    expect(htn.createdById).toBe(doctor.id);
    await api.get(`/patients/${patientId}/problems`).set(bearer(cashier.token)).expect(403);
  });

  it('shows the vitals of the last visits, newest first', async () => {
    await visit({ systolicBp: 168, diastolicBp: 102, weightKg: 91 });
    await visit({ systolicBp: 150, diastolicBp: 94, weightKg: 89 });
    const rows = (await api.get(`/patients/${patientId}/vitals`).set(bearer(doctor.token)).expect(200)).body;
    expect(rows.slice(0, 2).map((r: { systolicBp: number }) => r.systolicBp)).toEqual([150, 168]);
  });

  it('adds signed addenda to a closed visit, never edited', async () => {
    const id = await visit({ systolicBp: 140, diastolicBp: 90 });
    await api.patch(`/visits/${id}`).set(bearer(doctor.token)).send({ plan: 'changed' }).expect(409); // closed
    await api.post(`/visits/${id}/addenda`).set(bearer(cashier.token)).send({ text: 'Not mine to add' }).expect(403);
    await api.post(`/visits/${id}/addenda`).set(bearer(doctor.token)).send({ text: 'x' }).expect(400);
    await api.post(`/visits/${id}/addenda`).set(bearer(doctor.token)).send({ text: 'Creatinine came back normal; continue amlodipine.' }).expect(201);
    const v = (await api.get(`/visits/${id}`).set(bearer(nurse.token)).expect(200)).body;
    expect(v.addenda[0]).toMatchObject({ text: 'Creatinine came back normal; continue amlodipine.', author: { id: doctor.id } });
    const row = await db.visitAddendum.findFirstOrThrow({ where: { visitId: id } });
    await expect(db.visitAddendum.update({ where: { id: row.id }, data: { text: 'rewritten' } })).rejects.toThrow(/permanent record/);
  });

  it("gives the patient a summary: diagnoses, medicines, results, next appointment and advice", async () => {
    const id = await visit({ systolicBp: 150, diastolicBp: 95 }, false);
    await api.patch(`/visits/${id}`).set(bearer(doctor.token)).send({ patientAdvice: 'Less salt; walk 30 minutes a day.' }).expect(200);
    await api.patch(`/visits/${id}`).set(bearer(nurse.token)).send({ patientAdvice: 'not a nurse note' }).expect(403);
    await api.post(`/visits/${id}/diagnoses`).set(bearer(doctor.token)).send({ icd11Code: 'BA00', label: 'Essential hypertension', isPrimary: true }).expect(201);
    await api.post(`/visits/${id}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: amlo, dose: '5 mg', frequency: 'OD', durationDays: 30, quantity: 30 }] }).expect(201);
    const at = new Date(Date.now() + 30 * 86_400_000);
    await db.appointment.create({ data: { tenantId, patientId, scheduledAt: at, reason: 'BP review' } });

    await api.get(`/visits/${id}/summary`).set(bearer(cashier.token)).expect(403);
    const s = (await api.get(`/visits/${id}/summary`).set(bearer(doctor.token)).expect(200)).body;
    expect(s).toMatchObject({
      patientAdvice: 'Less salt; walk 30 minutes a day.',
      diagnoses: [{ label: 'Essential hypertension', isPrimary: true }],
      medicines: [{ dose: '5 mg', frequency: 'OD', durationDays: 30, drug: { genericName: 'Amlodipine' } }],
      nextAppointment: { reason: 'BP review' },
    });
    expect(s.prescriptions).toBeUndefined();
  });
});
