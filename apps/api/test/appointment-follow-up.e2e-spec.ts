import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

const DAY = 86_400_000;
/** Today in the clinic (Addis Ababa), shifted by whole days. */
const clinicDay = (by = 0) => new Date(Date.now() + 3 * 3_600_000 + by * DAY).toISOString().slice(0, 10);
const at = (day: string, time = '09:00') => `${day}T${time}:00+03:00`;

/** Appointments followed through: reminder calls, missed ones traced, moves, load, referrals in. */
describe('appointment follow-up', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, cashier: Staff, admin: Staff;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Follow-up Clinic ${Date.now()}`)).id;
    [desk, doctor, cashier, admin] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'CASHIER'), makeStaff(tenantId, 'ADMIN')]);
  });

  const patient = async (firstName: string) =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName, fatherName: `Appt${Date.now() % 100000}`, sex: 'FEMALE', ageYears: 50, phone: '0911000111' }).expect(201)).body.id as string;
  const book = async (patientId: string, day: string, doctorId?: string) =>
    (await api.post('/appointments').set(bearer(desk.token)).send({ patientId, scheduledAt: at(day), ...(doctorId && { doctorId }) }).expect(201)).body.id as string;
  /** An appointment that was booked for a past day and never kept. */
  const pastBooking = async (patientId: string, daysAgo: number) =>
    (await db.appointment.create({ data: { tenantId, patientId, scheduledAt: new Date(at(clinicDay(-daysAgo))), reason: 'BP review' } })).id;

  it('marks appointments of past days missed when the lists are read', async () => {
    const id = await pastBooking(await patient('Missed'), 2);
    await api.get('/appointments').set(bearer(cashier.token)).expect(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('NO_SHOW');
  });

  it("lists tomorrow's reminder calls and records each call", async () => {
    const id = await book(await patient('Remind'), clinicDay(1), doctor.id);
    await api.get('/appointments/reminders').set(bearer(cashier.token)).expect(403);
    const list = (await api.get('/appointments/reminders').set(bearer(desk.token)).expect(200)).body;
    expect(list.day).toBe(clinicDay(1));
    expect(list.appointments.find((a: { id: string }) => a.id === id)).toMatchObject({ reminderOutcome: null, patient: { phone: '0911000111' } });
    await api.post(`/appointments/${id}/reminder`).set(bearer(desk.token)).send({ outcome: 'MAYBE' }).expect(400);
    await api.post(`/appointments/${id}/reminder`).set(bearer(desk.token)).send({ outcome: 'CONFIRMED' }).expect(201);
    const after = (await api.get('/appointments/reminders').set(bearer(desk.token)).expect(200)).body;
    expect(after.appointments.find((a: { id: string }) => a.id === id)).toMatchObject({ reminderOutcome: 'CONFIRMED', reminderBy: expect.any(String) });

    // Moved: the new day needs its own reminder.
    await api.patch(`/appointments/${id}/move`).set(bearer(desk.token)).send({ scheduledAt: at(clinicDay(-3)) }).expect(409);
    const moved = (await api.patch(`/appointments/${id}/move`).set(bearer(desk.token)).send({ scheduledAt: at(clinicDay(2), '14:30'), doctorId: null }).expect(200)).body;
    expect(moved).toMatchObject({ reminderOutcome: null, reminderSentAt: null, doctorId: null });
    expect(new Date(moved.scheduledAt).toISOString()).toBe(new Date(at(clinicDay(2), '14:30')).toISOString());
    const cancelled = await book(await patient('Gone'), clinicDay(3));
    await api.patch(`/appointments/${cancelled}`).set(bearer(desk.token)).send({ status: 'CANCELLED' }).expect(200);
    await api.patch(`/appointments/${cancelled}/move`).set(bearer(desk.token)).send({ scheduledAt: at(clinicDay(4)) }).expect(409);
    await api.post(`/appointments/${cancelled}/reminder`).set(bearer(desk.token)).send({ outcome: 'NO_ANSWER' }).expect(409);
  });

  it('counts bookings per day and doctor', async () => {
    const day = clinicDay(5);
    await book(await patient('Load1'), day, doctor.id);
    await book(await patient('Load2'), day, doctor.id);
    await book(await patient('Load3'), day);
    const load = (await api.get('/appointments/load').set(bearer(desk.token)).expect(200)).body as { day: string; doctorId: string | null; count: number }[];
    expect(load.find((l) => l.day === day && l.doctorId === doctor.id)?.count).toBe(2);
    expect(load.find((l) => l.day === day && l.doctorId === null)?.count).toBe(1);
  });

  it('lists missed appointments to trace: long-term conditions first, not those who came back or booked again', async () => {
    const chronic = await patient('Chronic');
    await api.post(`/patients/${chronic}/problems`).set(bearer(doctor.token)).send({ label: 'Essential hypertension', icd11Code: 'BA00' }).expect(201);
    const a = await pastBooking(chronic, 10);
    const plain = await patient('Plain');
    const b = await pastBooking(plain, 5);
    const back = await patient('Back');
    await pastBooking(back, 6);
    await api.post('/visits').set(bearer(desk.token)).send({ patientId: back }).expect(201); // came back since
    const rebooked = await patient('Rebooked');
    await pastBooking(rebooked, 4);
    await book(rebooked, clinicDay(7)); // booked again

    await api.get('/appointments/missed').set(bearer(cashier.token)).expect(403);
    const missed = async () => ((await api.get('/appointments/missed').set(bearer(desk.token)).expect(200)).body as { id: string; problems: string[]; tracedBy: string | null; traceOutcome: string | null }[]);
    const list = await missed();
    const ids = list.map((x) => x.id);
    expect(ids.indexOf(a)).toBe(0); // the hypertensive patient first
    expect(ids).toContain(b);
    expect(list[0].problems).toEqual(['Essential hypertension']);
    const patients = (await db.appointment.findMany({ where: { id: { in: ids } }, select: { patientId: true } })).map((x) => x.patientId);
    expect(patients).not.toContain(back);
    expect(patients).not.toContain(rebooked);

    await api.post(`/appointments/${a}/trace`).set(bearer(desk.token)).send({ outcome: 'NO_ANSWER', note: 'Phone off' }).expect(201);
    await api.post(`/appointments/${b}/trace`).set(bearer(doctor.token)).send({ outcome: 'DECLINED', note: 'Goes to another clinic now' }).expect(201);
    const after = await missed();
    expect(after.find((x) => x.id === a)).toMatchObject({ traceOutcome: 'NO_ANSWER', tracedBy: expect.any(String) });
    expect(after.some((x) => x.id === b)).toBe(false);
    const upcoming = await book(await patient('Future'), clinicDay(2));
    await api.post(`/appointments/${upcoming}/trace`).set(bearer(desk.token)).send({ outcome: 'NO_ANSWER' }).expect(409);
  });

  it('records where a patient was referred from and counts referrals in', async () => {
    const id = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: await patient('Referred'), referredFrom: 'Adama health post' }).expect(201)).body.id;
    expect((await db.visit.findUniqueOrThrow({ where: { id } })).referredFrom).toBe('Adama health post');
    const moh = (await api.get('/reports/moh-monthly').set(bearer(admin.token)).expect(200)).body;
    expect(moh.opd.referralsIn).toBeGreaterThanOrEqual(1);
  });
});
