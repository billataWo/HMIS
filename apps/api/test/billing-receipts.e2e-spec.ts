import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** Receipts that hold up (TIN, reprints marked COPY), exemptions by category, and how old debts are. */
describe('receipts, exemptions and receivables', () => {
  let tenantId: string;
  let admin: Staff, desk: Staff, cashier: Staff, doctor: Staff;
  let fee: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Receipts Clinic ${Date.now()}`)).id;
    [admin, desk, cashier, doctor] = await Promise.all([makeStaff(tenantId, 'ADMIN'), makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'CASHIER'), makeStaff(tenantId, 'DOCTOR')]);
    fee = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'Consultation', price: '200' } })).id;
  });

  /** A visit with the fee charged; its id. */
  const visit = async () => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Receipt', fatherName: 'Patient', sex: 'MALE', ageYears: 50 }).expect(201)).body.id;
    return (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p, serviceId: fee }).expect(201)).body.id as string;
  };
  const invoice = (body: object, token = admin.token) => api.post('/invoices').set(bearer(token)).send(body);

  it("prints the clinic's TIN, and marks every reprint of a receipt as a copy", async () => {
    await api.patch('/settings').set(bearer(admin.token)).send({ tin: '0012345678' }).expect(200);
    const inv = (await invoice({ visitId: await visit() }, cashier.token).expect(201)).body;
    expect(inv).toMatchObject({ receiptPrints: 0, tenant: { tin: '0012345678' } });
    await api.post(`/invoices/${inv.id}/printed`).set(bearer(doctor.token)).expect(403);
    expect((await api.post(`/invoices/${inv.id}/printed`).set(bearer(cashier.token)).expect(201)).body.prints).toBe(1);
    expect((await api.post(`/invoices/${inv.id}/printed`).set(bearer(cashier.token)).expect(201)).body.prints).toBe(2);
    expect((await api.get(`/invoices/${inv.id}`).set(bearer(cashier.token)).expect(200)).body.receiptPrints).toBe(2);
    expect(await db.auditLog.count({ where: { tenantId, action: 'receipt.print', entityId: inv.id } })).toBe(2);
  });

  it('reports discounts by category, and what is owed by age and by whom', async () => {
    // Exemptions this month: a fee waiver and a staff discount.
    await invoice({ visitId: await visit(), discount: 200, discountCategory: 'POOR', discountReason: 'Kebele letter' }).expect(201);
    await invoice({ visitId: await visit(), discount: 50, discountCategory: 'STAFF' }).expect(201);
    // Unpaid: one bill from today, one from 45 days ago, and a company's share from 100 days ago.
    await invoice({ visitId: await visit() }, cashier.token).expect(201);
    const old = (await invoice({ visitId: await visit() }, cashier.token).expect(201)).body;
    await db.invoice.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 45 * 86_400_000) } });
    const company = await db.payer.create({ data: { tenantId, type: 'CREDIT', name: 'Old Company', coPayPercent: 10 } });
    const credit = (await invoice({ visitId: await visit(), payerType: 'CREDIT', payerId: company.id }, cashier.token).expect(201)).body;
    // (Billed to the company at the counter: all of it is theirs.)
    await db.invoice.update({ where: { id: credit.id }, data: { createdAt: new Date(Date.now() - 100 * 86_400_000) } });

    const from = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10); // today in Addis Ababa
    const r = (await api.get(`/reports/dashboard?from=${from}&to=${to}`).set(bearer(admin.token)).expect(200)).body.revenue;
    expect(r.discountsBy).toEqual([
      { category: 'POOR', count: 1, amount: '200.00' },
      { category: 'STAFF', count: 1, amount: '50.00' },
    ]);
    // Patients today: the TIN test's bill (200), the staff bill after its discount (150) and today's
    // bill (200); 200 at 45 days. The company: 200 at 100 days.
    expect(r.ageing.patients).toEqual(['550.00', '200.00', '0.00', '0.00']);
    expect(r.ageing.payers).toEqual(['0.00', '0.00', '0.00', '200.00']);
    expect(r.patientsOwe).toBe('750.00');
    expect(r.receivables).toEqual([{ payer: 'Credit: Old Company', due: '200.00' }]);
  });
});
