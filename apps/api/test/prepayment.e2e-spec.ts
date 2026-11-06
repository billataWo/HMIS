import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

describe('pay before service', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, cashier: Staff, tech: Staff, pharmacist: Staff, admin: Staff;
  let feeId: string, filmId: string, amoxId: string;

  const checkIn = async (withFee = true) => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Pay', fatherName: 'First', sex: 'MALE' }).expect(201)).body;
    return (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, ...(withFee && { serviceId: feeId }) }).expect(201)).body.id as string;
  };
  const callIn = (visitId: string) => api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' });
  /** The cashier invoices everything unbilled on the visit and, unless told otherwise, takes cash for it. */
  const settle = async (visitId: string, opts: { pay?: boolean; payerType?: string; payerName?: string } = {}) => {
    const inv = (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId, payerType: opts.payerType, payerName: opts.payerName }).expect(201)).body;
    if (opts.pay !== false && !opts.payerType) {
      await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: Number(inv.total) }).expect(201);
    }
    return inv;
  };

  beforeAll(async () => {
    tenantId = (await makeClinic('Pay First Clinic', { requirePrepayment: true })).id;
    [desk, doctor, cashier, tech, pharmacist, admin] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'LAB_TECH'),
      makeStaff(tenantId, 'PHARMACIST'),
      makeStaff(tenantId, 'ADMIN'),
    ]);
    feeId = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'Consultation', price: '150.00' } })).id;
    filmId = (await db.labTest.create({ data: { tenantId, name: 'Malaria blood film', price: '60.00', resultOptions: ['Negative', 'Positive'] } })).id;
    amoxId = (
      await db.drug.create({
        data: {
          tenantId, genericName: 'Amoxicillin', drugClass: 'penicillin', form: 'capsule', unit: 'capsule', sellPrice: '5.00',
          batches: { create: { batchNo: 'A1', expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: 100, costPrice: '3.00' } },
        },
      })
    ).id;
  });

  it('holds the patient until the consultation fee is paid', async () => {
    const visitId = await checkIn();
    const blocked = await callIn(visitId).expect(409);
    expect(blocked.body.message).toMatch(/consultation fee has not been paid/);
    let q = (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body;
    expect(q.prepayment).toBe(true);
    expect(q.visits.find((v: { id: string }) => v.id === visitId).consultationPaid).toBe(false);

    // A part payment is not enough.
    const inv = (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId }).expect(201)).body;
    await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 100 }).expect(201);
    await callIn(visitId).expect(409);
    await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 50 }).expect(201);

    q = (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body;
    expect(q.visits.find((v: { id: string }) => v.id === visitId).consultationPaid).toBe(true);
    await callIn(visitId).expect(200);
  });

  it('lets insured and fee-free patients through without cash', async () => {
    const insured = await checkIn();
    await settle(insured, { payerType: 'INSURANCE', payerName: 'CBHI' });
    await callIn(insured).expect(200);
    await callIn(await checkIn(false)).expect(200);
  });

  it('takes no lab sample until the test is paid', async () => {
    const visitId = await checkIn(false);
    await callIn(visitId).expect(200);
    const [film] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [filmId] }).expect(201)).body;

    const worklist = (await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body;
    expect(worklist.open.find((o: { id: string }) => o.id === film.id).paid).toBe(false);
    expect((await api.post(`/lab-orders/${film.id}/collect`).set(bearer(tech.token)).send({}).expect(409)).body.message).toMatch(/not been paid/);

    await settle(visitId);
    await api.post(`/lab-orders/${film.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
  });

  it('never sends patients to the cashier for a free test', async () => {
    const hiv = (await db.labTest.create({ data: { tenantId, name: 'HIV rapid test', price: '0.00', resultOptions: ['Non-reactive', 'Reactive'] } })).id;
    const visitId = await checkIn(false);
    await callIn(visitId).expect(200);
    const [o] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hiv] }).expect(201)).body;
    expect(await db.charge.count({ where: { sourceId: o.id } })).toBe(0);
    const worklist = (await api.get('/lab/worklist').set(bearer(tech.token)).expect(200)).body;
    expect(worklist.open.find((x: { id: string }) => x.id === o.id).paid).toBe(true);
    await api.post(`/lab-orders/${o.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
  });

  it('dispenses only what has been billed and paid', async () => {
    const visitId = await checkIn(false);
    await callIn(visitId).expect(200);
    const rx = (
      await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: amoxId, dose: '1 cap', frequency: 'TID', quantity: 15 }] }).expect(201)
    ).body;
    const itemId = rx.items[0].id;
    const dispense = (quantity: number) => api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity }] });
    const bill = (quantity: number) => api.post(`/prescriptions/${rx.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity }] });

    expect((await dispense(1).expect(409)).body.message).toMatch(/not been paid/);
    await bill(10).expect(201);
    expect((await bill(6).expect(409)).body.message).toMatch(/Only 5/);
    await dispense(1).expect(409); // billed but not paid yet

    await settle(visitId); // 10 × 5.00
    const queue = (await api.get('/pharmacy/queue').set(bearer(pharmacist.token)).expect(200)).body;
    const item = queue.open.find((p: { id: string }) => p.id === rx.id).items[0];
    expect([item.billedQty, item.paidQty, item.dispensedQty]).toEqual([10, 10, 0]);

    expect((await dispense(11).expect(409)).body.message).toMatch(/Only 10/);
    expect((await dispense(10).expect(201)).body.status).toBe('PARTIALLY_DISPENSED');
    // Dispensing never adds a second charge for paid units.
    expect(await db.charge.count({ where: { sourceId: itemId } })).toBe(1);
  });

  it('cancelling a prescription drops charges that are not yet invoiced', async () => {
    const visitId = await checkIn(false);
    await callIn(visitId).expect(200);
    const mk = async () =>
      (await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: amoxId, dose: '1', frequency: 'OD', quantity: 3 }] }).expect(201)).body;

    const a = await mk();
    await api.post(`/prescriptions/${a.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId: a.items[0].id, quantity: 3 }] }).expect(201);
    await api.post(`/prescriptions/${a.id}/cancel`).set(bearer(doctor.token)).expect(201);
    expect(await db.charge.count({ where: { sourceId: a.items[0].id } })).toBe(0);

    const b = await mk();
    await api.post(`/prescriptions/${b.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId: b.items[0].id, quantity: 3 }] }).expect(201);
    await settle(visitId, { pay: false });
    await api.post(`/prescriptions/${b.id}/cancel`).set(bearer(doctor.token)).expect(409);
  });

  it('can be switched off by an admin', async () => {
    await api.patch('/settings').set(bearer(cashier.token)).send({ requirePrepayment: false }).expect(403);
    const res = await api.patch('/settings').set(bearer(admin.token)).send({ requirePrepayment: false }).expect(200);
    expect(res.body.requirePrepayment).toBe(false);
    await callIn(await checkIn()).expect(200);
    expect((await api.get('/settings').set(bearer(desk.token)).expect(200)).body.requirePrepayment).toBe(false);
    await api.patch('/settings').set(bearer(admin.token)).send({ requirePrepayment: true }).expect(200);
  });
});
