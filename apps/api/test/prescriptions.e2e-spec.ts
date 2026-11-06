import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp, recordDiagnosis } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

describe('prescriptions and dispensing', () => {
  let tenantId: string;
  let doctor: Staff, nurse: Staff, desk: Staff, pharmacist: Staff;
  const drug: Record<string, string> = {};
  const batch: Record<string, string> = {};

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

  async function openVisit(allergies: string[] = []) {
    const p = (
      await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Rx', fatherName: 'Patient', sex: 'MALE', allergies }).expect(201)
    ).body;
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body;
    await api.patch(`/visits/${v.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    await recordDiagnosis(v.id);
    return v.id as string;
  }

  const item = (name: string, quantity = 10) => ({ drugId: drug[name], dose: '1 tab', frequency: 'TID', durationDays: 3, quantity });
  const prescribe = (visitId: string, body: object, token = doctor.token) =>
    api.post(`/visits/${visitId}/prescriptions`).set(bearer(token)).send(body);
  const dispense = (id: string, items: { itemId: string; quantity: number }[], token = pharmacist.token) =>
    api.post(`/prescriptions/${id}/dispense`).set(bearer(token)).send({ items });

  beforeAll(async () => {
    const clinic = await makeClinic('Rx Clinic');
    tenantId = clinic.id;
    [doctor, nurse, desk, pharmacist] = await Promise.all([
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'NURSE'),
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'PHARMACIST'),
    ]);
    const defs: [string, string | null, string][] = [
      ['Amoxicillin', 'penicillin', '5.00'],
      ['Ibuprofen', 'nsaid', '2.00'],
      ['Diclofenac', 'nsaid', '3.00'],
      ['Enalapril', 'ace-inhibitor', '4.00'],
      ['Paracetamol', 'analgesic', '1.50'],
    ];
    for (const [genericName, drugClass, sellPrice] of defs) {
      drug[genericName] = (await db.drug.create({ data: { tenantId, genericName, drugClass, form: 'tablet', unit: 'tablet', sellPrice } })).id;
    }
    const mk = async (key: string, drugName: string, expiry: Date, quantity: number) => {
      batch[key] = (await db.stockBatch.create({ data: { drugId: drug[drugName], batchNo: key, expiryDate: expiry, quantity, costPrice: '1.00' } })).id;
    };
    await mk('AMX-EXPIRED', 'Amoxicillin', day(-1), 100);
    await mk('AMX-SOON', 'Amoxicillin', day(60), 5);
    await mk('AMX-LATER', 'Amoxicillin', day(300), 50);
    await mk('IBU', 'Ibuprofen', day(200), 30);
    await mk('PCM', 'Paracetamol', day(200), 8);
  });

  it('searches drugs with usable stock only (expired batches excluded)', async () => {
    const res = await api.get('/drugs').query({ q: 'amox' }).set(bearer(doctor.token)).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ genericName: 'Amoxicillin', inStock: 55 })]);
    expect((await api.get('/drugs').query({ q: 'nsaid' }).set(bearer(doctor.token)).expect(200)).body).toHaveLength(2);
    await api.get('/drugs').set(bearer(desk.token)).expect(403);
  });

  it('blocks an allergy until the doctor confirms with a reason', async () => {
    const visitId = await openVisit(['Penicillin']);
    const first = await prescribe(visitId, { items: [item('Amoxicillin')] }).expect(409);
    expect(first.body.alerts).toEqual([expect.objectContaining({ type: 'ALLERGY', severity: 'BLOCK' })]);

    await prescribe(visitId, { items: [item('Amoxicillin')], acknowledgeAlerts: true }).expect(409);
    const ok = await prescribe(visitId, { items: [item('Amoxicillin')], acknowledgeAlerts: true, overrideReason: 'Tolerated amoxicillin before; rash was viral' }).expect(201);
    expect(ok.body.overrideReason).toMatch(/viral/);
    expect(ok.body.alerts).toHaveLength(1);
  });

  it('warns about interactions and duplicates, including earlier prescriptions in the visit', async () => {
    const visitId = await openVisit();
    const first = await prescribe(visitId, { items: [item('Ibuprofen'), item('Enalapril')] }).expect(409);
    expect(first.body.alerts).toEqual([expect.objectContaining({ type: 'INTERACTION', severity: 'MODERATE' })]);
    await prescribe(visitId, { items: [item('Ibuprofen'), item('Enalapril')], acknowledgeAlerts: true }).expect(201);

    const second = await prescribe(visitId, { items: [item('Diclofenac')] }).expect(409);
    const types = second.body.alerts.map((a: { type: string }) => a.type).sort();
    expect(types).toEqual(['DUPLICATE', 'INTERACTION']); // two NSAIDs; diclofenac + enalapril
  });

  it('prescribes without friction when nothing is flagged; only doctors may prescribe', async () => {
    const visitId = await openVisit();
    const res = await prescribe(visitId, { items: [item('Paracetamol', 6)] }).expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.items[0].drug.genericName).toBe('Paracetamol');
    await prescribe(visitId, { items: [item('Paracetamol')] }, nurse.token).expect(403);
    await prescribe(visitId, { items: [] }).expect(400);
  });

  it('dispenses first-expiry-first-out, skipping expired stock, and charges the visit', async () => {
    const visitId = await openVisit();
    const rx = (await prescribe(visitId, { items: [item('Amoxicillin', 15)] }).expect(201)).body;
    const itemId = rx.items[0].id;

    const partial = await dispense(rx.id, [{ itemId, quantity: 10 }]).expect(201);
    expect(partial.body.status).toBe('PARTIALLY_DISPENSED');

    const qty = async (k: string) => (await db.stockBatch.findUniqueOrThrow({ where: { id: batch[k] } })).quantity;
    expect(await qty('AMX-EXPIRED')).toBe(100);
    expect(await qty('AMX-SOON')).toBe(0);
    expect(await qty('AMX-LATER')).toBe(45);

    const moves = await db.stockMovement.findMany({ where: { reference: itemId }, orderBy: { quantity: 'asc' } });
    expect(moves.map((m) => m.quantity).sort()).toEqual([-5, -5]);

    const charges = await db.charge.findMany({ where: { visitId, source: 'PHARMACY' } });
    expect(charges).toEqual([expect.objectContaining({ quantity: 10 })]);
    expect(charges[0].unitPrice.toString()).toBe('5');

    await dispense(rx.id, [{ itemId, quantity: 6 }]).expect(409); // only 5 remain on the prescription
    const done = await dispense(rx.id, [{ itemId, quantity: 5 }]).expect(201);
    expect(done.body.status).toBe('DISPENSED');
    expect(done.body.dispensedAt).toBeTruthy();
    await dispense(rx.id, [{ itemId, quantity: 1 }]).expect(409);
  });

  it('dispenses nothing if any item is short of stock', async () => {
    const visitId = await openVisit();
    const rx = (await prescribe(visitId, { items: [item('Ibuprofen', 5), item('Paracetamol', 20)] }).expect(201)).body;
    const [ibu, pcm] = rx.items.sort((a: { drug: { genericName: string } }, b: { drug: { genericName: string } }) => a.drug.genericName.localeCompare(b.drug.genericName));
    const before = await db.stockBatch.findUniqueOrThrow({ where: { id: batch.IBU } });

    const res = await dispense(rx.id, [
      { itemId: ibu.id, quantity: 5 },
      { itemId: pcm.id, quantity: 20 },
    ]).expect(409);
    expect(res.body.message).toMatch(/Not enough Paracetamol in stock: 8/);
    expect((await db.stockBatch.findUniqueOrThrow({ where: { id: batch.IBU } })).quantity).toBe(before.quantity);
    expect(await db.charge.count({ where: { visitId } })).toBe(0);
  });

  it('never oversells when two pharmacists dispense the last stock at once', async () => {
    const [v1, v2] = [await openVisit(), await openVisit()];
    const left = (await db.stockBatch.findUniqueOrThrow({ where: { id: batch.PCM } })).quantity; // 8
    const rx1 = (await prescribe(v1, { items: [item('Paracetamol', left)] }).expect(201)).body;
    const rx2 = (await prescribe(v2, { items: [item('Paracetamol', left)] }).expect(201)).body;
    const results = await Promise.all([
      dispense(rx1.id, [{ itemId: rx1.items[0].id, quantity: left }]),
      dispense(rx2.id, [{ itemId: rx2.items[0].id, quantity: left }]),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.stockBatch.findUniqueOrThrow({ where: { id: batch.PCM } })).quantity).toBe(0);
  });

  it('completes a visit waiting on the pharmacy once everything is dispensed', async () => {
    const visitId = await openVisit();
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'AWAITING_PHARMACY' }).expect(409); // nothing prescribed
    const rx = (await prescribe(visitId, { items: [item('Ibuprofen', 3)] }).expect(201)).body;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'AWAITING_PHARMACY' }).expect(200);

    const queue = (await api.get('/pharmacy/queue').set(bearer(pharmacist.token)).expect(200)).body;
    const entry = queue.open.find((p: { id: string }) => p.id === rx.id);
    expect(entry.visit.patient.firstName).toBe('Rx');
    expect(entry.items[0].inStock).toBeGreaterThanOrEqual(3);

    await dispense(rx.id, [{ itemId: rx.items[0].id, quantity: 3 }]).expect(201);
    expect((await db.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe('COMPLETED');
    const after = (await api.get('/pharmacy/queue').set(bearer(pharmacist.token)).expect(200)).body;
    expect(after.open.find((p: { id: string }) => p.id === rx.id)).toBeUndefined();
    expect(after.dispensedToday.find((p: { id: string }) => p.id === rx.id)).toBeTruthy();
  });

  it('lets the doctor cancel an undispensed prescription', async () => {
    const visitId = await openVisit();
    const rx = (await prescribe(visitId, { items: [item('Ibuprofen', 2)] }).expect(201)).body;
    await api.post(`/prescriptions/${rx.id}/cancel`).set(bearer(pharmacist.token)).expect(403);
    await api.post(`/prescriptions/${rx.id}/cancel`).set(bearer(doctor.token)).expect(201);
    await dispense(rx.id, [{ itemId: rx.items[0].id, quantity: 2 }]).expect(409);
    await api.post(`/prescriptions/${rx.id}/cancel`).set(bearer(doctor.token)).expect(409);
  });

  it("keeps prescriptions and stock private to the clinic", async () => {
    const other = await makeClinic('Other Rx Clinic');
    const otherPharmacist = await makeStaff(other.id, 'PHARMACIST');
    const otherDoctor = await makeStaff(other.id, 'DOCTOR');
    const visitId = await openVisit();
    const rx = (await prescribe(visitId, { items: [item('Ibuprofen', 1)] }).expect(201)).body;

    await dispense(rx.id, [{ itemId: rx.items[0].id, quantity: 1 }], otherPharmacist.token).expect(404);
    expect((await api.get('/pharmacy/queue').set(bearer(otherPharmacist.token)).expect(200)).body.open).toEqual([]);
    expect((await api.get('/drugs').query({ q: 'ibu' }).set(bearer(otherDoctor.token)).expect(200)).body).toEqual([]);
    await prescribe(visitId, { items: [item('Ibuprofen')] }, otherDoctor.token).expect(404);
  });
});
