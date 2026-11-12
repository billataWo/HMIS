import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** The pharmacist gives another brand of the same drug when the prescribed one is out of stock. */
describe('brand substitution', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, pharmacist: Staff, cashier: Staff;
  let amoxil: string, generic: string, otherBrand: string, weaker: string, tramadol: string;

  const drug = async (data: { genericName: string; strength: string; brandName?: string; stock?: number; controlled?: 'NARCOTIC' }) =>
    (
      await db.drug.create({
        data: {
          tenantId, form: 'capsule', unit: 'capsule', sellPrice: '5.00', drugClass: data.controlled ? 'opioid' : 'penicillin', genericName: data.genericName, strength: data.strength,
          brandName: data.brandName, controlled: data.controlled,
          ...(data.stock && { batches: { create: { batchNo: `B-${Math.random()}`, expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: data.stock, costPrice: '2.00' } } }),
        },
      })
    ).id;

  beforeAll(async () => {
    tenantId = (await makeClinic(`Substitution Clinic ${Date.now()}`, { requirePrepayment: true })).id;
    [desk, doctor, pharmacist, cashier] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'PHARMACIST'), makeStaff(tenantId, 'CASHIER')]);
    amoxil = await drug({ genericName: 'Amoxicillin', strength: '500 mg', brandName: 'Amoxil' }); // out of stock
    generic = await drug({ genericName: 'amoxicillin', strength: '500  mg', stock: 100 });
    otherBrand = await drug({ genericName: 'Amoxicillin', strength: '500 mg', brandName: 'Moxatag' });
    weaker = await drug({ genericName: 'Amoxicillin', strength: '250 mg', stock: 100 });
    tramadol = await drug({ genericName: 'Tramadol', strength: '50 mg', stock: 50, controlled: 'NARCOTIC' });
  });

  const prescribed = async (drugId: string, allergies: string[] = []) => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Swap', fatherName: 'Brand', sex: 'MALE', allergies }).expect(201)).body;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body.id;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const rx = (
      await api
        .post(`/visits/${visitId}/prescriptions`)
        .set(bearer(doctor.token))
        .send({ items: [{ drugId, dose: '500 mg', frequency: 'TID', durationDays: 7, quantity: 21 }], acknowledgeAlerts: true, overrideReason: allergies.length ? 'Tolerated before, rash only' : undefined })
        .expect(201)
    ).body;
    return { visitId, rxId: rx.id as string, itemId: rx.items[0].id as string };
  };
  const swap = (itemId: string, drugId: string, who = pharmacist) =>
    api.post(`/prescription-items/${itemId}/substitute`).set(bearer(who.token)).send({ drugId, reason: 'Amoxil out of stock' });

  it('lists the equivalents (in stock first) and swaps, keeping what was prescribed', async () => {
    const { visitId, rxId, itemId } = await prescribed(amoxil);
    const eq = (await api.get(`/prescription-items/${itemId}/equivalents`).set(bearer(pharmacist.token)).expect(200)).body;
    expect(eq.map((d: { id: string; inStock: number }) => [d.id, d.inStock])).toEqual([[generic, 100], [otherBrand, 0]]);

    const item = (await swap(itemId, generic).expect(201)).body;
    expect(item).toMatchObject({ drugId: generic, substitutedFrom: 'Amoxicillin 500 mg capsule (Amoxil)', substitutionReason: 'Amoxil out of stock' });
    const audit = await db.auditLog.findFirst({ where: { tenantId, action: 'prescription.substitute' } });
    expect(audit?.data).toMatchObject({ from: 'Amoxicillin 500 mg capsule (Amoxil)', to: 'amoxicillin 500  mg capsule' });

    // Then billed, paid and dispensed as the generic.
    await api.post(`/prescriptions/${rxId}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 21 }] }).expect(201);
    const charge = await db.charge.findFirstOrThrow({ where: { sourceId: itemId } });
    expect(charge.description).toBe('amoxicillin 500  mg capsule');
    await api.post(`/visits/${visitId}/payments`).set(bearer(cashier.token)).send({ method: 'CASH', amount: 105 }).expect(201);
    await api.post(`/prescriptions/${rxId}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 21 }] }).expect(201);
    const meds = (await api.get(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).expect(200)).body;
    expect(meds[0].items[0]).toMatchObject({ substitutedFrom: 'Amoxicillin 500 mg capsule (Amoxil)', drug: { id: generic } });
  });

  it('only swaps for the same drug, strength and form, before anything is charged, by the pharmacy', async () => {
    const { rxId, itemId } = await prescribed(amoxil);
    expect((await swap(itemId, weaker).expect(409)).body.message).toMatch(/Only the same drug, strength and form/);
    await swap(itemId, tramadol).expect(409);
    await swap(itemId, generic, doctor).expect(403);
    await swap(itemId, generic).expect(201);
    // A second swap keeps the first record of what the doctor prescribed.
    expect((await swap(itemId, otherBrand).expect(201)).body.substitutedFrom).toBe('Amoxicillin 500 mg capsule (Amoxil)');
    await api.post(`/prescriptions/${rxId}/bill`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 5 }] }).expect(201);
    expect((await swap(itemId, generic).expect(409)).body.message).toMatch(/already been sent to the cashier/);
  });

  it("carries over an allergy the doctor already accepted", async () => {
    const { itemId } = await prescribed(amoxil, ['Penicillin']);
    await swap(itemId, generic).expect(201);
  });
});
