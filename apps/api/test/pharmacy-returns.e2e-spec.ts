import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
type Item = { id: string; dispensedQty: number; returnedQty: number; refundedQty: number };

/**
 * Drugs a patient brings back, medicine labels and the medication history, in a pay-first clinic
 * (refunds through the invoice) and a bill-at-the-end clinic (the charge just shrinks).
 */
describe.each([
  { name: 'pay first', prepay: true },
  { name: 'bill at the end', prepay: false },
])('pharmacy returns ($name)', ({ prepay }) => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, cashier: Staff, pharmacist: Staff, admin: Staff;
  let amoxId: string, batchId: string;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Returns Clinic ${prepay ? 'A' : 'B'} ${Date.now()}`, { requirePrepayment: prepay })).id;
    [desk, doctor, cashier, pharmacist, admin] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'PHARMACIST'),
      makeStaff(tenantId, 'ADMIN'),
    ]);
    const drug = await db.drug.create({
      data: {
        tenantId, genericName: 'Amoxicillin', strength: '500 mg', drugClass: 'penicillin', form: 'capsule', unit: 'capsule', sellPrice: '5.00',
        batches: { create: { batchNo: 'AMX-1', expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: 100, costPrice: '3.00' } },
      },
      include: { batches: true },
    });
    amoxId = drug.id;
    batchId = drug.batches[0].id;
  });

  const stock = async () => (await db.stockBatch.findUniqueOrThrow({ where: { id: batchId } })).quantity;
  const item = async (id: string) => db.prescriptionItem.findUniqueOrThrow({ where: { id } }) as Promise<Item>;

  /** A patient seen today with amoxicillin prescribed; `give` units are paid (pay-first) and handed over. */
  const dispensed = async (quantity: number, give = quantity) => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Back', fatherName: 'Again', sex: 'FEMALE' }).expect(201)).body;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const rx = (
      await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: amoxId, dose: '1 capsule', frequency: 'TID', durationDays: 5, quantity }] }).expect(201)
    ).body;
    const itemId = rx.items[0].id as string;
    let invoiceId: string | undefined;
    if (prepay) {
      await api.post(`/prescriptions/${rx.id}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity }] }).expect(201);
      const inv = (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId }).expect(201)).body;
      await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: Number(inv.total) }).expect(201);
      invoiceId = inv.id;
    }
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: give }] }).expect(201);
    return { patientId: p.id as string, visitId, rxId: rx.id as string, itemId, invoiceId };
  };
  const giveBack = (itemId: string, body: { quantity: number; restocked: boolean; reason?: string }, who = pharmacist) =>
    api.post(`/prescription-items/${itemId}/return`).set(bearer(who.token)).send({ reason: 'Rash after two doses', ...body });

  it('puts sealed units back on the shelf, into the batch they came from', async () => {
    const before = await stock();
    const { itemId, invoiceId } = await dispensed(15);
    expect(await stock()).toBe(before - 15);

    const res = (await giveBack(itemId, { quantity: 4, restocked: true }).expect(201)).body;
    expect(res).toMatchObject({ quantity: 4, restocked: true, unit: 'capsule' });
    expect(await stock()).toBe(before - 11);
    const move = await db.stockMovement.findFirst({ where: { reference: itemId, type: 'RETURN' } });
    expect(move).toMatchObject({ batchId, quantity: 4, reason: 'Rash after two doses' });
    expect(await item(itemId)).toMatchObject({ dispensedQty: 15, returnedQty: 4 });

    if (prepay) {
      // Paid on an invoice: an admin refunds it there.
      expect(res.refundDue).toBe(4);
      expect(res.invoices).toEqual([expect.objectContaining({ id: invoiceId })]);
      const inv = (await api.get(`/invoices/${invoiceId}`).set(bearer(admin.token)).expect(200)).body;
      const line = inv.charges.find((c: { source: string }) => c.source === 'PHARMACY');
      const remove = (quantity: number, who = admin) =>
        api.post(`/invoices/${invoiceId}/charges/${line.id}/remove`).set(bearer(who.token)).send({ reason: 'Returned unopened', method: 'CASH', quantity });
      await remove(4, pharmacist).expect(403);
      await remove(5).expect(409); // only 4 came back
      const after = (await remove(4).expect(201)).body;
      expect(Number(after.total)).toBe(55);
      expect(Number(after.payments.at(-1).amount)).toBe(-20);
      expect(await item(itemId)).toMatchObject({ returnedQty: 4, refundedQty: 4 });
      await remove(1).expect(409); // nothing more came back
    } else {
      // Not invoiced yet: the charge simply shrinks.
      expect(res.refundDue).toBe(0);
      const charges = await db.charge.findMany({ where: { sourceId: itemId, voidedAt: null } });
      expect(charges.reduce((s, c) => s + c.quantity, 0)).toBe(11);
      expect(await item(itemId)).toMatchObject({ returnedQty: 4, refundedQty: 4 });
    }
  });

  it('records opened units without restocking them, and never more than the patient holds', async () => {
    const before = await stock();
    const { itemId } = await dispensed(6);
    await giveBack(itemId, { quantity: 7, restocked: false }).expect(409);
    await giveBack(itemId, { quantity: 2, restocked: false, reason: '' }).expect(400);
    const res = (await giveBack(itemId, { quantity: 2, restocked: false }).expect(201)).body;
    expect(res.restocked).toBe(false);
    expect(await stock()).toBe(before - 6);
    const record = await db.drugReturn.findFirst({ where: { prescriptionItemId: itemId } });
    expect(record).toMatchObject({ tenantId, quantity: 2, restocked: false, userId: pharmacist.id });
    await giveBack(itemId, { quantity: 5, restocked: true }).expect(409); // 4 left with the patient
    await giveBack(itemId, { quantity: 4, restocked: true }, cashier).expect(403);

    const q = (await api.get('/pharmacy/queue').set(bearer(pharmacist.token)).expect(200)).body;
    expect(q.returnsToday.some((r: { prescriptionItemId: string }) => r.prescriptionItemId === itemId)).toBe(true);
  });

  it('still lets the patient collect the rest of a paid prescription after a refunded return', async () => {
    if (!prepay) return;
    const { itemId, rxId, invoiceId } = await dispensed(10, 5);
    await giveBack(itemId, { quantity: 2, restocked: true }).expect(201);
    const inv = (await api.get(`/invoices/${invoiceId}`).set(bearer(admin.token)).expect(200)).body;
    const line = inv.charges.find((c: { source: string }) => c.source === 'PHARMACY');
    await api.post(`/invoices/${invoiceId}/charges/${line.id}/remove`).set(bearer(admin.token)).send({ reason: 'Returned', quantity: 2 }).expect(201);
    // Paid for 8, holds 3: the remaining 5 are paid for.
    await api.post(`/prescriptions/${rxId}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 5 }] }).expect(201);
    expect(await item(itemId)).toMatchObject({ dispensedQty: 10, returnedQty: 2, refundedQty: 2 });
    // Holds 8, paid for 8: nothing more can be refunded.
    await api.post(`/invoices/${invoiceId}/charges/${line.id}/remove`).set(bearer(admin.token)).send({ reason: 'Again', quantity: 1 }).expect(409);
    const paid = (await api.get(`/invoices/${invoiceId}`).set(bearer(admin.token)).expect(200)).body;
    expect(Number(paid.paid)).toBe(40);
  });

  it('refunds returned units only once, even before the rest is collected', async () => {
    if (!prepay) return;
    const { itemId, rxId, invoiceId } = await dispensed(10, 5);
    await giveBack(itemId, { quantity: 2, restocked: true }).expect(201);
    // Returned but not refunded: not a credit toward the rest; the 5 still owed are paid for.
    await api.post(`/prescriptions/${rxId}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 5 }] }).expect(201);
    const inv = (await api.get(`/invoices/${invoiceId}`).set(bearer(admin.token)).expect(200)).body;
    const line = inv.charges.find((c: { source: string }) => c.source === 'PHARMACY');
    const remove = (quantity: number) => api.post(`/invoices/${invoiceId}/charges/${line.id}/remove`).set(bearer(admin.token)).send({ reason: 'Returned', quantity });
    await remove(3).expect(409);
    await remove(2).expect(201);
    await remove(1).expect(409);
    expect(await item(itemId)).toMatchObject({ dispensedQty: 10, returnedQty: 2, refundedQty: 2, billedQty: 10 } as object);
  });

  it('gives the label everything it prints, only to this clinic', async () => {
    const { rxId } = await dispensed(9);
    const label = (await api.get(`/prescriptions/${rxId}/label`).set(bearer(pharmacist.token)).expect(200)).body;
    expect(label.tenant.name).toMatch(/Returns Clinic/);
    expect(label.visit.patient).toMatchObject({ firstName: 'Back' });
    expect(label.dispensedBy).toBe('PHARMACIST user');
    expect(label.items[0]).toMatchObject({ dose: '1 capsule', frequency: 'TID', durationDays: 5, dispensedQty: 9, batches: ['AMX-1'] });
    expect(new Date(label.items[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
    await api.get(`/prescriptions/${rxId}/label`).set(bearer(doctor.token)).expect(200);
    await api.get(`/prescriptions/${rxId}/label`).set(bearer(cashier.token)).expect(403);

    const other = await makeClinic(`Other Clinic ${Date.now()}`);
    const outsider = await makeStaff(other.id, 'PHARMACIST');
    await api.get(`/prescriptions/${rxId}/label`).set(bearer(outsider.token)).expect(404);
  });

  it("lists a patient's medication history, newest first, with returns", async () => {
    const first = await dispensed(3);
    // A second prescription for the same patient, on a later visit.
    await db.visit.update({ where: { id: first.visitId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: first.patientId }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const again = { items: [{ drugId: amoxId, dose: '1 capsule', frequency: 'BID', quantity: 4 }] };
    // The first course (5 days) is still running: the doctor is told before prescribing it again.
    const warned = (await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send(again).expect(409)).body;
    expect(warned.alerts[0].message).toMatch(/^Amoxicillin \(taking since .+\) and Amoxicillin: the same drug twice$/);
    await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ ...again, acknowledgeAlerts: true }).expect(201);
    await giveBack(first.itemId, { quantity: 1, restocked: true }).expect(201);

    const meds = (await api.get(`/patients/${first.patientId}/medications`).set(bearer(doctor.token)).expect(200)).body;
    expect(meds).toHaveLength(2);
    expect(meds[0].visit.id).toBe(visitId);
    expect(meds[1].items[0]).toMatchObject({ dispensedQty: 3, returnedQty: 1 });
    await api.get(`/patients/${first.patientId}/medications`).set(bearer(pharmacist.token)).expect(200);
    await api.get(`/patients/${first.patientId}/medications`).set(bearer(cashier.token)).expect(403);
  });
});
