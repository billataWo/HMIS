import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

describe('consultation (EMR)', () => {
  let doctor: { id: string; token: string };
  let nurse: { id: string; token: string };
  let desk: { id: string; token: string };
  let cashier: { id: string; token: string };
  let patientId: string;
  let visitId: string; // the first visit, carried through triage, consultation and completion

  const checkIn = async () =>
    (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body as { id: string };
  const move = (id: string, status: string) =>
    api.patch(`/visits/${id}/status`).set(bearer(doctor.token)).send({ status }).expect(200);
  const save = (id: string, token: string, body: object) => api.patch(`/visits/${id}`).set(bearer(token)).send(body);
  const diagnose = (id: string, body: object, token = doctor.token) =>
    api.post(`/visits/${id}/diagnoses`).set(bearer(token)).send(body);

  beforeAll(async () => {
    const clinic = await makeClinic('EMR Clinic');
    doctor = await makeStaff(clinic.id, 'DOCTOR');
    nurse = await makeStaff(clinic.id, 'NURSE');
    desk = await makeStaff(clinic.id, 'RECEPTIONIST');
    cashier = await makeStaff(clinic.id, 'CASHIER');
    patientId = (
      await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Liya', fatherName: 'Mekonnen', sex: 'FEMALE', ageYears: 34 }).expect(201)
    ).body.id;
  });

  it('lets a nurse triage: vitals and chief complaint only', async () => {
    visitId = (await checkIn()).id;
    const res = await save(visitId, nurse.token, { temperatureC: 38.6, pulse: 102, systolicBp: 128, diastolicBp: 84, spo2: 97, weightKg: 61.5, chiefComplaint: 'Fever for 3 days' }).expect(200);
    expect(res.body.temperatureC).toBe('38.6');
    expect(res.body.chiefComplaint).toBe('Fever for 3 days');
    await save(visitId, nurse.token, { plan: 'Antibiotics' }).expect(403);
    await diagnose(visitId, { icd11Code: '1F40', label: 'Malaria' }, nurse.token).expect(403);
  });

  it('rejects impossible vitals', async () => {
    const res = await save(visitId, doctor.token, { temperatureC: 52, systolicBp: 80, diastolicBp: 90 }).expect(400);
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['diastolicBp', 'temperatureC']);
  });

  it('records a full consultation and locks it once completed', async () => {
    await move(visitId, 'IN_CONSULTATION');
    await save(visitId, doctor.token, { history: 'Chills, headache', examination: 'Febrile, no neck stiffness', plan: 'Malaria RDT, review with result' }).expect(200);

    const first = (await diagnose(visitId, { icd11Code: '1f40', label: 'Malaria due to Plasmodium falciparum' }).expect(201)).body;
    expect(first.icd11Code).toBe('1F40');
    expect(first.isPrimary).toBe(true);
    const second = (await diagnose(visitId, { icd11Code: 'MG26', label: 'Fever' }).expect(201)).body;
    expect(second.isPrimary).toBe(false);
    await diagnose(visitId, { icd11Code: '1F40', label: 'Again' }).expect(409);
    await diagnose(visitId, { icd11Code: 'not-a-code', label: 'Bad' }).expect(400);

    // Removing the primary promotes the next one.
    await api.delete(`/visits/${visitId}/diagnoses/${first.id}`).set(bearer(doctor.token)).expect(204);
    let visit = (await api.get(`/visits/${visitId}`).set(bearer(doctor.token)).expect(200)).body;
    expect(visit.diagnoses).toEqual([expect.objectContaining({ icd11Code: 'MG26', isPrimary: true })]);

    // Adding a new primary demotes the old one.
    await diagnose(visitId, { icd11Code: '1F40', label: 'Malaria due to Plasmodium falciparum', isPrimary: true }).expect(201);
    visit = (await api.get(`/visits/${visitId}`).set(bearer(doctor.token)).expect(200)).body;
    expect(visit.diagnoses.map((d: { icd11Code: string; isPrimary: boolean }) => [d.icd11Code, d.isPrimary])).toEqual([
      ['1F40', true],
      ['MG26', false],
    ]);

    await move(visitId, 'COMPLETED');
    await save(visitId, doctor.token, { plan: 'Changed later' }).expect(409);
    await diagnose(visitId, { icd11Code: 'CA40', label: 'Pneumonia' }).expect(409);
  });

  it('shows previous visits on the next consultation', async () => {
    const v = await checkIn();
    const res = await api.get(`/visits/${v.id}`).set(bearer(doctor.token)).expect(200);
    expect(res.body.previous).toHaveLength(1);
    expect(res.body.previous[0].plan).toBe('Malaria RDT, review with result');
    expect(res.body.previous[0].diagnoses.map((d: { icd11Code: string }) => d.icd11Code).sort()).toEqual(['1F40', 'MG26']);
    await move(v.id, 'IN_CONSULTATION');
    await move(v.id, 'COMPLETED');
  });

  it('keeps clinical content away from non-clinical staff', async () => {
    await api.get(`/visits/${visitId}`).set(bearer(cashier.token)).expect(403);
    await api.get(`/visits/${visitId}`).set(bearer(desk.token)).expect(403);

    const forCashier = (await api.get(`/patients/${patientId}`).set(bearer(cashier.token)).expect(200)).body;
    expect(forCashier.visits.length).toBeGreaterThan(0);
    expect(forCashier.visits[0].diagnoses).toBeUndefined();
    expect(forCashier.visits[0].chiefComplaint).toBeUndefined();

    const forDoctor = (await api.get(`/patients/${patientId}`).set(bearer(doctor.token)).expect(200)).body;
    expect(forDoctor.visits.some((v: { diagnoses: unknown[] }) => v.diagnoses.length > 0)).toBe(true);
  });

  it('does not log clinical content in the audit trail', async () => {
    const entries = await db.auditLog.findMany({ where: { action: 'visit.update', userId: doctor.id } });
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries.map((e) => e.data))).not.toMatch(/Chills|Febrile|Malaria RDT/);
  });

  it('keeps visits private to their clinic', async () => {
    const other = await makeClinic('Other EMR Clinic');
    const otherDoctor = await makeStaff(other.id, 'DOCTOR');
    await api.get(`/visits/${visitId}`).set(bearer(otherDoctor.token)).expect(404);
    await save(visitId, otherDoctor.token, { pulse: 80 }).expect(404);
  });

  it('searches the common ICD-11 list in English, Amharic and by code', async () => {
    const find = async (q: string) =>
      (await api.get('/icd11').query({ q }).set(bearer(doctor.token)).expect(200)).body.map((d: { code: string }) => d.code);
    expect(await find('pneumonia')).toEqual(['CA40']);
    expect(await find('ወባ')).toEqual(expect.arrayContaining(['1F40', '1F41', '1F4Z']));
    expect(await find('BA00')).toEqual(['BA00']);
    expect(await find('uti')).toContain('GC08');
  });
});
