import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp, recordDiagnosis } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/**
 * The full pay-first loop: reception, cashier, doctor, lab and pharmacy, including the cases where
 * a patient pays and then doesn't receive the service.
 */
describe('cashier with doctor, lab and pharmacy (pay before service)', () => {
  let tenantId: string;
  let admin: Staff, doctor: Staff, desk: Staff, cashier: Staff, tech: Staff, pharmacist: Staff;
  let hbTest: string, drugId: string, consultId: string;

  const move = (visitId: string, status: string, token = doctor.token) => api.patch(`/visits/${visitId}/status`).set(bearer(token)).send({ status });
  const invoice = async (visitId: string) => (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId }).expect(201)).body;
  const payAll = async (inv: { id: string; total: string }) =>
    (await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: Number(inv.total) }).expect(201)).body;
  const remove = (invoiceId: string, chargeId: string, body: object = {}) =>
    api.post(`/invoices/${invoiceId}/charges/${chargeId}/remove`).set(bearer(admin.token)).send({ reason: 'Patient left before the service', ...body });

  /** Checks a patient in with the consultation fee, pays it and has the doctor call them in. */
  async function seenByDoctor(name = 'Pay') {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: name, fatherName: 'First', sex: 'MALE' }).expect(201)).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, serviceId: consultId }).expect(201)).body;
    await move(v.id, 'IN_CONSULTATION').expect(409); // fee not paid
    await payAll(await invoice(v.id));
    await move(v.id, 'IN_CONSULTATION').expect(200);
    await recordDiagnosis(v.id);
    return { visitId: v.id as string, patientId: p.id as string };
  }

  beforeAll(async () => {
    tenantId = (await makeClinic('Pay First Clinic', { requirePrepayment: true })).id;
    [admin, doctor, desk, cashier, tech, pharmacist] = await Promise.all(
      (['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'CASHIER', 'LAB_TECH', 'PHARMACIST'] as const).map((r) => makeStaff(tenantId, r)),
    );
    consultId = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'Consultation', price: '150.00' } })).id;
    hbTest = (await db.labTest.create({ data: { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', price: '100.00' } })).id;
    drugId = (await db.drug.create({ data: { tenantId, genericName: 'Amoxicillin', form: 'capsule', unit: 'capsule', sellPrice: '5.00' } })).id;
    await db.stockBatch.create({ data: { drugId, batchNo: 'AMX-1', expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: 500, costPrice: '2.00' } });
  });

  it('runs the whole visit: fee, test, result, drugs, each paid before it is given', async () => {
    const { visitId } = await seenByDoctor('Whole');
    const [hb] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hbTest] }).expect(201)).body;
    await move(visitId, 'AWAITING_LAB').expect(200);
    await api.post(`/lab-orders/${hb.id}/collect`).set(bearer(tech.token)).send({}).expect(409); // not paid
    await payAll(await invoice(visitId));
    await api.post(`/lab-orders/${hb.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    await api.post(`/lab-orders/${hb.id}/result`).set(bearer(tech.token)).send({ value: '11' }).expect(201);
    await api.post(`/lab-orders/${hb.id}/verify`).set(bearer(tech.token)).send({}).expect(201);
    await move(visitId, 'IN_CONSULTATION').expect(200);

    const rx = (
      await api
        .post(`/visits/${visitId}/prescriptions`)
        .set(bearer(doctor.token))
        .send({ items: [{ drugId, dose: '500 mg', frequency: 'TID', durationDays: 5, quantity: 15 }] })
        .expect(201)
    ).body;
    await move(visitId, 'COMPLETED').expect(409); // drugs to collect
    await move(visitId, 'AWAITING_PHARMACY').expect(200);
    const item = { itemId: rx.items[0].id, quantity: 15 };
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [item] }).expect(409); // not paid
    await api.post(`/prescriptions/${rx.id}/bill`).set(bearer(pharmacist.token)).send({ items: [item] }).expect(201);
    const drugsInvoice = await invoice(visitId);
    expect(drugsInvoice.total).toBe('75');
    await payAll(drugsInvoice);
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [item] }).expect(201);
    expect((await db.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe('COMPLETED');
  });

  it('refunds a paid test whose sample was never taken, so the visit can close', async () => {
    const { visitId } = await seenByDoctor('Refund');
    const [hb] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hbTest] }).expect(201)).body;
    const inv = await payAll(await invoice(visitId));
    await api.post(`/lab-orders/${hb.id}/cancel`).set(bearer(doctor.token)).expect(409); // paid: needs a refund
    await move(visitId, 'COMPLETED').expect(409); // result pending

    const line = inv.charges.find((c: { source: string }) => c.source === 'LAB');
    await api.post(`/invoices/${inv.id}/charges/${line.id}/remove`).set(bearer(cashier.token)).send({ reason: 'Patient left' }).expect(403); // admin only
    const after = (await remove(inv.id, line.id).expect(201)).body;
    expect([after.total, after.paid, after.status]).toEqual(['0', '0', 'VOID']); // its only line
    expect(after.payments.map((p: { amount: string }) => p.amount)).toEqual(['100', '-100']);
    expect(after.payments[1].note).toContain('Refund');
    expect((await db.labOrder.findUniqueOrThrow({ where: { id: hb.id } })).status).toBe('CANCELLED');
    await remove(inv.id, line.id).expect(409); // only once

    await move(visitId, 'COMPLETED').expect(200);
    const daily = (await api.get('/billing/daily').set(bearer(admin.token)).expect(200)).body;
    expect(Number(daily.byMethod.CASH)).toBeGreaterThan(0); // refunds net out of the takings
  });

  it("won't refund what was delivered", async () => {
    const { visitId } = await seenByDoctor('Delivered');
    const [hb] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [hbTest] }).expect(201)).body;
    const inv = await payAll(await invoice(visitId));
    await api.post(`/lab-orders/${hb.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    await remove(inv.id, inv.charges[0].id).expect(409); // sample taken

    const feeInvoice = (await api.get(`/invoices?patientId=${inv.patientId}`).set(bearer(cashier.token)).expect(200)).body.find(
      (i: { id: string }) => i.id !== inv.id,
    );
    const fee = (await api.get(`/invoices/${feeInvoice.id}`).set(bearer(cashier.token)).expect(200)).body;
    await remove(fee.id, fee.charges[0].id).expect(409); // already seen by the doctor
  });

  it('refunds only the drug units that were not handed over, and then lets the pharmacy close the rest', async () => {
    const { visitId } = await seenByDoctor('Partial');
    const rx = (
      await api
        .post(`/visits/${visitId}/prescriptions`)
        .set(bearer(doctor.token))
        .send({ items: [{ drugId, dose: '500 mg', frequency: 'TID', durationDays: 3, quantity: 9 }] })
        .expect(201)
    ).body;
    const itemId = rx.items[0].id;
    await api.post(`/prescriptions/${rx.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 9 }] }).expect(201);
    const inv = await payAll(await invoice(visitId)); // 45 ETB
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 4 }] }).expect(201);

    await api.post(`/prescriptions/${rx.id}/close`).set(bearer(pharmacist.token)).send({ reason: 'Bought the rest outside' }).expect(409); // 5 paid, not given
    await remove(inv.id, inv.charges[0].id).expect(409); // 4 of the 9 were handed over
    const after = (await remove(inv.id, inv.charges[0].id, { quantity: 5 }).expect(201)).body;
    expect([after.total, after.paid, after.status]).toEqual(['20', '20', 'PAID']);
    expect(after.charges.map((c: { quantity: number; voidedAt: string | null }) => [c.quantity, !!c.voidedAt])).toEqual([
      [4, false],
      [5, true],
    ]);

    const closed = (await api.post(`/prescriptions/${rx.id}/close`).set(bearer(pharmacist.token)).send({ reason: 'Bought the rest outside' }).expect(201)).body;
    expect(closed.status).toBe('DISPENSED');
    const queue = (await api.get('/pharmacy/queue').set(bearer(pharmacist.token)).expect(200)).body;
    expect(queue.open.find((p: { id: string }) => p.id === rx.id)).toBeUndefined();
  });

  it('closes a prescription that was sent to the cashier but never paid, dropping it from the bills', async () => {
    const { visitId } = await seenByDoctor('Unpaid');
    const rx = (
      await api
        .post(`/visits/${visitId}/prescriptions`)
        .set(bearer(doctor.token))
        .send({ items: [{ drugId, dose: '500 mg', frequency: 'BID', durationDays: 3, quantity: 6 }] })
        .expect(201)
    ).body;
    await move(visitId, 'AWAITING_PHARMACY').expect(200);
    await api.post(`/prescriptions/${rx.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 6 }] }).expect(201);
    expect((await api.get('/billing/pending').set(bearer(cashier.token)).expect(200)).body.some((v: { id: string }) => v.id === visitId)).toBe(true);

    const closed = (await api.post(`/prescriptions/${rx.id}/close`).set(bearer(pharmacist.token)).send({ reason: 'Patient left' }).expect(201)).body;
    expect(closed.status).toBe('CANCELLED');
    expect((await api.get('/billing/pending').set(bearer(cashier.token)).expect(200)).body.some((v: { id: string }) => v.id === visitId)).toBe(false);
    expect((await db.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe('COMPLETED');
  });

  it('refunds a paid consultation when the patient leaves before being seen', async () => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Left', fatherName: 'Early', sex: 'FEMALE' }).expect(201)).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, serviceId: consultId }).expect(201)).body;
    const inv = await payAll(await invoice(v.id));
    await move(v.id, 'CANCELLED', desk.token).expect(200);
    const after = (await remove(inv.id, inv.charges[0].id).expect(201)).body;
    expect(after.payments.map((x: { amount: string }) => x.amount)).toEqual(['150', '-150']);
  });

  it('keeps an unfinished visit from an earlier day in the queue and blocks a second open visit', async () => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Fasting', fatherName: 'Sample', sex: 'MALE' }).expect(201)).body;
    const yesterday = new Date(Date.now() - 86_400_000);
    const old = await db.visit.create({ data: { tenantId, patientId: p.id, queueNumber: 7, status: 'AWAITING_LAB', checkedInAt: yesterday } });
    await recordDiagnosis(old.id);

    const queue = (await api.get('/queue').set(bearer(desk.token)).expect(200)).body;
    const entry = queue.visits.find((v: { id: string }) => v.id === old.id);
    expect(entry?.carriedOver).toBe(true);
    const yesterdayDay = new Date(yesterday.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    const pastQueue = (await api.get(`/queue?day=${yesterdayDay}`).set(bearer(desk.token)).expect(200)).body;
    expect(pastQueue.visits.find((v: { id: string }) => v.id === old.id)?.carriedOver).toBe(false);

    const refused = await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(409);
    expect(refused.body.message).toContain('open visit from');
    await move(old.id, 'COMPLETED').expect(200); // nothing pending on it
    await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201);
  });
});
