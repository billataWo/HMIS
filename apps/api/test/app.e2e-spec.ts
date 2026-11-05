import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createPrismaClient, type Role } from '@hmis/db';
import { AppModule } from './../src/app.module.js';

const db = createPrismaClient();
let app: INestApplication<App>;
const api = {
  get: (url: string) => request(app.getHttpServer()).get(url),
  post: (url: string) => request(app.getHttpServer()).post(url),
  patch: (url: string) => request(app.getHttpServer()).patch(url),
};

/** A random 09XXXXXXXX number; phones must be unique across runs because login searches all clinics. */
function phone() {
  return '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
}

async function makeClinic(name: string) {
  return db.tenant.create({ data: { name } });
}

async function makeUser(tenantId: string, role: Role, password = 'password123') {
  const p = phone();
  await db.user.create({
    data: { tenantId, phone: p, role, fullName: `${role} user`, passwordHash: await bcrypt.hash(password, 4) },
  });
  return p;
}

async function login(phoneNumber: string, password = 'password123') {
  const res = await api.post('/auth/login').send({ phone: phoneNumber, password }).expect(200);
  return res.body.token as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('health', () => {
  it('reports the database as up without logging in', () =>
    api.get('/health').expect(200).expect({ status: 'ok', database: 'up' }));
});

describe('auth', () => {
  let rec: string;
  beforeAll(async () => {
    const clinic = await makeClinic('Auth Clinic');
    rec = await makeUser(clinic.id, 'RECEPTIONIST');
  });

  it('logs in with any common phone format', async () => {
    const local = rec.slice(1); // 9XXXXXXXX
    const spaced = `${rec.slice(0, 4)} ${rec.slice(4, 6)} ${rec.slice(6, 8)} ${rec.slice(8)}`;
    for (const p of [rec, `+251${local}`, local, spaced]) {
      await api.post('/auth/login').send({ phone: p, password: 'password123' }).expect(200);
    }
  });

  it('rejects a wrong password and an unknown phone the same way', async () => {
    const a = await api.post('/auth/login').send({ phone: rec, password: 'nope' }).expect(401);
    const b = await api.post('/auth/login').send({ phone: phone(), password: 'nope' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('rejects requests without a valid token', async () => {
    await api.get('/patients').expect(401);
    await api.get('/patients').set(bearer('garbage')).expect(401);
  });

  it('returns the current user', async () => {
    const token = await login(rec);
    const res = await api.get('/auth/me').set(bearer(token)).expect(200);
    expect(res.body.role).toBe('RECEPTIONIST');
    expect(res.body.tenant.name).toBe('Auth Clinic');
  });
});

describe('patients', () => {
  let reception: string;
  let cashier: string;

  beforeAll(async () => {
    const clinic = await makeClinic('Patient Clinic');
    reception = await login(await makeUser(clinic.id, 'RECEPTIONIST'));
    cashier = await login(await makeUser(clinic.id, 'CASHIER'));
  });

  const register = (token: string, body: object) => api.post('/patients').set(bearer(token)).send(body);

  it('assigns sequential MRNs and normalizes phone numbers', async () => {
    const a = await register(reception, { firstName: 'Abebe', fatherName: 'Kebede', sex: 'MALE', phone: '+251911000001' }).expect(201);
    const b = await register(reception, { firstName: 'Almaz', fatherName: 'Tesfaye', sex: 'FEMALE', ageYears: 30 }).expect(201);
    expect(a.body.mrn).toBe('MRN-000001');
    expect(b.body.mrn).toBe('MRN-000002');
    expect(a.body.phone).toBe('0911000001');
    expect(new Date(b.body.dateOfBirth).getUTCFullYear()).toBe(new Date().getUTCFullYear() - 30);
  });

  it('never hands out the same MRN to concurrent registrations', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => register(reception, { firstName: `P${i}`, fatherName: 'X', sex: 'MALE' })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(new Set(results.map((r) => r.body.mrn)).size).toBe(10);
  });

  it('validates input', async () => {
    const res = await register(reception, { firstName: '', sex: 'OTHER' }).expect(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['firstName', 'fatherName', 'sex']),
    );
  });

  it('only lets clinical and front-desk roles register patients', async () => {
    await register(cashier, { firstName: 'No', fatherName: 'Access', sex: 'MALE' }).expect(403);
  });

  it('searches by name words, MRN and phone', async () => {
    const find = async (q: string) =>
      (await api.get('/patients').query({ q }).set(bearer(cashier)).expect(200)).body.map(
        (p: { firstName: string }) => p.firstName,
      );
    expect(await find('abebe keb')).toEqual(['Abebe']);
    expect(await find('MRN-000002')).toEqual(['Almaz']);
    expect(await find('+251911000001')).toEqual(['Abebe']);
    expect(await find('abebe tesfaye')).toEqual([]);
  });

  it('links family members into one group', async () => {
    const mother = await register(reception, { firstName: 'Tigist', fatherName: 'Alemu', sex: 'FEMALE' }).expect(201);
    const child1 = await register(reception, { firstName: 'Kidus', fatherName: 'Dawit', sex: 'MALE', relativeId: mother.body.id }).expect(201);
    const child2 = await register(reception, { firstName: 'Hana', fatherName: 'Dawit', sex: 'FEMALE', relativeId: child1.body.id }).expect(201);
    expect(child1.body.familyId).toBe(mother.body.id);
    expect(child2.body.familyId).toBe(mother.body.id);

    const res = await api.get(`/patients/${mother.body.id}`).set(bearer(reception)).expect(200);
    expect(res.body.family.map((p: { firstName: string }) => p.firstName).sort()).toEqual(['Hana', 'Kidus']);
  });

  it("never shows one clinic's patients to another clinic", async () => {
    const other = await makeClinic('Other Clinic');
    const otherToken = await login(await makeUser(other.id, 'ADMIN'));

    const mine = await register(reception, { firstName: 'Private', fatherName: 'Patient', sex: 'MALE' }).expect(201);
    const list = await api.get('/patients').set(bearer(otherToken)).expect(200);
    expect(list.body).toEqual([]);
    await api.get(`/patients/${mine.body.id}`).set(bearer(otherToken)).expect(404);
    await register(otherToken, { firstName: 'A', fatherName: 'B', sex: 'MALE', relativeId: mine.body.id }).expect(404);

    const first = await register(otherToken, { firstName: 'First', fatherName: 'There', sex: 'MALE' }).expect(201);
    expect(first.body.mrn).toBe('MRN-000001');
  });

  it('records registrations in the audit log', async () => {
    const res = await register(reception, { firstName: 'Audited', fatherName: 'One', sex: 'MALE' }).expect(201);
    const entry = await db.auditLog.findFirst({ where: { entityId: res.body.id } });
    expect(entry?.action).toBe('patient.create');
  });
});

describe('users', () => {
  let admin: string;
  let doctor: string;
  const nursePhone = phone();

  beforeAll(async () => {
    const clinic = await makeClinic('Users Clinic');
    admin = await login(await makeUser(clinic.id, 'ADMIN'));
    doctor = await login(await makeUser(clinic.id, 'DOCTOR'));
  });

  it('lets only admins manage staff', async () => {
    await api.get('/users').set(bearer(doctor)).expect(403);
    const res = await api
      .post('/users')
      .set(bearer(admin))
      .send({ fullName: 'New Nurse', phone: `+251${nursePhone.slice(1)}`, role: 'NURSE', password: 'nursepass1' })
      .expect(201);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.phone).toBe(nursePhone);
    await login(nursePhone, 'nursepass1');
  });

  it('blocks deactivated staff from logging in', async () => {
    const list = await api.get('/users').set(bearer(admin)).expect(200);
    const nurse = list.body.find((u: { phone: string }) => u.phone === nursePhone);
    await api.patch(`/users/${nurse.id}`).set(bearer(admin)).send({ active: false }).expect(200);
    await api.post('/auth/login').send({ phone: nursePhone, password: 'nursepass1' }).expect(401);
  });
});
