import { clinicDay, dayRange } from '../src/common/clinic-day.js';
import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp, recordDiagnosis } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

describe('clinic day', () => {
  it('rolls over at midnight Addis Ababa time, not UTC', () => {
    expect(clinicDay(new Date('2026-11-05T20:59:00Z'))).toBe('2026-11-05'); // 23:59 local
    expect(clinicDay(new Date('2026-11-05T21:00:00Z'))).toBe('2026-11-06'); // 00:00 local
    expect(dayRange('2026-11-06').start.toISOString()).toBe('2026-11-05T21:00:00.000Z');
  });
});

describe('queue and appointments', () => {
  let tenantId: string;
  let reception: { id: string; token: string };
  let doctor: { id: string; token: string };
  let cashier: { id: string; token: string };
  let consultationId: string;

  const newPatient = async (firstName: string) =>
    (await api.post('/patients').set(bearer(reception.token)).send({ confirmDuplicate: true, firstName, fatherName: 'Test', sex: 'MALE' }).expect(201)).body;

  const checkIn = (body: object, token = reception.token) => api.post('/visits').set(bearer(token)).send(body);
  const move = (visitId: string, status: string, token: string) =>
    api.patch(`/visits/${visitId}/status`).set(bearer(token)).send({ status });

  beforeAll(async () => {
    const clinic = await makeClinic('Queue Clinic');
    tenantId = clinic.id;
    reception = await makeStaff(tenantId, 'RECEPTIONIST');
    doctor = await makeStaff(tenantId, 'DOCTOR');
    cashier = await makeStaff(tenantId, 'CASHIER');
    consultationId = (
      await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'General consultation', price: '150.00' } })
    ).id;
  });

  it('hands out queue numbers in order and charges the consultation fee', async () => {
    const a = await newPatient('Abel');
    const b = await newPatient('Bethel');
    const v1 = await checkIn({ patientId: a.id, serviceId: consultationId }).expect(201);
    const v2 = await checkIn({ patientId: b.id }).expect(201);
    expect(v1.body.queueNumber).toBe(1);
    expect(v2.body.queueNumber).toBe(2);
    expect(v1.body.charges).toHaveLength(1);
    expect(v1.body.charges[0].unitPrice).toBe('150');
    expect(v2.body.charges).toHaveLength(0);
  });

  it('never gives two concurrent check-ins the same number', async () => {
    const patients = await Promise.all(Array.from({ length: 8 }, (_, i) => newPatient(`C${i}`)));
    const results = await Promise.all(patients.map((p) => checkIn({ patientId: p.id })));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(results.map((r) => r.body.queueNumber)).size).toBe(8);
  });

  it('refuses to queue the same patient twice', async () => {
    const p = await newPatient('Twice');
    await checkIn({ patientId: p.id }).expect(201);
    const res = await checkIn({ patientId: p.id }).expect(409);
    expect(res.body.message).toMatch(/already in today's queue/);
  });

  it('lists the day in queue order with patient and doctor', async () => {
    const res = await api.get('/queue').set(bearer(cashier.token)).expect(200);
    expect(res.body.day).toBe(clinicDay());
    const numbers = res.body.visits.map((v: { queueNumber: number }) => v.queueNumber);
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
    expect(res.body.visits[0].patient.firstName).toBe('Abel');
  });

  it('lets doctors call, and complete, a patient; front desk can only cancel', async () => {
    const p = await newPatient('Called');
    const v = (await checkIn({ patientId: p.id }).expect(201)).body;

    await move(v.id, 'IN_CONSULTATION', reception.token).expect(403);
    await move(v.id, 'IN_CONSULTATION', cashier.token).expect(403);
    await move(v.id, 'COMPLETED', doctor.token).expect(409); // must be called first

    const called = (await move(v.id, 'IN_CONSULTATION', doctor.token).expect(200)).body;
    expect(called.doctor.id).toBe(doctor.id);
    expect(called.calledAt).toBeTruthy();

    await move(v.id, 'COMPLETED', doctor.token).expect(409); // no diagnosis yet
    await recordDiagnosis(v.id);
    const done = (await move(v.id, 'COMPLETED', doctor.token).expect(200)).body;
    expect(done.completedAt).toBeTruthy();
    await move(v.id, 'WAITING', doctor.token).expect(409);

    // A completed visit no longer blocks a new check-in the same day.
    await checkIn({ patientId: p.id }).expect(201);
  });

  it('drops uninvoiced charges when a visit is cancelled', async () => {
    const p = await newPatient('Cancelled');
    const v = (await checkIn({ patientId: p.id, serviceId: consultationId }).expect(201)).body;
    await move(v.id, 'CANCELLED', reception.token).expect(200);
    expect(await db.charge.count({ where: { visitId: v.id } })).toBe(0);
    await checkIn({ patientId: p.id }).expect(201);
  });

  it('books an appointment and checks it in, carrying over the doctor', async () => {
    const p = await newPatient('Booked');
    const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const appt = (
      await api.post('/appointments').set(bearer(reception.token)).send({ patientId: p.id, scheduledAt: at, doctorId: doctor.id, reason: 'Follow-up' }).expect(201)
    ).body;
    expect(appt.status).toBe('BOOKED');

    const upcoming = await api.get('/appointments').query({ patientId: p.id }).set(bearer(reception.token)).expect(200);
    expect(upcoming.body.map((a: { id: string }) => a.id)).toEqual([appt.id]);

    const visit = (await checkIn({ patientId: p.id, appointmentId: appt.id }).expect(201)).body;
    expect(visit.doctor.id).toBe(doctor.id);
    expect((await db.appointment.findUnique({ where: { id: appt.id } }))?.status).toBe('ARRIVED');

    // Cancelling the visit frees the appointment so it can be checked in again.
    await move(visit.id, 'CANCELLED', reception.token).expect(200);
    expect((await db.appointment.findUnique({ where: { id: appt.id } }))?.status).toBe('BOOKED');
    await checkIn({ patientId: p.id, appointmentId: appt.id }).expect(201);
    await checkIn({ patientId: p.id, appointmentId: appt.id }).expect(409);
  });

  it('rejects appointments in the past and cancels booked ones', async () => {
    const p = await newPatient('Past');
    await api
      .post('/appointments')
      .set(bearer(reception.token))
      .send({ patientId: p.id, scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
      .expect(409);

    const appt = (
      await api.post('/appointments').set(bearer(reception.token)).send({ patientId: p.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)
    ).body;
    await api.patch(`/appointments/${appt.id}`).set(bearer(reception.token)).send({ status: 'CANCELLED' }).expect(200);
    await api.patch(`/appointments/${appt.id}`).set(bearer(reception.token)).send({ status: 'NO_SHOW' }).expect(409);
    await checkIn({ patientId: p.id, appointmentId: appt.id }).expect(409);
  });

  it("keeps each clinic's queue private", async () => {
    const other = await makeClinic('Other Queue Clinic');
    const otherDesk = await makeStaff(other.id, 'RECEPTIONIST');
    const mine = await newPatient('Mine');

    await checkIn({ patientId: mine.id }, otherDesk.token).expect(404);
    await checkIn({ patientId: mine.id, doctorId: doctor.id }, otherDesk.token).expect(404);
    expect((await api.get('/queue').set(bearer(otherDesk.token)).expect(200)).body.visits).toEqual([]);

    const v = (await checkIn({ patientId: mine.id }).expect(201)).body;
    await move(v.id, 'CANCELLED', otherDesk.token).expect(404);

    const theirs = (await api.post('/patients').set(bearer(otherDesk.token)).send({ confirmDuplicate: true, firstName: 'T', fatherName: 'O', sex: 'MALE' })).body;
    expect((await checkIn({ patientId: theirs.id }, otherDesk.token).expect(201)).body.queueNumber).toBe(1);
  });

  it('lists doctors and services for dropdowns', async () => {
    const doctors = (await api.get('/lookups/doctors').set(bearer(cashier.token)).expect(200)).body;
    expect(doctors).toEqual([{ id: doctor.id, fullName: 'DOCTOR user', room: null }]);
    const services = (await api.get('/lookups/services').set(bearer(cashier.token)).expect(200)).body;
    expect(services.map((s: { code: string }) => s.code)).toEqual(['CONS']);
  });
});
