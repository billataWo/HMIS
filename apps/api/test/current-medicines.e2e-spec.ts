import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

/** New drugs are checked against what the patient is still taking from earlier visits and sales. */
describe('current medicines', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, pharmacist: Staff;
  const drugs: Record<string, string> = {};

  beforeAll(async () => {
    tenantId = (await makeClinic(`Current Meds Clinic ${Date.now()}`)).id;
    [desk, doctor, pharmacist] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'PHARMACIST')]);
    for (const [genericName, drugClass] of [['Warfarin', 'anticoagulant'], ['Ibuprofen', 'nsaid'], ['Paracetamol', 'analgesic']]) {
      const d = await db.drug.create({
        data: {
          tenantId, genericName, drugClass, form: 'tablet', unit: 'tablet', sellPrice: '1.00',
          batches: { create: { batchNo: `${genericName}-1`, expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: 500, costPrice: '0.50' } },
        },
      });
      drugs[genericName] = d.id;
    }
  });

  // A man: these tests are about current medicines, not the pregnancy reminder warfarin raises for a woman.
  const patient = async () => (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'On', fatherName: 'Warfarin', sex: 'MALE' }).expect(201)).body.id as string;
  const seen = async (patientId: string) => {
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body.id as string;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    return visitId;
  };
  const prescribe = (visitId: string, name: string, extra: object = {}) =>
    api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: drugs[name], dose: '1 tablet', frequency: 'OD', quantity: 10, ...extra }] });
  /** Warfarin given at an earlier visit, `daysAgo` days ago, for `days` days. */
  const onWarfarin = async (days: number | undefined, daysAgo = 2) => {
    const p = await patient();
    const visitId = await seen(p);
    const rx = (await prescribe(visitId, 'Warfarin', { durationDays: days }).expect(201)).body;
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 10 }] }).expect(201);
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    await db.prescription.update({ where: { id: rx.id }, data: { createdAt: at, dispensedAt: at } });
    await db.visit.update({ where: { id: visitId }, data: { status: 'COMPLETED', completedAt: at } });
    return { patientId: p, itemId: rx.items[0].id as string };
  };

  it('warns the doctor about a drug the patient is still taking from an earlier visit', async () => {
    const { patientId } = await onWarfarin(30);
    const res = await prescribe(await seen(patientId), 'Ibuprofen').expect(409);
    expect(res.body.alerts).toEqual([
      expect.objectContaining({ type: 'INTERACTION', severity: 'MAJOR', message: expect.stringMatching(/^Warfarin \(taking since \d{1,2} \w{3}\) \+ Ibuprofen: higher risk of serious bleeding$/) }),
    ]);
  });

  it('forgets a course that is over, or a drug that was brought back', async () => {
    const ended = await onWarfarin(5, 10);
    await prescribe(await seen(ended.patientId), 'Ibuprofen').expect(201);

    const returned = await onWarfarin(30);
    await api.post(`/prescription-items/${returned.itemId}/return`).set(bearer(pharmacist.token)).send({ quantity: 10, restocked: false, reason: 'Stopped by the doctor' }).expect(201);
    await prescribe(await seen(returned.patientId), 'Ibuprofen').expect(201);

    // No length given ("as directed"): current for 30 days.
    const open = await onWarfarin(undefined, 20);
    await prescribe(await seen(open.patientId), 'Ibuprofen').expect(409);
  });

  it('checks a named customer at the counter too, and lets the pharmacist go ahead after checking', async () => {
    const { patientId } = await onWarfarin(30);
    const sale = { patientId, items: [{ drugId: drugs.Ibuprofen, quantity: 10 }] };
    const res = await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send(sale).expect(409);
    expect(res.body.message).toBe('Check these alerts before selling');
    expect(res.body.alerts[0].message).toMatch(/^Warfarin \(taking since .+\) \+ Ibuprofen/);
    const ok = (await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ ...sale, acknowledgeAlerts: true }).expect(201)).body;
    expect(ok.alerts[0].type).toBe('INTERACTION');
    // An unnamed customer has no history; paracetamol alone raises nothing.
    await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ items: [{ drugId: drugs.Paracetamol, quantity: 10 }] }).expect(201);
    // Two interacting drugs in one sale are flagged even without a name.
    await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ items: [{ drugId: drugs.Warfarin, quantity: 1 }, { drugId: drugs.Ibuprofen, quantity: 1 }] }).expect(409);
  });
});
