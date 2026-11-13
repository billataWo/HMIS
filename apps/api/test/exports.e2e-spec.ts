import { randomBytes, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import bcrypt from 'bcryptjs';
import type { PlatformRole } from '@hmis/db';
import {
  base32Decode,
  currentStep,
  hotp,
  newSecret,
} from '../src/auth/totp.js';
import {
  deleteClinicData,
  exportClinicLines,
  importClinicLines,
} from '../src/exports/clinic-data.js';
import { hashToken, loadTables } from '../src/sync/engine.js';
import {
  api,
  appPrisma,
  bearer,
  db,
  login,
  makeClinic,
  makeStaff,
  makeUser,
  startApp,
  stopApp,
} from './helpers.js';

Object.assign(process.env, { HMIS_PLATFORM: '1', HMIS_SCHEDULER: '0' });
beforeAll(startApp);
afterAll(stopApp);

const DAY = 86_400_000;
const APP_URL = process.env.APP_DATABASE_URL!;

/** A clinic with a patient, a visit with a diagnosis, and its admin. */
async function clinicWithRecords(name: string) {
  const tenantId = (await makeClinic(name)).id;
  const admin = await makeUser(tenantId, 'ADMIN');
  const patient = await db.patient.create({
    data: {
      tenantId,
      mrn: `MRN-${randomUUID().slice(0, 6)}`,
      firstName: 'Almaz',
      fatherName: 'Tesfaye',
      sex: 'FEMALE',
      allergies: ['Penicillin'],
    },
  });
  const visit = await db.visit.create({
    data: {
      tenantId,
      patientId: patient.id,
      queueNumber: 1,
      chiefComplaint: 'Cough for a week',
    },
  });
  await db.diagnosis.create({
    data: {
      visitId: visit.id,
      icd11Code: 'CA40',
      label: 'Pneumonia',
      isPrimary: true,
    },
  });
  // Stock with its ledger: movements are permanent, except when a whole clinic is erased or
  // replayed into another server, which this file exercises.
  await db.drug.create({
    data: {
      tenantId,
      genericName: 'Tramadol',
      form: 'capsule',
      unit: 'capsule',
      sellPrice: '3.00',
      controlled: 'NARCOTIC',
      batches: {
        create: {
          batchNo: 'TRM-X',
          expiryDate: new Date(Date.now() + 300 * 86_400_000),
          quantity: 40,
          costPrice: '1.00',
          movements: { create: { type: 'RECEIPT', quantity: 40 } },
        },
      },
    },
  });
  return { tenantId, admin, token: await login(admin.phone), patient };
}

async function operator(role: PlatformRole) {
  const secret = newSecret();
  const op = await db.platformUser.create({
    data: {
      fullName: role,
      email: `op-${randomUUID()}@hmis.test`,
      role,
      passwordHash: await bcrypt.hash('operator-password-1', 4),
      mustChangePassword: false,
      totpSecret: secret,
      totpEnabledAt: new Date(),
    },
  });
  const first = (
    await api
      .post('/platform/auth/login')
      .send({ email: op.email, password: 'operator-password-1' })
      .expect(200)
  ).body;
  return (
    await api
      .post('/platform/auth/login/two-step')
      .send({
        challenge: first.challenge,
        code: hotp(base32Decode(secret), currentStep()),
      })
      .expect(200)
  ).body.token as string;
}

const lines = (buf: Buffer) =>
  gunzipSync(buf)
    .toString()
    .trim()
    .split('\n')
    .map(
      (l) =>
        JSON.parse(l) as {
          type: string;
          table?: string;
          row?: Record<string, unknown>;
          tenantId?: string;
          rows?: number;
          format?: string;
        },
    );

/** The two steps of downloading the whole clinic: a ticket for the password, then the file. */
async function download(token: string, password: string) {
  const step1 = await api
    .post('/exports/clinic/ticket')
    .set(bearer(token))
    .send({ password });
  if (step1.status !== 200) return step1;
  return api
    .get(`/exports/clinic?ticket=${step1.body.ticket}`)
    .set(bearer(token))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

describe("a patient's record", () => {
  it('is exported whole, for admins only, and the export is audited', async () => {
    const c = await clinicWithRecords('Export Patient Clinic');
    const record = (
      await api
        .get(`/exports/patients/${c.patient.id}`)
        .set(bearer(c.token))
        .expect(200)
    ).body;
    expect(record).toMatchObject({
      format: 'hmis-patient-record',
      clinic: { name: 'Export Patient Clinic' },
      patient: { id: c.patient.id, allergies: ['Penicillin'] },
    });
    expect(record.patient.visits[0]).toMatchObject({
      chiefComplaint: 'Cough for a week',
      diagnoses: [{ label: 'Pneumonia' }],
    });
    expect(
      await db.auditLog.count({
        where: {
          tenantId: c.tenantId,
          action: 'patient.exported',
          entityId: c.patient.id,
        },
      }),
    ).toBe(1);

    const doctor = await makeStaff(c.tenantId, 'DOCTOR');
    await api
      .get(`/exports/patients/${c.patient.id}`)
      .set(bearer(doctor.token))
      .expect(403);
    const other = await clinicWithRecords('Other Export Clinic');
    await api
      .get(`/exports/patients/${c.patient.id}`)
      .set(bearer(other.token))
      .expect(404);
  });
});

describe("the whole clinic's data", () => {
  it("is exported after the password, only that clinic, without anyone's sign-in secrets", async () => {
    const c = await clinicWithRecords('Export Whole Clinic');
    const other = await clinicWithRecords('Neighbour Clinic');
    expect((await download(c.token, 'wrong-password')).status).toBe(401);
    const res = await download(c.token, 'password123');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="hmis-export-whole-clinic-\d{4}-\d{2}-\d{2}\.ndjson\.gz"/,
    );
    const all = lines(res.body as Buffer);
    expect(all[0]).toMatchObject({
      type: 'meta',
      format: 'hmis-clinic-export',
      tenantId: c.tenantId,
    });
    const rows = all.filter((l) => l.type === 'row');
    expect(all.at(-1)).toEqual({ type: 'end', rows: rows.length });
    const ids = (table: string) =>
      rows.filter((r) => r.table === table).map((r) => r.row!.id);
    expect(ids('Patient')).toEqual([c.patient.id]);
    expect(ids('Tenant')).toEqual([c.tenantId]);
    expect(JSON.stringify(rows)).not.toContain(other.patient.id);
    const admin = rows.find((r) => r.table === 'User')!.row!;
    expect(admin).toMatchObject({
      passwordHash: '',
      totpSecret: null,
      totpRecoveryCodes: [],
      mustChangePassword: true,
    });
    expect(
      rows.some((r) => r.table === 'Diagnosis' && r.row!.label === 'Pneumonia'),
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: { tenantId: c.tenantId, action: 'clinic.exported' },
      }),
    ).toBe(1);
    // A ticket works only with the session of the admin it was given to; the export is logged once.
    const { ticket } = (await api.post('/exports/clinic/ticket').set(bearer(c.token)).send({ password: 'password123' }).expect(200)).body;
    await api.get(`/exports/clinic?ticket=${ticket}`).set(bearer(other.token)).expect(401);
    await api.get(`/exports/clinic?ticket=${ticket}`).set(bearer(c.token)).expect(200);
    await api.get(`/exports/clinic?ticket=${ticket}`).set(bearer(c.token)).expect(200);
    expect(await db.auditLog.count({ where: { tenantId: c.tenantId, action: 'clinic.exported' } })).toBe(2);
    await api.get('/exports/clinic').set(bearer(c.token)).expect(401);
  }, 20_000); // several whole-clinic exports (one query per clinic table): a few seconds each

  it('can still be exported after the clinic left (read-only)', async () => {
    const c = await clinicWithRecords('Leaving Clinic');
    const plan = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
    await db.subscription.create({
      data: {
        tenantId: c.tenantId,
        planId: plan.id,
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
    await api
      .post('/displays')
      .set(bearer(c.token))
      .send({ name: 'TV' })
      .expect(402);
    expect((await download(c.token, 'password123')).status).toBe(200);
  });

  it('can be imported into another server, the same records', async () => {
    const c = await clinicWithRecords('Moving Clinic');
    const file = (await download(c.token, 'password123')).body as Buffer;
    // "Another server": the clinic is removed here first, then imported from the file.
    await deleteClinicData(db, appPrisma().client, c.tenantId);
    await db.tenant.delete({ where: { id: c.tenantId } });
    async function* fromFile() {
      for (const l of gunzipSync(file).toString().split('\n')) yield l;
    }
    const result = await importClinicLines(db, APP_URL, fromFile());
    expect(result.tenantId).toBe(c.tenantId);
    const patient = await db.patient.findUniqueOrThrow({
      where: { id: c.patient.id },
    });
    expect(patient.allergies).toEqual(['Penicillin']);
    expect(
      await db.diagnosis.count({ where: { visit: { tenantId: c.tenantId } } }),
    ).toBe(1);
    // The stock ledger was erased with the clinic and replayed with it.
    expect(
      await db.stockMovement.findMany({
        where: { batch: { drug: { tenantId: c.tenantId } } },
        select: { type: true, quantity: true },
      }),
    ).toEqual([{ type: 'RECEIPT', quantity: 40 }]);
    // Nobody can sign in with what was in the file: passwords are reset by an admin.
    await api
      .post('/auth/login')
      .send({ phone: c.admin.phone, password: 'password123' })
      .expect(401);
    await expect(importClinicLines(db, APP_URL, fromFile())).rejects.toThrow(
      'already on this server',
    );
  });

  it('refuses to export or delete without row-level security (it would take every clinic)', async () => {
    const c = await clinicWithRecords('Safety Clinic');
    const ownerUrl = process.env.DATABASE_URL!;
    await expect(async () => {
      for await (const _ of exportClinicLines(db, ownerUrl, c.tenantId)) void _;
    }).rejects.toThrow('row-level security');
    await expect(deleteClinicData(db, db, c.tenantId)).rejects.toThrow(
      'row-level security',
    );
    expect(await db.patient.count({ where: { tenantId: c.tenantId } })).toBe(1);
  });

  it('stops if a clinic table has no row-level security (a new table someone forgot)', async () => {
    const fake = { $queryRawUnsafe: async () => [{ name: 'Patient', rls: true, columns: ['id'], pk: ['id'], deps: [] }, { name: 'Forgotten', rls: false, columns: ['id', 'tenantId'], pk: ['id'], deps: [] }] };
    await expect(loadTables(fake as never)).rejects.toThrow('Forgotten');
    // The real database: every clinic table has it.
    await expect(loadTables(db)).resolves.toBeInstanceOf(Map);
  });
});

describe('deleting a clinic that left', () => {
  it('waits for the export time, needs the owner and the name, and deletes only that clinic', async () => {
    const c = await clinicWithRecords('Closing Clinic');
    const neighbour = await clinicWithRecords('Staying Clinic');
    const plan = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
    const sub = await db.subscription.create({
      data: {
        tenantId: c.tenantId,
        planId: plan.id,
        status: 'ACTIVE',
        paidUntil: new Date(),
      },
    });
    await db.platformInvoice.create({
      data: {
        number: `TEST-${randomUUID().slice(0, 8)}`,
        tenantId: c.tenantId,
        subscriptionId: sub.id,
        planName: 'Basic',
        cycle: 'MONTHLY',
        periodStart: new Date(),
        periodEnd: new Date(),
        subtotal: '1',
        vat: '0',
        total: '1',
        dueDate: new Date(),
      },
    });
    await db.syncClient.create({
      data: {
        tenantId: c.tenantId,
        name: 'Old clinic server',
        tokenHash: hashToken(randomBytes(32).toString('base64url')),
      },
    });
    const owner = await operator('OWNER');
    const support = await operator('SUPPORT');
    const del = (token: string, confirmName = 'Closing Clinic') =>
      api
        .post(`/platform/clinics/${c.tenantId}/delete-data`)
        .set(bearer(token))
        .send({ confirmName });

    expect((await del(owner).expect(409)).body.message).toContain(
      'Cancel the subscription first',
    );
    await api
      .post(`/platform/clinics/${c.tenantId}/cancel`)
      .set(bearer(owner))
      .send({ reason: 'Clinic closed' })
      .expect(200);
    expect((await del(owner).expect(409)).body.message).toContain(
      'to export its records',
    );
    const detail = (
      await api
        .get(`/platform/clinics/${c.tenantId}`)
        .set(bearer(owner))
        .expect(200)
    ).body;
    expect(new Date(detail.deletableFrom).getTime()).toBeGreaterThan(
      Date.now() + 59 * DAY,
    );

    await db.subscription.update({
      where: { id: sub.id },
      data: { cancelledAt: new Date(Date.now() - 61 * DAY) },
    });
    await del(support).expect(403);
    expect((await del(owner, 'Closing').expect(409)).body.message).toContain(
      'name',
    );
    const done = (await del(owner, 'closing clinic').expect(200)).body;
    expect(done.rows).toBeGreaterThan(3);

    expect(await db.patient.count({ where: { tenantId: c.tenantId } })).toBe(0);
    expect(await db.user.count({ where: { tenantId: c.tenantId } })).toBe(0);
    expect(await db.visit.count({ where: { tenantId: c.tenantId } })).toBe(0);
    expect(
      await db.patient.count({ where: { tenantId: neighbour.tenantId } }),
    ).toBe(1);
    expect(
      await db.diagnosis.count({
        where: { visit: { tenantId: neighbour.tenantId } },
      }),
    ).toBe(1);
    // Kept: the clinic row, its subscription and HMIS's invoices. Its clinic server is cut off.
    expect(
      await db.tenant.findUnique({ where: { id: c.tenantId } }),
    ).not.toBeNull();
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
        .dataDeletedAt,
    ).not.toBeNull();
    expect(
      await db.platformInvoice.count({ where: { tenantId: c.tenantId } }),
    ).toBe(1);
    expect(
      await db.syncClient.count({
        where: { tenantId: c.tenantId, revokedAt: null },
      }),
    ).toBe(0);
    const history = await db.platformAuditLog.findFirstOrThrow({
      where: { tenantId: c.tenantId, action: 'clinic.data_deleted' },
    });
    expect(history.data).toMatchObject({
      clinic: 'Closing Clinic',
      clinicServersDisconnected: 1,
    });

    await api
      .post('/auth/login')
      .send({ phone: c.admin.phone, password: 'password123' })
      .expect(401);
    await del(owner, 'Closing Clinic').expect(409);
  }, 20_000); // a whole-clinic export and deletion (one query per clinic table): several seconds
});
