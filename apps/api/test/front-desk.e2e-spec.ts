import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today in the clinic's time zone, as the API counts it. */
const clinicToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** Front desk safety: ages of babies, Ethiopian birth dates, emergencies before payment, transfers, cancel reasons. */
describe('front desk safety', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, doctor: Staff, doctor2: Staff, cashier: Staff, admin: Staff, tech: Staff;
  let feeId: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Front Desk Clinic ${Date.now()}`, { requirePrepayment: true })).id;
    [desk, nurse, doctor, doctor2, cashier, admin, tech] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'NURSE'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'ADMIN'),
      makeStaff(tenantId, 'LAB_TECH'),
    ]);
    feeId = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'Consultation', price: '150.00' } })).id;
  });

  const register = (body: object) =>
    api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Baby', fatherName: `Desk${Date.now() % 100000}`, sex: 'FEMALE', ...body });

  it('dates an age from today, in years and months, and marks it estimated', async () => {
    const baby = (await register({ ageMonths: 3 }).expect(201)).body;
    const expected = new Date(`${clinicToday()}T00:00:00Z`);
    expected.setUTCMonth(expected.getUTCMonth() - 3);
    expect(iso(new Date(baby.dateOfBirth)).slice(0, 7)).toBe(iso(expected).slice(0, 7));
    expect(baby.dobEstimated).toBe(true);

    const toddler = (await register({ ageYears: 1, ageMonths: 4 }).expect(201)).body;
    const months = (Date.now() - new Date(toddler.dateOfBirth).getTime()) / (30.44 * 86_400_000);
    expect(Math.round(months)).toBe(16);

    await register({ ageMonths: 12 }).expect(400);
    await register({ ageYears: 30, dateOfBirth: '1996-01-01' }).expect(400);
    await register({ dateOfBirth: '2999-01-01' }).expect(400);

    // A correction to an exact date clears "estimated".
    const fixed = (await api.patch(`/patients/${baby.id}`).set(bearer(desk.token)).send({ dateOfBirth: iso(expected) }).expect(200)).body;
    expect(fixed.dobEstimated).toBe(false);
  });

  it('takes a birth date in the Ethiopian calendar', async () => {
    // 1 Meskerem 2010 is 11 September 2017; Pagume 6 exists only in a leap year (2015 EC, not 2016 EC).
    expect((await register({ dateOfBirthEc: '2010-01-01' }).expect(201)).body.dateOfBirth.slice(0, 10)).toBe('2017-09-11');
    expect((await register({ dateOfBirthEc: '2015-13-06' }).expect(201)).body.dateOfBirth.slice(0, 10)).toBe('2023-09-11');
    const bad = await register({ dateOfBirthEc: '2016-13-06' }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/no such day in the Ethiopian calendar/);
    await register({ dateOfBirthEc: '2010-02-31' }).expect(400);
    await register({ dateOfBirthEc: '2010-01-01', ageYears: 8 }).expect(400);
  });

  it('lets the doctor and the lab start on an emergency before payment; the fee stays owed', async () => {
    const pid = (await register({ ageYears: 40, sex: 'MALE' }).expect(201)).body.id;
    const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: pid, serviceId: feeId, doctorId: doctor.id }).expect(201)).body.id;
    // Not an emergency: pay first.
    await api.patch(`/visits/${visit}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(409);
    await api.patch(`/visits/${visit}`).set(bearer(nurse.token)).send({ triageLevel: 'ORANGE' }).expect(200);
    await api.patch(`/visits/${visit}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(409);
    await api.patch(`/visits/${visit}`).set(bearer(nurse.token)).send({ triageLevel: 'RED' }).expect(200);
    await api.patch(`/visits/${visit}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: visit, action: 'visit.status' }, orderBy: { createdAt: 'desc' } });
    expect(audit.data).toMatchObject({ emergencyUnpaid: true });

    // The lab takes the emergency's sample unpaid too.
    const test = await db.labTest.create({ data: { tenantId, name: `Glucose ${Date.now()}`, price: '50' } });
    const order = (await api.post(`/visits/${visit}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [test.id] }).expect(201)).body;
    const orderId = (Array.isArray(order) ? order[0] : order).id;
    const work = (await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body;
    expect(work.open.find((o: { id: string }) => o.id === orderId)).toMatchObject({ paid: false, emergency: true });
    await api.post(`/lab-orders/${orderId}/collect`).set(bearer(tech.token)).send({}).expect(201);

    // The bill follows: still owed.
    const v = (await api.get(`/visits/${visit}`).set(bearer(doctor.token)).expect(200)).body;
    expect(v.consultationPaid).toBe(false);
    const q = (await api.get('/queue').set(bearer(desk.token)).expect(200)).body;
    expect(Number(q.visits.find((x: { id: string }) => x.id === visit).owed)).toBeGreaterThanOrEqual(150); // the fee, on the Owes badge
  });

  it('moves a waiting patient to another doctor, only while waiting', async () => {
    const pid = (await register({ ageYears: 25 }).expect(201)).body.id;
    const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: pid, doctorId: doctor.id }).expect(201)).body.id;
    const move = (body: object, who = desk) => api.patch(`/visits/${visit}/doctor`).set(bearer(who.token)).send(body);
    await move({ doctorId: doctor2.id }, cashier).expect(403);
    await move({ doctorId: doctor.id }).expect(409); // already theirs
    await move({ doctorId: nurse.id }).expect(404); // not a doctor
    expect((await move({ doctorId: doctor2.id }).expect(200)).body.doctor.id).toBe(doctor2.id);
    expect((await move({ doctorId: null }).expect(200)).body.doctorId).toBeNull(); // whoever is free
    await move({ doctorId: doctor.id }).expect(200);
    await api.patch(`/visits/${visit}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    await move({ doctorId: doctor2.id }).expect(409);
  });

  it('records why a visit was cancelled and counts those who left without being seen', async () => {
    const cancel = async (reason?: string) => {
      const pid = (await register({ ageYears: 33 }).expect(201)).body.id;
      const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: pid }).expect(201)).body.id;
      await api.patch(`/visits/${visit}/status`).set(bearer(desk.token)).send({ status: 'CANCELLED', ...(reason && { reason }) }).expect(200);
      return visit;
    };
    const left = await cancel('LEFT_WITHOUT_BEING_SEEN');
    await cancel('LEFT_WITHOUT_BEING_SEEN');
    await cancel('CHECKED_IN_BY_MISTAKE');
    await cancel(); // an older client sends no reason
    expect((await db.visit.findUniqueOrThrow({ where: { id: left } })).cancelReason).toBe('LEFT_WITHOUT_BEING_SEEN');
    await api.patch(`/visits/${left}/status`).set(bearer(desk.token)).send({ status: 'CANCELLED', reason: 'BORED' }).expect(400);

    const d = (await api.get('/reports/dashboard').set(bearer(admin.token)).expect(200)).body;
    expect(d.patients.cancelled).toBeGreaterThanOrEqual(4);
    expect(d.patients.cancelledByReason).toMatchObject({ LEFT_WITHOUT_BEING_SEEN: 2, CHECKED_IN_BY_MISTAKE: 1, NOT_GIVEN: 1 });
  });
});
