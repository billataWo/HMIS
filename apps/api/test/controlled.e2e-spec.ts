import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
type Line = { type: string; in: number; out: number; balance: number; by: string | null; supplier: string | null; reference: string | null; reason: string | null; patient: { mrn: string } | null; prescriber: string | null };

/** Narcotics and psychotropics: the register, no counter sales, and a ledger that can't be rewritten. */
describe('controlled drugs', () => {
  let tenantId: string;
  let desk: Staff, doctor: Staff, pharmacist: Staff;
  let tramadolId: string, paraId: string, batchId: string;
  const day = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date(Date.now() + offset * 86_400_000));

  beforeAll(async () => {
    tenantId = (await makeClinic(`Controlled Clinic ${Date.now()}`)).id;
    [desk, doctor, pharmacist] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'PHARMACIST')]);
    tramadolId = (
      await api
        .post('/drugs')
        .set(bearer(pharmacist.token))
        .send({ genericName: 'Tramadol', strength: '50 mg', form: 'capsule', unit: 'capsule', drugClass: 'opioid', sellPrice: 3, controlled: 'NARCOTIC' })
        .expect(201)
    ).body.id;
    paraId = (await api.post('/drugs').set(bearer(pharmacist.token)).send({ genericName: 'Paracetamol', strength: '500 mg', form: 'tablet', unit: 'tablet', sellPrice: 1 }).expect(201)).body.id;
    const supplier = (await api.post('/suppliers').set(bearer(pharmacist.token)).send({ name: `EPSA ${Date.now()}` }).expect(201)).body;
    await api
      .post('/inventory/receipts')
      .set(bearer(pharmacist.token))
      .send({
        supplierId: supplier.id,
        receiptRef: 'DN-7731',
        items: [
          { drugId: tramadolId, batchNo: 'TRM-1', expiryDate: `${Number(day().slice(0, 4)) + 2}-01-31`, quantity: 100, costPrice: 1.2 },
          { drugId: paraId, batchNo: 'PCM-1', expiryDate: `${Number(day().slice(0, 4)) + 2}-01-31`, quantity: 100, costPrice: 0.5 },
        ],
      })
      .expect(201);
    batchId = (await db.stockBatch.findFirstOrThrow({ where: { drugId: tramadolId } })).id;
  });

  it('keeps every unit in the register with a running balance, the patient and the prescriber', async () => {
    const p = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Pain', fatherName: 'Relief', sex: 'MALE' }).expect(201)).body;
    const visitId = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body.id;
    await api.patch(`/visits/${visitId}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    const rx = (await api.post(`/visits/${visitId}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: tramadolId, dose: '50 mg', frequency: 'BID', durationDays: 5, quantity: 10 }] }).expect(201)).body;
    const itemId = rx.items[0].id;
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId, quantity: 10 }] }).expect(201);
    await api.post(`/prescription-items/${itemId}/return`).set(bearer(pharmacist.token)).send({ quantity: 2, restocked: true, reason: 'Pain settled' }).expect(201);
    await api.post('/inventory/adjustments').set(bearer(pharmacist.token)).send({ batchId, quantity: -1, reason: 'DAMAGED', note: 'Capsule crushed' }).expect(201);

    const reg = (await api.get('/controlled-register').set(bearer(pharmacist.token)).expect(200)).body;
    expect(reg.drugs).toHaveLength(1); // paracetamol is not controlled
    const t = reg.drugs[0];
    expect(t).toMatchObject({ genericName: 'Tramadol', controlled: 'NARCOTIC', opening: 0, received: 102, issued: 11, closing: 91 });
    const lines = t.lines as Line[];
    expect(lines.map((l) => [l.type, l.in, l.out, l.balance])).toEqual([
      ['RECEIPT', 100, 0, 100],
      ['DISPENSE', 0, 10, 90],
      ['RETURN', 2, 0, 92],
      ['ADJUSTMENT', 0, 1, 91],
    ]);
    expect(lines[0]).toMatchObject({ supplier: expect.stringMatching(/^EPSA/), reference: 'DN-7731', by: 'PHARMACIST user' });
    expect(lines[1]).toMatchObject({ patient: { mrn: p.mrn }, prescriber: 'DOCTOR user' });
    expect(lines[2]).toMatchObject({ patient: { mrn: p.mrn }, reason: 'Pain settled' });
    expect(lines[3].reason).toMatch(/DAMAGED|Capsule crushed/);
    expect(await db.stockBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({ quantity: 91 });
  });

  it('carries the balance across periods', async () => {
    const before = (await api.get(`/controlled-register?from=${day(-3)}&to=${day(-1)}`).set(bearer(pharmacist.token)).expect(200)).body.drugs[0];
    expect(before).toMatchObject({ opening: 0, closing: 0, lines: [] });
    const later = (await api.get(`/controlled-register?from=${day(1)}&to=${day(2)}`).set(bearer(pharmacist.token)).expect(200)).body.drugs[0];
    expect(later).toMatchObject({ opening: 91, closing: 91, lines: [] });
    await api.get(`/controlled-register?from=${day(1)}&to=${day(-1)}`).set(bearer(pharmacist.token)).expect(400);
    await api.get('/controlled-register?from=2024-01-01&to=2026-06-01').set(bearer(pharmacist.token)).expect(400);
    await api.get('/controlled-register').set(bearer(doctor.token)).expect(403);
  });

  it('never sells a controlled drug over the counter', async () => {
    const res = await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ items: [{ drugId: tramadolId, quantity: 5 }] }).expect(409);
    expect(res.body.message).toMatch(/Tramadol is a controlled drug: dispense only on a doctor's prescription/);
    await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ items: [{ drugId: paraId, quantity: 5 }] }).expect(201);
  });

  it('keeps the stock ledger permanent: no change or deletion, even straight in the database', async () => {
    const move = await db.stockMovement.findFirstOrThrow({ where: { batchId } });
    await expect(db.stockMovement.update({ where: { id: move.id }, data: { quantity: 1 } })).rejects.toThrow(/permanent record/);
    await expect(db.stockMovement.delete({ where: { id: move.id } })).rejects.toThrow(/permanent record/);
    expect(await db.stockMovement.count({ where: { batchId } })).toBe(4);
  });

  it('marks the starter-list narcotics and psychotropics', async () => {
    const list = (await api.get('/drugs/starter').set(bearer(pharmacist.token)).expect(200)).body as { genericName: string; controlled?: string }[];
    expect(list.find((d) => d.genericName === 'Tramadol')?.controlled).toBe('NARCOTIC');
    expect(list.find((d) => d.genericName === 'Diazepam')?.controlled).toBe('PSYCHOTROPIC');
  });
});
