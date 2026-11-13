import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** The cashier's counter: shifts with a float and a handover, mistaken payments undone, old debts seen. */
describe('billing at the counter', () => {
  let tenantId: string;
  let admin: Staff, desk: Staff, cashier: Staff, doctor: Staff;
  let fee: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Counter Clinic ${Date.now()}`)).id; // bill at the end of the visit
    [admin, desk, cashier, doctor] = await Promise.all([makeStaff(tenantId, 'ADMIN'), makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'CASHIER'), makeStaff(tenantId, 'DOCTOR')]);
    fee = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'Consultation', price: '150' } })).id;
  });

  /** A patient checked in with the fee charged; their visit id. */
  const visit = async (patientId?: string) => {
    const p = patientId ?? (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Counter', fatherName: 'Patient', sex: 'FEMALE', ageYears: 30 }).expect(201)).body.id;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p, serviceId: fee }).expect(201)).body;
    return { patientId: p as string, visitId: v.id as string };
  };
  const pay = (visitId: string, body: object) => api.post(`/visits/${visitId}/payments`).set(bearer(cashier.token)).send(body);

  it('closes a shift against the float it started with, leaves a float and hands over the rest', async () => {
    const { visitId } = await visit();
    await pay(visitId, { method: 'CASH', amount: 150 }).expect(201);
    const shift = (await api.get('/billing/shift').set(bearer(cashier.token)).expect(200)).body;
    expect(shift).toMatchObject({ payments: 1, cash: '150.00', suggestedFloat: '0.00' });

    await api.post('/billing/closings').set(bearer(cashier.token)).send({ countedCash: 100, floatLeft: 200 }).expect(400); // more left than counted
    const morning = (
      await api.post('/billing/closings').set(bearer(cashier.token)).send({ openingFloat: 200, countedCash: 350, floatLeft: 200, handedTo: 'Selam (admin)' }).expect(201)
    ).body;
    expect(morning).toMatchObject({ openingFloat: '200', expectedCash: '350', countedCash: '350', floatLeft: '200', handedTo: 'Selam (admin)', variance: '0.00' });

    // The afternoon shift starts from the float left in the drawer.
    const next = (await api.get('/billing/shift').set(bearer(cashier.token)).expect(200)).body;
    expect(next).toMatchObject({ payments: 0, cash: '0.00', suggestedFloat: '200.00' });
    const v2 = await visit();
    await pay(v2.visitId, { method: 'CASH', amount: 150 }).expect(201);
    const afternoon = (await api.post('/billing/closings').set(bearer(cashier.token)).send({ countedCash: 340 }).expect(201)).body;
    expect(afternoon).toMatchObject({ openingFloat: '200', expectedCash: '350', variance: '-10.00' });
  });

  it('lets an admin reverse a mistaken payment; the invoice owes again and the reference is freed', async () => {
    const { visitId } = await visit();
    const res = (await pay(visitId, { method: 'TELEBIRR', amount: 150, reference: 'TB-1001' }).expect(201)).body;
    const inv = res.invoices[0];
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });

    await api.post(`/payments/${payment.id}/reverse`).set(bearer(cashier.token)).send({ reason: 'Wrong patient' }).expect(403);
    await api.post(`/payments/${payment.id}/reverse`).set(bearer(admin.token)).send({ reason: 'x' }).expect(400);
    const after = (await api.post(`/payments/${payment.id}/reverse`).set(bearer(admin.token)).send({ reason: 'Recorded on the wrong patient' }).expect(201)).body;
    expect(after).toMatchObject({ status: 'OPEN', paid: '0', balance: '150.00' });
    const reversal = after.payments.find((p: { amount: string }) => Number(p.amount) < 0);
    expect(reversal).toMatchObject({ amount: '-150', method: 'TELEBIRR', note: 'Reversed: Recorded on the wrong patient' });
    await api.post(`/payments/${payment.id}/reverse`).set(bearer(admin.token)).send({ reason: 'Again, by mistake' }).expect(409);
    await api.post(`/payments/${reversal.id}/reverse`).set(bearer(admin.token)).send({ reason: 'Undo the undo' }).expect(409);

    // The same Telebirr transaction can now be recorded where it belongs.
    const right = await visit();
    await pay(right.visitId, { method: 'TELEBIRR', amount: 150, reference: 'TB-1001' }).expect(201);
    // …but only once.
    const third = await visit();
    await pay(third.visitId, { method: 'TELEBIRR', amount: 150, reference: 'TB-1001' }).expect(409);
    const log = await db.auditLog.findFirst({ where: { tenantId, action: 'payment.reverse' } });
    expect(log).not.toBeNull();
  });

  it('shows what a patient still owes from earlier visits, at check-in', async () => {
    const { patientId, visitId } = await visit();
    // Billed at the end of the visit, and left unpaid; it was yesterday.
    await api.post('/invoices').set(bearer(cashier.token)).send({ visitId }).expect(201);
    await db.visit.update({ where: { id: visitId }, data: { checkedInAt: new Date(Date.now() - 2 * 86_400_000), status: 'COMPLETED' } });

    await api.get(`/patients/${patientId}/balance`).set(bearer(doctor.token)).expect(403);
    const before = (await api.get(`/patients/${patientId}/balance`).set(bearer(desk.token)).expect(200)).body;
    expect(before).toMatchObject({ owed: '150.00', earlier: '150.00' });
    expect(before.visits).toHaveLength(1);

    // Today's visit adds to what is owed, but not to "earlier".
    await visit(patientId);
    const now = (await api.get(`/patients/${patientId}/balance`).set(bearer(desk.token)).expect(200)).body;
    expect(now).toMatchObject({ owed: '300.00', earlier: '150.00' });

    // The front desk's search says so too; a doctor's doesn't carry money.
    const mrn = (await db.patient.findUniqueOrThrow({ where: { id: patientId } })).mrn;
    const found = (await api.get(`/patients?q=${mrn}&balance=1`).set(bearer(desk.token)).expect(200)).body;
    expect(found[0].balance).toMatchObject({ earlier: '150.00' });
    const forDoctor = (await api.get(`/patients?q=${mrn}&balance=1`).set(bearer(doctor.token)).expect(200)).body;
    expect(forDoctor[0].balance).toBeUndefined();

    // Paid off at the counter: nothing owed from before.
    await pay(visitId, { method: 'CASH', amount: 150 }).expect(201);
    expect((await api.get(`/patients/${patientId}/balance`).set(bearer(desk.token)).expect(200)).body.earlier).toBe('0.00');
  });
});
