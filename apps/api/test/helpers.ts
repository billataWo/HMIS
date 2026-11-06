import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createPrismaClient, type Role } from '@hmis/db';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// A failed `.expect(status)` reports only the two status codes; add the API's reply so an
// unexpected 409 or 500 says why (this is how intermittent failures get diagnosed).
type StatusCheck = { _assertStatus(status: number, res: request.Response): Error | undefined };
const proto = (request as unknown as { Test: { prototype: StatusCheck } }).Test.prototype;
const assertStatus = proto._assertStatus;
proto._assertStatus = function (status, res) {
  const error = assertStatus.call(this, status, res);
  const req = (res as unknown as { req?: { method?: string; path?: string } }).req;
  if (error) error.message += ` | ${req?.method ?? ''} ${req?.path ?? ''} replied: ${JSON.stringify(res.body).slice(0, 600)}`;
  return error;
};

export const db = createPrismaClient();
let app: INestApplication<App>;

export const api = {
  get: (url: string) => request(app.getHttpServer()).get(url),
  post: (url: string) => request(app.getHttpServer()).post(url),
  patch: (url: string) => request(app.getHttpServer()).patch(url),
  delete: (url: string) => request(app.getHttpServer()).delete(url),
};

export async function startApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}

/** The running app's database service (restricted `client` and owner `system`). */
export function appPrisma() {
  return app.get(PrismaService);
}

export async function stopApp() {
  await app.close();
  await db.$disconnect();
}

/** A random 09XXXXXXXX number; phones must be unique across runs because login searches all clinics. */
export function phone() {
  return '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
}

/** Test clinics bill at the end unless a test opts into pay-first. */
export function makeClinic(name: string, opts: { requirePrepayment?: boolean } = {}) {
  return db.tenant.create({ data: { name, requirePrepayment: opts.requirePrepayment ?? false } });
}

export async function makeUser(tenantId: string, role: Role, password = 'password123') {
  const p = phone();
  const user = await db.user.create({
    data: { tenantId, phone: p, role, fullName: `${role} user`, passwordHash: await bcrypt.hash(password, 4) },
  });
  return { ...user, phone: p };
}

export async function login(phoneNumber: string, password = 'password123') {
  const res = await api.post('/auth/login').send({ phone: phoneNumber, password }).expect(200);
  return res.body.token as string;
}

export async function makeStaff(tenantId: string, role: Role) {
  const user = await makeUser(tenantId, role);
  return { id: user.id, token: await login(user.phone) };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Records a diagnosis directly, for tests about other steps (completing a visit requires one). */
export function recordDiagnosis(visitId: string) {
  return db.diagnosis.create({ data: { visitId, icd11Code: 'CA40', label: 'Pneumonia', isPrimary: true } });
}
