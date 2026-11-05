import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

describe('billing and cashier', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, cashier: Staff, cashier2: Staff, admin: Staff;
  let consultationId: string;
  let ref = 0;
  const txRef = () => `TX-${Date.now()}-${++ref}`;

  /** A checked-in visit with a 150.00 consultation fee and 2 × 5.00 of drugs: 160.00 to bill. */
  async function billableVisit() {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Bill', fatherName: 'Able', sex: 'MALE' }).expect(201)).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, serviceId: consultationId }).expect(201)).body;
    await db.charge.create({ data: { visitId: v.id, source: 'PHARMACY', description: 'Amoxicillin 500 mg', quantity: 2, unitPrice: '5.00' } });
    return v.id as string;
  }
  const invoice = (body: object, token = cashier.token) => api.post('/invoices').set(bearer(token)).send(body);
  const pay = (id: string, body: object, token = cashier.token) => api.post(`/invoices/${id}/payments`).set(bearer(token)).send(body);

  beforeAll(async () => {
    const clinic = await makeClinic('Billing Clinic');
    tenantId = clinic.id;
    [desk, doctor, cashier, cashier2, admin] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'ADMIN'),
    ]);
    consultationId = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'General consultation', price: '150.00' } })).id;
  });

  it('lists visits with unbilled charges, for billing staff only', async () => {
    const visitId = await billableVisit();
    const res = await api.get('/billing/pending').set(bearer(cashier.token)).expect(200);
    const entry = res.body.find((v: { id: string }) => v.id === visitId);
    expect(entry.subtotal).toBe('160.00');
    expect(entry.charges).toHaveLength(2);
    await api.get('/billing/pending').set(bearer(doctor.token)).expect(403);
  });

  it('invoices all unbilled charges of a visit, once', async () => {
    const visitId = await billableVisit();
    const inv = (await invoice({ visitId }).expect(201)).body;
    expect(inv.number).toMatch(/^INV-\d{6}$/);
    expect([inv.subtotal, inv.total, inv.balance, inv.status]).toEqual(['160', '160', '160.00', 'OPEN']);
    expect(inv.charges).toHaveLength(2);

    await invoice({ visitId }).expect(409);
    const pending = (await api.get('/billing/pending').set(bearer(cashier.token)).expect(200)).body;
    expect(pending.find((v: { id: string }) => v.id === visitId)).toBeUndefined();
  });

  it('never invoices the same charges twice when two cashiers click at once', async () => {
    const visitId = await billableVisit();
    const results = await Promise.all([invoice({ visitId }), invoice({ visitId }, cashier2.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.invoice.count({ where: { visitId } })).toBe(1);
  });

  it('lets only admins discount, with a reason, and never below zero', async () => {
    const visitId = await billableVisit();
    await invoice({ visitId, discount: 20, discountReason: 'Staff family' }).expect(403);
    await invoice({ visitId, discount: 20 }, admin.token).expect(400);
    await invoice({ visitId, discount: 500, discountReason: 'Too much' }, admin.token).expect(409);
    const inv = (await invoice({ visitId, discount: 20, discountReason: 'Staff family' }, admin.token).expect(201)).body;
    expect([inv.subtotal, inv.discount, inv.total]).toEqual(['160', '20', '140']);

    const free = await billableVisit();
    const waived = (await invoice({ visitId: free, discount: 160, discountReason: 'Fee waiver' }, admin.token).expect(201)).body;
    expect(waived.status).toBe('PAID');
  });

  it('takes partial and mobile-money payments, and refuses overpayment', async () => {
    const inv = (await invoice({ visitId: await billableVisit() }).expect(201)).body;
    await pay(inv.id, { method: 'TELEBIRR', amount: 60 }).expect(400); // reference required
    await pay(inv.id, { method: 'CASH', amount: 10.005 }).expect(400); // sub-cent amount

    const partial = (await pay(inv.id, { method: 'CASH', amount: 100 }).expect(201)).body;
    expect([partial.status, partial.balance]).toEqual(['PARTIALLY_PAID', '60.00']);
    await pay(inv.id, { method: 'CASH', amount: 60.01 }).expect(409);

    const reference = txRef();
    const done = (await pay(inv.id, { method: 'TELEBIRR', amount: 60, reference }).expect(201)).body;
    expect([done.status, done.balance]).toEqual(['PAID', '0.00']);
    expect(done.payments.map((p: { method: string }) => p.method)).toEqual(['CASH', 'TELEBIRR']);
    await pay(inv.id, { method: 'CASH', amount: 1 }).expect(409);

    // The same Telebirr transaction can't pay a second bill.
    const other = (await invoice({ visitId: await billableVisit() }).expect(201)).body;
    await pay(other.id, { method: 'TELEBIRR', amount: 60, reference }).expect(409);
  });

  it('never accepts more than the balance when two payments arrive at once', async () => {
    const inv = (await invoice({ visitId: await billableVisit() }).expect(201)).body;
    const results = await Promise.all([
      pay(inv.id, { method: 'CASH', amount: 100 }),
      pay(inv.id, { method: 'CASH', amount: 100 }, cashier2.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paid.toString()).toBe('100');
  });

  it('bills credit and insurance patients to the named payer', async () => {
    const visitId = await billableVisit();
    await invoice({ visitId, payerType: 'INSURANCE' }).expect(400);
    const inv = (await invoice({ visitId, payerType: 'INSURANCE', payerName: 'Ethiopian Insurance Corporation' }).expect(201)).body;
    expect([inv.payerType, inv.payerName, inv.status]).toEqual(['INSURANCE', 'Ethiopian Insurance Corporation', 'OPEN']);
  });

  it('lets an admin void an unpaid invoice and re-bill its charges', async () => {
    const visitId = await billableVisit();
    const inv = (await invoice({ visitId }).expect(201)).body;
    await api.post(`/invoices/${inv.id}/void`).set(bearer(cashier.token)).send({ reason: 'Wrong patient' }).expect(403);
    await api.post(`/invoices/${inv.id}/void`).set(bearer(admin.token)).send({ reason: 'no' }).expect(400);
    const voided = (await api.post(`/invoices/${inv.id}/void`).set(bearer(admin.token)).send({ reason: 'Billed to the wrong payer' }).expect(201)).body;
    expect(voided.status).toBe('VOID');
    expect(voided.charges).toHaveLength(0);
    await pay(inv.id, { method: 'CASH', amount: 1 }).expect(409);

    const again = (await invoice({ visitId }).expect(201)).body;
    expect(again.number).not.toBe(inv.number);
    expect(again.total).toBe('160');

    await pay(again.id, { method: 'CASH', amount: 1 }).expect(201);
    await api.post(`/invoices/${again.id}/void`).set(bearer(admin.token)).send({ reason: 'Should not work' }).expect(409);
  });

  it("summarises the day and closes each cashier's drawer", async () => {
    const clinic = await makeClinic('Closing Clinic');
    const c1 = await makeStaff(clinic.id, 'CASHIER');
    const c2 = await makeStaff(clinic.id, 'CASHIER');
    const front = await makeStaff(clinic.id, 'RECEPTIONIST');
    const fee = (await db.serviceItem.create({ data: { tenantId: clinic.id, code: 'CONS', name: 'Consultation', price: '150.00' } })).id;
    const bill = async () => {
      const p = (await api.post('/patients').set(bearer(front.token)).send({ firstName: 'Day', fatherName: 'End', sex: 'FEMALE' }).expect(201)).body;
      const v = (await api.post('/visits').set(bearer(front.token)).send({ patientId: p.id, serviceId: fee }).expect(201)).body;
      return (await invoice({ visitId: v.id }, c1.token).expect(201)).body.id as string;
    };

    await pay(await bill(), { method: 'CASH', amount: 150 }, c1.token).expect(201);
    await pay(await bill(), { method: 'CHAPA', amount: 150, reference: txRef() }, c1.token).expect(201);
    await pay(await bill(), { method: 'CASH', amount: 150 }, c2.token).expect(201);
    await bill(); // left unpaid

    const daily = (await api.get('/billing/daily').set(bearer(c1.token)).expect(200)).body;
    expect(daily.collected).toBe('450.00');
    expect(daily.byMethod).toEqual({ CASH: '300.00', CHAPA: '150.00' });
    expect(daily.invoices).toEqual(expect.objectContaining({ count: 4, billed: '600.00', unpaid: '150.00' }));
    expect(daily.cashiers.find((c: { cashier: { id: string } }) => c.cashier.id === c1.id).total).toBe('300.00');

    const closing = (await api.post('/billing/closings').set(bearer(c1.token)).send({ countedCash: 140, note: 'Short 10 birr' }).expect(201)).body;
    expect([closing.expectedCash, closing.countedCash, closing.variance]).toEqual(['150', '140', '-10.00']);
    await api.post('/billing/closings').set(bearer(c1.token)).send({ countedCash: 150 }).expect(409);

    // After closing, that cashier can't take more money today; another cashier still can.
    const late = await bill();
    await pay(late, { method: 'CASH', amount: 150 }, c1.token).expect(409);
    await pay(late, { method: 'CASH', amount: 150 }, c2.token).expect(201);

    const after = (await api.get('/billing/daily').set(bearer(c2.token)).expect(200)).body;
    expect(after.closings).toEqual([expect.objectContaining({ variance: '-10.00', note: 'Short 10 birr' })]);
  });

  it("keeps each clinic's billing private", async () => {
    const other = await makeClinic('Other Billing Clinic');
    const otherCashier = await makeStaff(other.id, 'CASHIER');
    const visitId = await billableVisit();
    await invoice({ visitId }, otherCashier.token).expect(404);
    const inv = (await invoice({ visitId }).expect(201)).body;
    await api.get(`/invoices/${inv.id}`).set(bearer(otherCashier.token)).expect(404);
    await pay(inv.id, { method: 'CASH', amount: 1 }, otherCashier.token).expect(404);
    expect((await api.get('/billing/pending').set(bearer(otherCashier.token)).expect(200)).body).toEqual([]);
    expect((await api.get('/invoices').set(bearer(otherCashier.token)).expect(200)).body).toEqual([]);
  });

  it('records billing actions in the audit log', async () => {
    const inv = (await invoice({ visitId: await billableVisit() }).expect(201)).body;
    await pay(inv.id, { method: 'CASH', amount: 50 }).expect(201);
    const actions = (await db.auditLog.findMany({ where: { entityId: inv.id } })).map((a) => a.action).sort();
    expect(actions).toEqual(['invoice.create', 'payment.create']);
  });
});
