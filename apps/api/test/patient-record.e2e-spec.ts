import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** The registration record: structured address, next of kin, national ID, and merging duplicates. */
describe('patient record and merging duplicates', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, admin: Staff;
  const tag = Date.now() % 100000;
  const nid = (n: number) => `${String(tag).padStart(6, '0')}${String(n).padStart(6, '0')}`; // 12 digits

  beforeAll(async () => {
    tenantId = (await makeClinic(`Record Desk Clinic ${Date.now()}`)).id;
    [desk, doctor, admin] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'ADMIN')]);
  });

  const register = (body: object) => api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Almaz', fatherName: `Record${tag}`, sex: 'FEMALE', ageYears: 30, ...body });
  const search = async (q: string) => (await api.get('/patients').query({ q }).set(bearer(desk.token)).expect(200)).body as { id: string; mrn: string }[];

  it('keeps a structured address, next of kin and one record per national ID', async () => {
    const id = nid(1);
    const p = (
      await register({
        region: 'Oromia',
        zone: 'East Shewa',
        woreda: 'Adama',
        kebele: '04',
        houseNo: '112',
        address: 'Behind the bus station',
        nextOfKinName: 'Kebede Tola',
        nextOfKinRelation: 'Husband',
        nextOfKinPhone: '0911 223344',
        nationalId: `${id.slice(0, 4)} ${id.slice(4, 8)}-${id.slice(8)}`,
      }).expect(201)
    ).body;
    expect(p).toMatchObject({ region: 'Oromia', woreda: 'Adama', kebele: '04', nextOfKinName: 'Kebede Tola', nationalId: id });
    expect((await search(id)).map((x) => x.id)).toContain(p.id);
    expect((await search(id.slice(4))).map((x) => x.id)).toContain(p.id);

    const again = await register({ firstName: 'Other', nationalId: id }).expect(409);
    expect(again.body.message).toMatch(new RegExp(`already registered, as ${p.mrn}`));
    await register({ nationalId: '12345' }).expect(400);
    await register({ region: 'Atlantis' }).expect(400);
    expect((await register({ region: '' }).expect(201)).body.region).toBeNull();

    const other = (await register({ firstName: 'Second', nationalId: nid(2) }).expect(201)).body;
    await api.patch(`/patients/${other.id}`).set(bearer(desk.token)).send({ nationalId: id }).expect(409);
    expect((await api.patch(`/patients/${other.id}`).set(bearer(desk.token)).send({ region: '', kebele: '' }).expect(200)).body.kebele).toBeNull();
  });

  it('merges a duplicate: its history moves, missing details are filled, its old MRN still finds the patient', async () => {
    const keep = (await register({ firstName: 'Tigist', ageYears: 40, allergies: ['Penicillin'] }).expect(201)).body;
    const dup = (await register({ firstName: 'Tigist', ageYears: undefined, dateOfBirth: '1986-03-15', phone: '0922 334455', allergies: ['Sulfa'], nationalId: nid(3), kebele: '09' }).expect(201)).body;
    // The duplicate's history: a finished visit, a booking, a problem.
    const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: dup.id }).expect(201)).body.id;
    await db.visit.update({ where: { id: visit }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await api.post('/appointments').set(bearer(desk.token)).send({ patientId: dup.id, scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), reason: 'Review' }).expect(201);
    await api.post(`/patients/${dup.id}/problems`).set(bearer(doctor.token)).send({ label: 'Asthma' }).expect(201);

    const merge = (body: object, who = admin, into = keep.id) => api.post(`/patients/${into}/merge`).set(bearer(who.token)).send(body);
    await merge({ duplicateId: dup.id }, desk).expect(403);
    await merge({ duplicateId: keep.id }).expect(409); // itself
    const r = (await merge({ duplicateId: dup.id }).expect(201)).body;
    expect(r.moved).toMatchObject({ visits: 1, appointments: 1, problems: 1 });
    expect(r).toMatchObject({ phone: '0922334455', kebele: '09', nationalId: nid(3), dobEstimated: false });
    expect(r.dateOfBirth.slice(0, 10)).toBe('1986-03-15');
    expect([...r.allergies].sort()).toEqual(['Penicillin', 'Sulfa']);

    // Hidden from search, but its MRN (on the old card) finds the kept record.
    const byOldMrn = await search(dup.mrn);
    expect(byOldMrn.map((x) => x.id)).toEqual([keep.id]);
    expect((await api.get(`/patients/${dup.id}`).set(bearer(desk.token)).expect(200)).body.mergedIntoId).toBe(keep.id);
    expect((await api.get(`/patients/${keep.id}/problems`).set(bearer(doctor.token)).expect(200)).body.map((x: { label: string }) => x.label)).toContain('Asthma');

    // No new work on the merged record.
    const checkIn = await api.post('/visits').set(bearer(desk.token)).send({ patientId: dup.id }).expect(409);
    expect(checkIn.body.message).toMatch(new RegExp(`merged into ${keep.mrn}`));
    await api.post('/appointments').set(bearer(desk.token)).send({ patientId: dup.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(409);
    await api.patch(`/patients/${dup.id}`).set(bearer(desk.token)).send({ phone: '0933 000000' }).expect(409);
    await merge({ duplicateId: dup.id }).expect(409); // already merged
    const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId, action: 'patient.merge' } });
    expect(audit.data).toMatchObject({ duplicate: dup.mrn });
  });

  it('refuses to merge different people or two open visits', async () => {
    const a = (await register({ firstName: 'Hana', nationalId: nid(4) }).expect(201)).body;
    const b = (await register({ firstName: 'Hana', nationalId: nid(5) }).expect(201)).body;
    const diff = await api.post(`/patients/${a.id}/merge`).set(bearer(admin.token)).send({ duplicateId: b.id }).expect(409);
    expect(diff.body.message).toMatch(/different national IDs/);

    const c = (await register({ firstName: 'Ruth' }).expect(201)).body;
    const d = (await register({ firstName: 'Ruth' }).expect(201)).body;
    await api.post('/visits').set(bearer(desk.token)).send({ patientId: c.id }).expect(201);
    await api.post('/visits').set(bearer(desk.token)).send({ patientId: d.id }).expect(201);
    const open = await api.post(`/patients/${c.id}/merge`).set(bearer(admin.token)).send({ duplicateId: d.id }).expect(409);
    expect(open.body.message).toMatch(/Both records have an open visit/);
  });
});
