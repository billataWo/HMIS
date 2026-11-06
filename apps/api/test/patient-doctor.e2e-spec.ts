import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** The patient's path from registration to the doctor and out again, in a pay-first clinic. */
describe('patient and doctor flow', () => {
  let tenantId: string;
  let doctor: Staff, desk: Staff, cashier: Staff, pharmacist: Staff;
  let feeId: string, injectionId: string, drugId: string, testId: string;

  const register = (body: object) => api.post('/patients').set(bearer(desk.token)).send({ sex: 'FEMALE', ...body });
  const move = (visitId: string, status: string) => api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status });
  const queueEntry = async (visitId: string) =>
    (await api.get('/queue').set(bearer(doctor.token)).expect(200)).body.visits.find((v: { id: string }) => v.id === visitId);
  const payAll = async (visitId: string) => {
    const inv = (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId }).expect(201)).body;
    await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: Number(inv.total) }).expect(201);
  };

  beforeAll(async () => {
    tenantId = (await makeClinic('Flow Check Clinic', { requirePrepayment: true })).id;
    [doctor, desk, cashier, pharmacist] = await Promise.all((['DOCTOR', 'RECEPTIONIST', 'CASHIER', 'PHARMACIST'] as const).map((r) => makeStaff(tenantId, r)));
    feeId = (await db.serviceItem.create({ data: { tenantId, code: 'FEE', name: 'Consultation', price: '150.00' } })).id;
    injectionId = (await db.serviceItem.create({ data: { tenantId, code: 'INJ', name: 'Injection', price: '30.00', kind: 'PROCEDURE' } })).id;
    testId = (await db.labTest.create({ data: { tenantId, name: 'Malaria film', price: '60.00', resultOptions: ['Negative', 'Positive'] } })).id;
    drugId = (await db.drug.create({ data: { tenantId, genericName: 'Paracetamol', form: 'tablet', unit: 'tablet', sellPrice: '1.00' } })).id;
    await db.stockBatch.create({ data: { drugId, batchNo: 'P1', expiryDate: new Date(Date.now() + 200 * 86_400_000), quantity: 100, costPrice: '0.50' } });
  });

  it('offers the existing card instead of registering the same person twice', async () => {
    const first = (await register({ firstName: 'Tsion', fatherName: 'Abera', phone: '0911887766' }).expect(201)).body;
    const byName = await register({ firstName: 'tsion', fatherName: 'ABERA' }).expect(409);
    expect(byName.body.duplicates.map((d: { mrn: string }) => d.mrn)).toEqual([first.mrn]);
    const byPhone = await register({ firstName: 'Other', fatherName: 'Person', phone: '+251911887766' }).expect(409);
    expect(byPhone.body.duplicates[0].id).toBe(first.id);
    // A child registered with the mother's phone is not a duplicate.
    await register({ firstName: 'Baby', fatherName: 'Abera', phone: '0911887766', relativeId: first.id }).expect(201);
    await register({ firstName: 'Tsion', fatherName: 'Abera', confirmDuplicate: true }).expect(201); // a different Tsion Abera
  });

  it('walks a patient through: pay, doctor, lab, diagnosis, pharmacy, done', async () => {
    const p = (await register({ firstName: 'Meseret', fatherName: 'Lemma' }).expect(201)).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, serviceId: feeId }).expect(201)).body;

    // The doctor's screen knows the fee is unpaid, so it doesn't offer "Call in".
    const before = (await api.get(`/visits/${v.id}`).set(bearer(doctor.token)).expect(200)).body;
    expect([before.prepayment, before.consultationPaid, before.owed]).toEqual([true, false, '150.00']);
    await move(v.id, 'IN_CONSULTATION').expect(409);
    // Nothing is ordered for a patient the doctor hasn't seen.
    await api.post(`/visits/${v.id}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [testId] }).expect(409);
    await api
      .post(`/visits/${v.id}/prescriptions`)
      .set(bearer(doctor.token))
      .send({ items: [{ drugId, dose: '1 g', frequency: 'TID', quantity: 3 }] })
      .expect(409);
    await payAll(v.id);
    expect((await api.get(`/visits/${v.id}`).set(bearer(doctor.token)).expect(200)).body.consultationPaid).toBe(true);
    await move(v.id, 'IN_CONSULTATION').expect(200);

    // Sent to the lab before a diagnosis is fine (the result may decide it).
    const [order] = (await api.post(`/visits/${v.id}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [testId] }).expect(201)).body;
    await move(v.id, 'AWAITING_LAB').expect(200);
    expect((await queueEntry(v.id)).owed).toBe('60.00');
    await payAll(v.id);
    await db.labOrder.update({ where: { id: order.id }, data: { status: 'VERIFIED', resultValue: 'Negative', verifiedAt: new Date() } });
    await move(v.id, 'IN_CONSULTATION').expect(200);

    // Ending the consultation needs a diagnosis.
    await api.post(`/visits/${v.id}/procedures`).set(bearer(doctor.token)).send({ serviceId: injectionId }).expect(201);
    const rx = (
      await api.post(`/visits/${v.id}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId, dose: '1 g', frequency: 'TID', durationDays: 3, quantity: 18 }] }).expect(201)
    ).body;
    const refused = await move(v.id, 'AWAITING_PHARMACY').expect(409);
    expect(refused.body.message).toContain('diagnosis');
    expect((await queueEntry(v.id)).diagnosed).toBe(false);
    await api.post(`/visits/${v.id}/diagnoses`).set(bearer(doctor.token)).send({ icd11Code: 'MG26', label: 'Fever' }).expect(201);
    expect((await queueEntry(v.id)).diagnosed).toBe(true);
    await move(v.id, 'AWAITING_PHARMACY').expect(200);

    // The injection is still owed: the queue shows it, so the patient doesn't leave without paying.
    expect((await queueEntry(v.id)).owed).toBe('30.00');
    await api.post(`/prescriptions/${rx.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 18 }] }).expect(201);
    await payAll(v.id); // injection 30 + drugs 18
    expect((await queueEntry(v.id)).owed).toBe('0.00');
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 18 }] }).expect(201);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('COMPLETED');
  });

  it('keeps pharmacy counter sales out of the consultation record', async () => {
    const p = (await register({ firstName: 'Counter', fatherName: 'Buyer' }).expect(201)).body;
    const sale = (await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ patientId: p.id, items: [{ drugId, quantity: 4 }] }).expect(201)).body;
    const visitId = sale.visitId as string;

    await api.patch(`/visits/${visitId}`).set(bearer(doctor.token)).send({ history: 'x' }).expect(409);
    await api.post(`/visits/${visitId}/diagnoses`).set(bearer(doctor.token)).send({ icd11Code: 'MG26', label: 'Fever' }).expect(409);
    await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [testId] }).expect(409);
    await api.post(`/visits/${visitId}/procedures`).set(bearer(doctor.token)).send({ serviceId: injectionId }).expect(409);
    await api
      .post(`/visits/${visitId}/prescriptions`)
      .set(bearer(doctor.token))
      .send({ items: [{ drugId, dose: '1', frequency: 'OD', quantity: 1 }] })
      .expect(409);

    const record = (await api.get(`/patients/${p.id}`).set(bearer(doctor.token)).expect(200)).body;
    expect(record.visits[0].kind).toBe('WALK_IN');
    // A counter sale doesn't stop the customer from being checked in to see a doctor.
    await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201);
  });
});
