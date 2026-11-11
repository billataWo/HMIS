import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

/** Waiting-room screens hold a display-only key: the queue board, nothing else. */
describe('waiting-room screens', () => {
  let tenantId: string;
  let admin: { id: string; token: string }, desk: { id: string; token: string }, doctor: { id: string; token: string };

  const pair = (code: string, from = '198.51.100.60') => api.post('/display/pair').set('X-Forwarded-For', from).send({ code });
  const board = (token: string) => api.get('/display/queue').set(bearer(token));

  beforeAll(async () => {
    tenantId = (await makeClinic('Screen Clinic')).id;
    [admin, desk, doctor] = await Promise.all([makeStaff(tenantId, 'ADMIN'), makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR')]);
  });

  it('pairs a screen with a one-time code, and shows only numbers and doctors', async () => {
    const created = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Waiting room TV' }).expect(201)).body;
    expect(created.code).toMatch(/^\d{6}$/);
    await api.post('/displays').set(bearer(desk.token)).send({ name: 'Not allowed' }).expect(403);

    const { token } = (await pair(created.code).expect(200)).body;
    expect(token.length).toBeGreaterThan(40);
    await pair(created.code).expect(401); // used up

    // Today's queue: one patient waiting, one with the doctor.
    const p1 = (await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Secretname', fatherName: 'Hidden', sex: 'FEMALE', confirmDuplicate: true }).expect(201)).body;
    const p2 = (await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Private', fatherName: 'Person', sex: 'MALE', confirmDuplicate: true }).expect(201)).body;
    const v1 = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p1.id, doctorId: doctor.id }).expect(201)).body;
    const v2 = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p2.id }).expect(201)).body;
    await api.patch(`/visits/${v1.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);

    const shown = await board(token).expect(200);
    expect(shown.body.clinic.name).toBe('Screen Clinic');
    expect(shown.body.serving).toEqual([{ id: v1.id, queueNumber: v1.queueNumber, doctor: 'DOCTOR user', room: null }]);
    expect(shown.body.next).toEqual([{ id: v2.id, queueNumber: v2.queueNumber, doctor: null, room: null }]);
    // Nothing that identifies a patient travels to the screen.
    expect(JSON.stringify(shown.body)).not.toMatch(/Secretname|Hidden|Private|Person|MRN|phone/i);
  });

  it("tells the waiting room where each called patient goes: the doctor's room", async () => {
    // An admin sets where the doctor sees patients; others cannot.
    await api.patch(`/users/${doctor.id}`).set(bearer(desk.token)).send({ room: 'Room 9' }).expect(403);
    const updated = (await api.patch(`/users/${doctor.id}`).set(bearer(admin.token)).send({ room: '  Room 2  ' }).expect(200)).body;
    expect(updated.room).toBe('Room 2');
    expect((await api.get('/lookups/doctors').set(bearer(desk.token)).expect(200)).body).toContainEqual({ id: doctor.id, fullName: 'DOCTOR user', room: 'Room 2' });

    const created = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Room board' }).expect(201)).body;
    const { token } = (await pair(created.code, '198.51.100.61').expect(200)).body;
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Roomcase', fatherName: 'Patient', sex: 'FEMALE', confirmDuplicate: true }).expect(201)).body;
    const waiting = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, doctorId: doctor.id }).expect(201)).body;
    expect((await board(token).expect(200)).body.next).toContainEqual({ id: waiting.id, queueNumber: waiting.queueNumber, doctor: 'DOCTOR user', room: 'Room 2' });
    await api.patch(`/visits/${waiting.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    expect((await board(token).expect(200)).body.serving).toContainEqual({ id: waiting.id, queueNumber: waiting.queueNumber, doctor: 'DOCTOR user', room: 'Room 2' });
    // The queue shows it to staff too; an empty room clears it.
    const queue = (await api.get('/queue').set(bearer(desk.token)).expect(200)).body;
    expect(queue.visits.find((v: { id: string }) => v.id === waiting.id).doctor.room).toBe('Room 2');
    expect((await api.patch(`/users/${doctor.id}`).set(bearer(admin.token)).send({ room: '' }).expect(200)).body.room).toBeNull();
  });

  it('gives the screen nothing else: its key is not a staff sign-in', async () => {
    const created = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Lobby' }).expect(201)).body;
    const { token } = (await pair(created.code).expect(200)).body;
    await api.get('/auth/me').set(bearer(token)).expect(401);
    await api.get('/queue').set(bearer(token)).expect(401);
    await api.get('/patients').set(bearer(token)).expect(401);
  });

  it('stops a removed or re-paired screen at once', async () => {
    const created = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Old TV' }).expect(201)).body;
    const { token: first } = (await pair(created.code).expect(200)).body;
    const again = (await api.post(`/displays/${created.id}/pairing-code`).set(bearer(admin.token)).expect(200)).body;
    await board(first).expect(401); // the old TV's key no longer works
    const { token: second } = (await pair(again.code).expect(200)).body;
    await board(second).expect(200);

    await api.post(`/displays/${created.id}/revoke`).set(bearer(admin.token)).expect(200);
    expect((await board(second).expect(401)).body.code).toBe('DISPLAY_REVOKED');
    const list = (await api.get('/displays').set(bearer(admin.token)).expect(200)).body;
    expect(list.find((s: { id: string }) => s.id === created.id)).toMatchObject({ paired: false, revokedAt: expect.any(String) });
  });

  it('refuses an expired code, and limits guessing', async () => {
    const created = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Late TV' }).expect(201)).body;
    await db.displayScreen.update({ where: { id: created.id }, data: { pairingExpiresAt: new Date(Date.now() - 1000) } });
    await pair(created.code, '198.51.100.61').expect(401);

    const fresh = (await api.post(`/displays/${created.id}/pairing-code`).set(bearer(admin.token)).expect(200)).body;
    const wrong = fresh.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 10; i++) await pair(wrong, '198.51.100.62').expect(401);
    await pair(fresh.code, '198.51.100.62').expect(429); // even the right code, from that address, for a while
    await pair(fresh.code, '198.51.100.63').expect(200);
  });

  it("keeps each clinic's screens to itself", async () => {
    const created = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Private TV' }).expect(201)).body;
    const otherAdmin = await makeStaff((await makeClinic('Other Screen Clinic')).id, 'ADMIN');
    expect((await api.get('/displays').set(bearer(otherAdmin.token)).expect(200)).body).toEqual([]);
    await api.post(`/displays/${created.id}/revoke`).set(bearer(otherAdmin.token)).expect(404);
  });
});
