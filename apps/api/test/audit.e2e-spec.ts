import { api, bearer, db, login, makeClinic, makeStaff, makeUser, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
type Entry = { id: string; action: string; category: string; sensitive: boolean; target: { label: string; href?: string } | null; user: { fullName: string } | null; seal: string | null };

describe('audit log', () => {
  let tenantId: string;
  let admin: Staff, doctor: Staff, cashier: Staff;
  let deskPhone: string;
  let patientId: string;
  let mrn: string;

  beforeAll(async () => {
    tenantId = (await makeClinic('Audit Clinic')).id;
    [admin, doctor, cashier] = await Promise.all((['ADMIN', 'DOCTOR', 'CASHIER'] as const).map((r) => makeStaff(tenantId, r)));
    const desk = await makeUser(tenantId, 'RECEPTIONIST');
    deskPhone = desk.phone;
    const deskToken = await login(desk.phone);
    const p = (
      await api
        .post('/patients')
        .set({ ...bearer(deskToken), 'User-Agent': 'AuditTest/1.0 (Windows NT 10.0) Chrome/130.0', 'X-Forwarded-For': '192.168.1.20' })
        .send({ firstName: 'Audit', fatherName: 'Subject', sex: 'FEMALE', ageYears: 30, confirmDuplicate: true })
        .expect(201)
    ).body;
    patientId = p.id;
    mrn = p.mrn;
    // A wrong password: a security event.
    await api.post('/auth/login').send({ phone: deskPhone, password: 'wrong-password' }).expect(401);
  });

  it('seals every entry onto the one before it', async () => {
    const rows = await db.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash ?? ''))).toBe(true);
    const hashes = new Set(rows.map((r) => r.hash));
    expect(rows.filter((r) => r.prevHash).every((r) => hashes.has(r.prevHash))).toBe(true);
    expect(rows.filter((r) => !r.prevHash)).toHaveLength(1); // one chain, one start
  });

  it('records where an action came from', async () => {
    const created = await db.auditLog.findFirstOrThrow({ where: { tenantId, action: 'patient.create' } });
    expect(created.userAgent).toContain('AuditTest/1.0');
    expect(created.ip).toBe('192.168.1.20'); // as the web app passes it on
  });

  it('refuses to change or delete an entry', async () => {
    const entry = await db.auditLog.findFirstOrThrow({ where: { tenantId } });
    await expect(db.auditLog.update({ where: { id: entry.id }, data: { action: 'nothing.happened' } })).rejects.toThrow(/permanent record/);
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/permanent record/);
  });

  it('records a patient record being opened, once per half hour per person', async () => {
    await api.get(`/patients/${patientId}`).set(bearer(doctor.token)).expect(200);
    await api.get(`/patients/${patientId}`).set(bearer(doctor.token)).expect(200);
    expect(await db.auditLog.count({ where: { tenantId, action: 'patient.viewed', entityId: patientId, userId: doctor.id } })).toBe(1);
  });

  it('records a copy for offline work as such, not as the record being opened', async () => {
    const visit = await db.visit.create({ data: { tenantId, patientId, queueNumber: 1, status: 'WAITING' } });
    for (let i = 0; i < 2; i++) await api.get(`/visits/${visit.id}`).set({ ...bearer(doctor.token), 'X-HMIS-Purpose': 'offline-copy' }).expect(200);
    expect(await db.auditLog.count({ where: { tenantId, entityId: visit.id, action: 'visit.copied_offline' } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantId, entityId: visit.id, action: 'visit.viewed' } })).toBe(0);
    // Opening it for real is recorded as opening it.
    await api.get(`/visits/${visit.id}`).set(bearer(doctor.token)).expect(200);
    expect(await db.auditLog.count({ where: { tenantId, entityId: visit.id, action: 'visit.viewed' } })).toBe(1);
    // The patient list copied to a PC.
    await api.get('/offline/patients').set(bearer(admin.token)).expect(200);
    const copied = await db.auditLog.findFirstOrThrow({ where: { tenantId, action: 'offline.patients_copied' } });
    expect(copied.data).toEqual({ patients: 1 });
  });

  it("shows a patient's history, in words, with links", async () => {
    const res = (await api.get('/audit').query({ patientId }).set(bearer(admin.token)).expect(200)).body;
    expect(res.patient).toEqual({ id: patientId, name: 'Audit Subject', mrn });
    const actions = res.entries.map((e: Entry) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['patient.create', 'patient.viewed']));
    const viewed = res.entries.find((e: Entry) => e.action === 'patient.viewed');
    expect(viewed).toEqual(expect.objectContaining({ category: 'access', target: { label: `Audit Subject (${mrn})`, href: `/patients/${patientId}` }, seal: expect.stringMatching(/^[0-9a-f]{12}$/) }));
    // Searching the MRN finds the same patient.
    const byMrn = (await api.get('/audit').query({ q: mrn }).set(bearer(admin.token)).expect(200)).body;
    expect(byMrn.patient?.id).toBe(patientId);
  });

  it('filters by group and by sensitive actions, and sums up the period', async () => {
    const access = (await api.get('/audit').query({ category: 'access' }).set(bearer(admin.token)).expect(200)).body.entries;
    expect(access.length).toBeGreaterThan(0);
    expect(access.every((e: Entry) => e.category === 'access')).toBe(true);
    const sensitive = (await api.get('/audit').query({ sensitive: '1' }).set(bearer(admin.token)).expect(200)).body;
    expect(sensitive.entries.map((e: Entry) => e.action)).toContain('auth.login_failed');
    expect(sensitive.entries.every((e: Entry) => e.sensitive)).toBe(true);
    expect(sensitive.summary).toEqual(expect.objectContaining({ failedSignIns: 1, recordViews: 2 })); // the record, and the visit opened
    expect(sensitive.summary.byCategory.security).toBeGreaterThan(0);
    // Words in the details.
    const words = (await api.get('/audit').query({ q: 'wrong' }).set(bearer(admin.token)).expect(200)).body.entries;
    expect(Array.isArray(words)).toBe(true);
  });

  it('exports the log, and records that it was exported', async () => {
    const out = (await api.get('/audit/export').set(bearer(admin.token)).expect(200)).body;
    expect(out.entries.length).toBeGreaterThan(3);
    expect(await db.auditLog.count({ where: { tenantId, action: 'audit.exported', userId: admin.id } })).toBe(1);
  });

  it('checks the seal, and finds an entry changed or removed behind its back', async () => {
    const ok = (await api.get('/audit/integrity').set(bearer(admin.token)).expect(200)).body;
    expect(ok).toEqual(expect.objectContaining({ intact: true, altered: 0, missing: 0 }));
    expect(ok.sealed).toBeGreaterThan(3);

    // Someone with database access edits one entry and removes another (the guard switched off).
    const [first, second] = await db.auditLog.findMany({ where: { tenantId, action: { not: 'audit.exported' } }, orderBy: { createdAt: 'asc' }, take: 2 });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.replaying', 'on', true)`;
      await tx.$executeRaw`UPDATE "AuditLog" SET "entity" = 'Nothing' WHERE "id" = ${second.id}`;
      await tx.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${first.id}`;
    });
    const bad = (await api.get('/audit/integrity').set(bearer(admin.token)).expect(200)).body;
    expect(bad).toEqual(expect.objectContaining({ intact: false, altered: 1, missing: 1 }));
    expect(bad.alteredEntries[0].id).toBe(second.id);
  });

  it('is for admins only', async () => {
    for (const path of ['/audit', '/audit/export', '/audit/integrity']) await api.get(path).set(bearer(cashier.token)).expect(403);
  });
});
