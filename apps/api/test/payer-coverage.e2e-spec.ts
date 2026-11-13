import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/**
 * A company's employees and insured patients: their coverage on record, the payer's tariff and
 * co-payment, the patient paying only their share before each service, and the payer's claim.
 */
describe('credit and insurance coverage', () => {
  let tenantId: string;
  let admin: Staff, desk: Staff, doctor: Staff, tech: Staff, cashier: Staff, pharmacist: Staff;
  let company: string, insurer: string;
  let consult: string, dressing: string, hb: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Coverage Clinic ${Date.now()}`, { requirePrepayment: true })).id;
    [admin, desk, doctor, tech, cashier, pharmacist] = await Promise.all([
      makeStaff(tenantId, 'ADMIN'),
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'PHARMACIST'),
    ]);
    consult = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'General consultation', price: '150' } })).id;
    dressing = (await db.serviceItem.create({ data: { tenantId, code: 'DRS', name: 'Wound dressing', price: '80', kind: 'PROCEDURE' } })).id;
    hb = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', price: '100', resultOptions: [] } })).id;
  });

  const newPatient = async () =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Covered', fatherName: 'Employee', sex: 'MALE', ageYears: 40 }).expect(201)).body.id as string;
  const cover = (patientId: string, payerId: string, body: object = {}) =>
    api.post(`/patients/${patientId}/coverages`).set(bearer(desk.token)).send({ payerId, memberId: 'ET-5531', validUntil: '2030-12-31', ...body });

  it('keeps the agreement: co-payment, authorization and the payer’s own prices', async () => {
    company = (await api.post('/payers').set(bearer(admin.token)).send({ type: 'CREDIT', name: 'Ethio Telecom', coPayPercent: 20, requiresAuthorization: true }).expect(201)).body.id;
    insurer = (await api.post('/payers').set(bearer(admin.token)).send({ type: 'INSURANCE', name: 'Awash Insurance' }).expect(201)).body.id;
    await api.post('/payers').set(bearer(admin.token)).send({ type: 'CREDIT', name: 'Too much', coPayPercent: 120 }).expect(400);

    const tariff = (await api.get(`/payers/${company}/tariff`).set(bearer(admin.token)).expect(200)).body;
    expect(tariff.items.map((i: { name: string }) => i.name)).toEqual(expect.arrayContaining(['General consultation', 'Wound dressing', 'Hemoglobin']));
    await api
      .put(`/payers/${company}/tariff`)
      .set(bearer(cashier.token))
      .send({ items: [] })
      .expect(403);
    const saved = (
      await api
        .put(`/payers/${company}/tariff`)
        .set(bearer(admin.token))
        .send({
          items: [
            { itemType: 'SERVICE', itemId: consult, price: 120 },
            { itemType: 'LAB', itemId: hb, price: 80 },
            { itemType: 'SERVICE', itemId: dressing, price: null, excluded: true },
          ],
        })
        .expect(200)
    ).body;
    expect(saved.saved).toBe(3);
    const after = (await api.get(`/payers/${company}/tariff`).set(bearer(admin.token)).expect(200)).body.items;
    expect(after.find((i: { itemId: string }) => i.itemId === consult)).toMatchObject({ cashPrice: '150.00', price: '120.00', excluded: false });
    expect(after.find((i: { itemId: string }) => i.itemId === dressing)).toMatchObject({ excluded: true });
  });

  it('records a patient’s coverage at the front desk', async () => {
    const p = await newPatient();
    await cover(p, company, {}).expect(201);
    await cover(p, company).expect(409); // already covered by them
    await api.post(`/patients/${p}/coverages`).set(bearer(pharmacist.token)).send({ payerId: company }).expect(403);
    const list = (await api.get(`/patients/${p}/coverages`).set(bearer(desk.token)).expect(200)).body;
    expect(list[0]).toMatchObject({ memberId: 'ET-5531', payer: { name: 'Ethio Telecom', coPayPercent: '20' } });
  });

  it('bills the payer at its tariff; the patient pays only their co-payment before each service', async () => {
    const p = await newPatient();
    const coverageId = (await cover(p, company).expect(201)).body.id;
    const checkIn = (body: object) => api.post('/visits').set(bearer(desk.token)).send({ patientId: p, serviceId: consult, coverageId, ...body });
    expect((await checkIn({}).expect(409)).body.code).toBe('AUTHORIZATION_REQUIRED');
    const visit = (await checkIn({ authorizationNo: 'AUTH-77' }).expect(201)).body;
    expect(visit).toMatchObject({ payerId: company, memberId: 'ET-5531', authorizationNo: 'AUTH-77', coPayPercent: '20' });
    expect(visit.charges[0]).toMatchObject({ unitPrice: '120', payerId: company });

    // Pay first: the doctor waits for the patient's 20% (24 ETB), not the whole fee.
    await api.patch(`/visits/${visit.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(409);
    const owed = (await api.get('/billing/owed').set(bearer(cashier.token)).expect(200)).body.find((v: { id: string }) => v.id === visit.id);
    expect(owed.subtotal).toBe('24.00');
    await api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 30 }).expect(409);
    const paid = (await api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 24 }).expect(201)).body;
    expect(paid.invoices[0]).toMatchObject({ payerType: 'CREDIT', payerName: 'Ethio Telecom', total: '120', patientShare: '24', patientPaid: '24', patientDue: '0.00', payerDue: '96.00' });
    await api.patch(`/visits/${visit.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);

    // A test at the payer's price (80): the lab takes the sample once the patient pays 16.
    const [order] = (await api.post(`/visits/${visit.id}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hb] }).expect(201)).body;
    await api.post(`/lab-orders/${order.id}/collect`).set(bearer(tech.token)).send({}).expect(409);
    await api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 16 }).expect(201);
    await api.post(`/lab-orders/${order.id}/collect`).set(bearer(tech.token)).send({}).expect(201);

    // Not covered (excluded by the payer): the patient pays the clinic's price in full.
    const proc = (await api.post(`/visits/${visit.id}/procedures`).set(bearer(doctor.token)).send({ serviceId: dressing, quantity: 1 }).expect(201)).body;
    expect(proc.unitPrice).toBe('80');
    const queue = (await api.get('/queue').set(bearer(desk.token)).expect(200)).body.visits.find((v: { id: string }) => v.id === visit.id);
    expect(queue.owed).toBe('80.00');
    const own = (await api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 80 }).expect(201)).body;
    expect(own.invoices[0]).toMatchObject({ payerType: 'SELF', total: '80', status: 'PAID' });

    // The payer owes its share: 96 + 64.
    const payer = (await api.get('/payers').set(bearer(cashier.token)).expect(200)).body.find((x: { id: string }) => x.id === company);
    expect(payer).toMatchObject({ balance: '160.00', openInvoices: 2 });
  });

  it('gives the payer a claim with member, authorization and diagnosis, and takes its settlement', async () => {
    const st = (await api.get(`/payers/${company}/statement`).set(bearer(cashier.token)).expect(200)).body;
    expect(st.balance).toBe('160.00');
    expect(st.unpaid[0]).toMatchObject({ payerShare: '96.00', balance: '96.00', visit: { memberId: 'ET-5531', authorizationNo: 'AUTH-77' } });
    await api.post(`/payers/${company}/settlements`).set(bearer(cashier.token)).send({ method: 'BANK_TRANSFER', amount: 200, reference: 'CHQ-1' }).expect(409);
    const done = (await api.post(`/payers/${company}/settlements`).set(bearer(cashier.token)).send({ method: 'BANK_TRANSFER', amount: 160, reference: 'CHQ-2' }).expect(201)).body;
    expect(done.remainingBalance).toBe('0.00');
    const inv = await db.invoice.findMany({ where: { tenantId, payerId: company } });
    expect(inv.every((i) => i.status === 'PAID')).toBe(true);
    expect(await db.payment.count({ where: { tenantId, reference: 'CHQ-2', byPayer: true } })).toBe(2);
  });

  it('lets a payer with no co-payment cover services straight away, and the visit change payer', async () => {
    const p = await newPatient();
    const coverageId = (await cover(p, insurer, { memberId: 'AW-9' }).expect(201)).body.id;
    const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p, serviceId: consult, coverageId }).expect(201)).body;
    expect(visit.charges[0]).toMatchObject({ unitPrice: '150', payerId: insurer }); // no tariff: the clinic's price
    await api.patch(`/visits/${visit.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200); // nothing for the patient to pay

    // Their card turns out to be expired: the patient pays the visit themselves.
    const changed = (await api.post(`/visits/${visit.id}/coverage`).set(bearer(desk.token)).send({ coverageId: null }).expect(201)).body;
    expect(changed).toMatchObject({ payerId: null, repriced: 1 });
    const charge = await db.charge.findFirstOrThrow({ where: { visitId: visit.id } });
    expect([charge.payerId, Number(charge.unitPrice)]).toEqual([null, 150]);
    // An expired coverage can't be used.
    await api.patch(`/coverages/${coverageId}`).set(bearer(desk.token)).send({ validUntil: '2020-01-01' }).expect(200);
    await api.post(`/visits/${visit.id}/coverage`).set(bearer(desk.token)).send({ coverageId }).expect(409);
  });

  it('refunds the patient’s co-payment when a covered line is taken off', async () => {
    const p = await newPatient();
    const coverageId = (await cover(p, company).expect(201)).body.id;
    const visit = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p, serviceId: consult, coverageId, authorizationNo: 'AUTH-9' }).expect(201)).body;
    await api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 24 }).expect(201);
    await api.patch(`/visits/${visit.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const [order] = (await api.post(`/visits/${visit.id}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hb] }).expect(201)).body;
    const res = (await api.post(`/visits/${visit.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 16 }).expect(201)).body;
    const inv = res.invoices[0];
    const line = (await db.charge.findFirstOrThrow({ where: { invoiceId: inv.id, sourceId: order.id } })).id;
    const after = (await api.post(`/invoices/${inv.id}/charges/${line}/remove`).set(bearer(admin.token)).send({ reason: 'Patient left before the sample' }).expect(201)).body;
    expect(after).toMatchObject({ status: 'VOID', patientShare: '0', patientPaid: '0' });
    const refund = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id, amount: { lt: 0 } } });
    expect(Number(refund.amount)).toBe(-16);
  });
});
