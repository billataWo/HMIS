import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
const key = () => `offline-${crypto.randomUUID()}`;

/** What the browser's offline mode relies on: replays applied once, and its reference lists. */
describe('offline replay support', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, cashier: Staff;
  let drugId: string;

  beforeAll(async () => {
    tenantId = (await makeClinic('Offline Clinic')).id;
    [desk, doctor, cashier] = await Promise.all((['RECEPTIONIST', 'DOCTOR', 'CASHIER'] as const).map((r) => makeStaff(tenantId, r)));
    drugId = (await db.drug.create({ data: { tenantId, genericName: 'Amoxicillin', form: 'capsule', unit: 'capsule', sellPrice: '2.00' } })).id;
    await db.stockBatch.create({ data: { drugId, batchNo: 'A1', expiryDate: new Date(Date.now() + 90 * 86_400_000), quantity: 40, costPrice: '1.00' } });
  });

  const register = (k: string, token = desk.token) =>
    api.post('/patients').set(bearer(token)).set('Idempotency-Key', k).send({ firstName: 'Replay', fatherName: 'Twice', sex: 'MALE', confirmDuplicate: true });

  it('registers a patient once, however often the same request is replayed', async () => {
    const k = key();
    const first = await register(k).expect(201);
    const again = await register(k).expect(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.mrn).toBe(first.body.mrn);
    expect(await db.patient.count({ where: { tenantId, firstName: 'Replay' } })).toBe(1);
  });

  it('takes a payment once when the reply was lost and the browser sends it again', async () => {
    const service = await db.serviceItem.create({ data: { tenantId, code: 'FEE', name: 'Consultation', price: '80.00' } });
    const p = (await register(key()).expect(201)).body;
    const visit = (await api.post('/visits').set(bearer(desk.token)).set('Idempotency-Key', key()).send({ patientId: p.id, serviceId: service.id }).expect(201)).body;
    const k = key();
    const invoice = (await api.post('/invoices').set(bearer(cashier.token)).set('Idempotency-Key', k).send({ visitId: visit.id }).expect(201)).body;
    // Replaying the invoice step returns the same invoice instead of "nothing left to bill".
    expect((await api.post('/invoices').set(bearer(cashier.token)).set('Idempotency-Key', k).send({ visitId: visit.id }).expect(201)).body.id).toBe(invoice.id);
    const pk = key();
    for (let i = 0; i < 3; i++) {
      await api.post(`/invoices/${invoice.id}/payments`).set(bearer(cashier.token)).set('Idempotency-Key', pk).send({ method: 'CASH', amount: 80 }).expect(201);
    }
    expect(await db.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it('does not store refusals, so the same step can succeed once its cause is fixed', async () => {
    const k = key();
    const missing = crypto.randomUUID();
    await api.post('/visits').set(bearer(desk.token)).set('Idempotency-Key', k).send({ patientId: missing }).expect(404);
    const p = (await register(key()).expect(201)).body;
    await api.post('/visits').set(bearer(desk.token)).set('Idempotency-Key', key()).send({ patientId: p.id }).expect(201);
    expect(await db.idempotentRequest.count({ where: { key: k } })).toBe(0);
  });

  it('refuses a key reused for a different request or by someone else', async () => {
    const k = key();
    await register(k).expect(201);
    await api.post('/visits').set(bearer(desk.token)).set('Idempotency-Key', k).send({ patientId: crypto.randomUUID() }).expect(409);
    await register(k, doctor.token).expect(409); // doctors may not register in this clinic, and the key is someone else's anyway
    await api.post('/patients').set(bearer(desk.token)).set('Idempotency-Key', 'bad key!').send({}).expect(409);
  });

  it('keeps each clinic’s stored replies separate', async () => {
    const otherTenant = (await makeClinic('Other Offline Clinic')).id;
    const otherDesk = await makeStaff(otherTenant, 'RECEPTIONIST');
    const k = key();
    const mine = (await register(k).expect(201)).body;
    const theirs = (await register(k, otherDesk.token).expect(201)).body;
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.tenantId).toBe(otherTenant);
  });

  it('runs a request once even when two copies arrive at the same time (two tabs sending)', async () => {
    const k = key();
    const replies = await Promise.all([register(k), register(k), register(k)]);
    // One runs; the others get its reply, or are told it is still running (and retry later).
    expect(replies.every((r) => r.status === 201 || (r.status === 409 && r.body.code === 'IDEMPOTENCY_IN_PROGRESS'))).toBe(true);
    expect(await db.patient.count({ where: { tenantId, firstName: 'Replay', createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeGreaterThanOrEqual(1);
    const ids = new Set(replies.filter((r) => r.status === 201).map((r) => r.body.id));
    expect(ids.size).toBe(1);
    const after = await register(k).expect(201);
    expect(ids.has(after.body.id)).toBe(true);
  });

  it('answers "in progress" while the first copy runs, and "unknown" when it died half way', async () => {
    const running = key();
    const dead = key();
    const failed = key();
    const desk = await db.user.findUniqueOrThrow({ where: { id: (await db.user.findFirstOrThrow({ where: { tenantId, role: 'RECEPTIONIST' } })).id } });
    const row = (k: string, status: number, createdAt = new Date()) =>
      db.idempotentRequest.create({ data: { tenantId, key: k, userId: desk.id, method: 'POST', path: '/patients', status, response: {}, createdAt } });
    await row(running, 0);
    await row(dead, 0, new Date(Date.now() - 10 * 60_000));
    await row(failed, -1);
    expect((await register(running).expect(409)).body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect((await register(dead).expect(409)).body.code).toBe('IDEMPOTENCY_UNKNOWN');
    expect((await register(failed).expect(409)).body.code).toBe('IDEMPOTENCY_UNKNOWN');
  });

  it('takes payments toward a visit in instalments, and refuses what is no longer owed', async () => {
    const service = await db.serviceItem.create({ data: { tenantId, code: 'FEE2', name: 'Follow-up', price: '80.00' } });
    const p = (await register(key()).expect(201)).body;
    const visit = (await api.post('/visits').set(bearer(desk.token)).set('Idempotency-Key', key()).send({ patientId: p.id, serviceId: service.id }).expect(201)).body;
    const pay = (amount: number, k = key(), extra: object = {}) =>
      api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).set('Idempotency-Key', k).send({ method: 'CASH', amount, ...extra });

    const owedBefore = (await api.get('/billing/owed').set(bearer(cashier.token)).expect(200)).body.find((b: { id: string }) => b.id === visit.id);
    expect([owedBefore.subtotal, owedBefore.paid]).toEqual(['80.00', '0.00']);

    const first = key();
    await pay(50, first).expect(201);
    await pay(50, first).expect(201); // the same payment sent again: still one payment
    const owedMid = (await api.get('/billing/owed').set(bearer(cashier.token)).expect(200)).body.find((b: { id: string }) => b.id === visit.id);
    expect([owedMid.subtotal, owedMid.paid]).toEqual(['30.00', '50.00']);

    expect((await pay(40).expect(409)).body.code).toBe('MORE_THAN_OWED');
    await pay(30).expect(201);
    const invoices = await db.invoice.findMany({ where: { visitId: visit.id }, include: { payments: true } });
    expect(invoices.map((i) => [i.status, i.payments.length])).toEqual([['PAID', 2]]);
    expect((await pay(10).expect(409)).body.code).toBe('NOTHING_OWED');
    expect((await api.get('/billing/owed').set(bearer(cashier.token)).expect(200)).body.some((b: { id: string }) => b.id === visit.id)).toBe(false);
    // Telebirr needs its transaction reference.
    await pay(10, key(), { method: 'TELEBIRR' }).expect(400);
  });

  it('stamps replies with the server time; a replayed reply keeps the time the work was applied', async () => {
    const k = key();
    const first = await register(k).expect(201);
    const applied = Date.parse(first.headers['x-server-time']);
    expect(Number.isNaN(applied)).toBe(false);
    expect(Math.abs(applied - Date.now())).toBeLessThan(60_000);
    await new Promise((r) => setTimeout(r, 30));
    const again = await register(k).expect(201);
    expect(Date.parse(again.headers['x-server-time'])).toBeLessThanOrEqual(applied);
  });

  it('gives prescribers the drug list with stock and everyone the common diagnoses', async () => {
    const forDoctor = (await api.get('/offline/reference').set(bearer(doctor.token)).expect(200)).body;
    expect(forDoctor.drugs.find((d: { id: string }) => d.id === drugId)).toMatchObject({ genericName: 'Amoxicillin', inStock: 40 });
    expect(forDoctor.icd.length).toBeGreaterThan(30);
    const forCashier = (await api.get('/offline/reference').set(bearer(cashier.token)).expect(200)).body;
    expect(forCashier.drugs).toEqual([]);
  });
});
