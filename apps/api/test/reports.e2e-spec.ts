import { clinicDay } from '../src/common/clinic-day.js';
import { ethiopianMonthRange, ethiopianToJdn, gregorianToJdn, jdnToEthiopian, jdnToGregorian, toEthiopian } from '../src/common/ethiopian-calendar.js';
import { ageAt, ageGroup } from '../src/reports/reports.controller.js';
import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

describe('Ethiopian calendar', () => {
  it('converts known dates both ways', () => {
    expect(toEthiopian('2026-09-11')).toEqual({ year: 2019, month: 1, day: 1 }); // Enkutatash 2019
    expect(toEthiopian('2023-09-12')).toEqual({ year: 2016, month: 1, day: 1 }); // after leap year 2015
    expect(toEthiopian('2026-11-05')).toEqual({ year: 2019, month: 2, day: 26 });
    expect(jdnToGregorian(ethiopianToJdn(2019, 1, 1))).toEqual({ year: 2026, month: 9, day: 11 });
  });

  it('round-trips every day for six years', () => {
    const start = gregorianToJdn(2022, 1, 1);
    for (let j = start; j < start + 6 * 366; j++) {
      const e = jdnToEthiopian(j);
      expect(ethiopianToJdn(e.year, e.month, e.day)).toBe(j);
    }
  });

  it('gives month boundaries, including a 6-day Pagume in a leap year', () => {
    expect(ethiopianMonthRange(2019, 2)).toEqual({ startDay: '2026-10-11', endDay: '2026-11-10' });
    expect(ethiopianMonthRange(2015, 13)).toEqual({ startDay: '2023-09-06', endDay: '2023-09-12' });
    expect(ethiopianMonthRange(2018, 13)).toEqual({ startDay: '2026-09-06', endDay: '2026-09-11' });
  });
});

describe('age groups', () => {
  it('uses age on the visit date', () => {
    const visit = new Date('2026-11-05T09:00:00Z');
    expect(ageGroup(ageAt(new Date('2026-03-01'), visit))).toBe('<1');
    expect(ageGroup(ageAt(new Date('2021-11-06'), visit))).toBe('1-4'); // turns 5 tomorrow
    expect(ageGroup(ageAt(new Date('1960-01-01'), visit))).toBe('65+');
    expect(ageGroup(ageAt(null, visit))).toBe('unknown');
  });
});

describe('dashboard and MoH report', () => {
  let tenantId: string;
  let admin: Staff, desk: Staff, doctor: Staff, cashier: Staff, tech: Staff, pharmacist: Staff;
  const today = clinicDay();

  const register = async (body: object) => (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, ...body }).expect(201)).body.id as string;
  const visit = async (patientId: string, fee: string) => (await api.post('/visits').set(bearer(desk.token)).send({ patientId, serviceId: fee }).expect(201)).body.id as string;
  const call = (id: string, status: string) => api.patch(`/visits/${id}/status`).set(bearer(doctor.token)).send({ status }).expect(200);

  beforeAll(async () => {
    tenantId = (await makeClinic('Reports Clinic')).id;
    [admin, desk, doctor, cashier, tech, pharmacist] = await Promise.all(
      (['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'CASHIER', 'LAB_TECH', 'PHARMACIST'] as const).map((r) => makeStaff(tenantId, r)),
    );
    const fee = (await db.serviceItem.create({ data: { tenantId, code: 'CONS', name: 'Consultation', price: '150.00' } })).id;
    const film = (await db.labTest.create({ data: { tenantId, name: 'Malaria blood film', price: '60.00', resultOptions: ['Negative', 'P. falciparum'] } })).id;
    const drug = await db.drug.create({
      data: {
        tenantId, genericName: 'Artemether/Lumefantrine', form: 'tablet', unit: 'tablet', sellPrice: '9.00',
        batches: { create: { batchNo: 'AL1', expiryDate: new Date(Date.now() + 300 * 86_400_000), quantity: 100, costPrice: '5.00' } },
      },
    });

    // A child with malaria: diagnosed, tested positive, treated, billed and paid.
    const child = await register({ firstName: 'Kid', fatherName: 'A', sex: 'MALE', ageYears: 3 });
    const v1 = await visit(child, fee);
    await call(v1, 'IN_CONSULTATION');
    await api.post(`/visits/${v1}/diagnoses`).set(bearer(doctor.token)).send({ icd11Code: '1F40', label: 'Malaria due to Plasmodium falciparum' }).expect(201);
    const [order] = (await api.post(`/visits/${v1}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [film] }).expect(201)).body;
    await api.post(`/lab-orders/${order.id}/collect`).set(bearer(tech.token)).send({}).expect(201);
    await api.post(`/lab-orders/${order.id}/result`).set(bearer(tech.token)).send({ value: 'P. falciparum' }).expect(201);
    await api.post(`/lab-orders/${order.id}/verify`).set(bearer(tech.token)).send({}).expect(201);
    const rx = (await api.post(`/visits/${v1}/prescriptions`).set(bearer(doctor.token)).send({ items: [{ drugId: drug.id, dose: '4 tabs', frequency: 'BID', quantity: 24 }] }).expect(201)).body;
    await api.post(`/prescriptions/${rx.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [{ itemId: rx.items[0].id, quantity: 24 }] }).expect(201);
    await call(v1, 'COMPLETED');
    const inv = (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId: v1 }).expect(201)).body; // 150 + 60 + 216 = 426
    await api.post(`/invoices/${inv.id}/payments`).set(bearer(cashier.token)).send({ method: 'TELEBIRR', amount: 426, reference: `R-${Date.now()}` }).expect(201);

    // A returning adult: seen 40 days ago, back today with hypertension, not billed yet.
    const adult = await register({ firstName: 'Mom', fatherName: 'B', sex: 'FEMALE', ageYears: 40 });
    await db.visit.create({ data: { tenantId, patientId: adult, queueNumber: 99, status: 'COMPLETED', checkedInAt: new Date(Date.now() - 40 * 86_400_000) } });
    const v2 = await visit(adult, fee);
    await call(v2, 'IN_CONSULTATION');
    await api.post(`/visits/${v2}/diagnoses`).set(bearer(doctor.token)).send({ icd11Code: 'BA00', label: 'Essential hypertension' }).expect(201);

    // Some stock lost to damage.
    const batch = await db.stockBatch.findFirstOrThrow({ where: { drugId: drug.id } });
    await api.post('/inventory/adjustments').set(bearer(pharmacist.token)).send({ batchId: batch.id, quantity: -2, reason: 'DAMAGED' }).expect(201);
  });

  it("shows today's numbers on the dashboard", async () => {
    const d = (await api.get('/reports/dashboard').set(bearer(admin.token)).expect(200)).body;
    expect(d.patients).toEqual(expect.objectContaining({ visits: 2, completed: 1, newPatients: 2 }));
    expect(d.revenue).toEqual(expect.objectContaining({ collected: '426.00', billed: '426.00', unbilled: '150.00', unbilledCount: 1 }));
    expect(d.revenue.byMethod).toEqual({ TELEBIRR: '426.00' });
    expect(d.topDiagnoses.map((x: { code: string }) => x.code).sort()).toEqual(['1F40', 'BA00']);
    expect(d.lab).toEqual(expect.objectContaining({ ordered: 1, verified: 1 }));
    expect(d.pharmacy).toEqual(expect.objectContaining({ sales: '216.00', unitsDispensed: 24 }));
    expect(d.pharmacy.topDrugs).toEqual([{ name: 'Artemether/Lumefantrine', units: 24 }]);
    expect(d.stock).toEqual(expect.objectContaining({ value: '370.00', adjustmentLoss: '10.00' })); // 74 left × 5.00
    expect(d.daily).toEqual([{ day: today, visits: 2, newPatients: 2, collected: '426.00', billed: '426.00', avgWaitMinutes: expect.any(Number) }]);
  });

  it('adds the comparison, the spread of waits, arrivals, who came and what each department delivered', async () => {
    const d = (await api.get('/reports/dashboard').set(bearer(admin.token)).expect(200)).body;
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(d.previous).toEqual(expect.objectContaining({ from: yesterday.toISOString().slice(0, 10), to: yesterday.toISOString().slice(0, 10), visits: 0, collected: '0.00' }));
    expect(d.patients.seen).toBe(2);
    expect(d.patients.waitBands.reduce((a: number, b: number) => a + b, 0)).toBe(2);
    expect(d.patients.arrivals.flat().reduce((a: number, b: number) => a + b, 0)).toBe(2);
    const row = (g: string) => d.patients.bySexAge.find((x: { ageGroup: string }) => x.ageGroup === g);
    expect(row('1-4')).toEqual({ ageGroup: '1-4', male: 1, female: 0 });
    expect(row('30-64')).toEqual({ ageGroup: '30-64', male: 0, female: 1 });
    const source = (s: string) => d.revenue.bySource.find((x: { source: string }) => x.source === s)?.amount;
    expect([source('CONSULTATION'), source('LAB'), source('PHARMACY')]).toEqual(['300.00', '60.00', '216.00']);
    // Right now: the adult is with the doctor and not billed yet.
    expect(d.now).toEqual(expect.objectContaining({ waiting: 0, inConsultation: 1, visitsToBill: 1, longestWaitMinutes: null }));
  });

  it('compares with the period before, and leaves out "right now" for a past period', async () => {
    const back = (n: number) => {
      const x = new Date(`${today}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() - n);
      return x.toISOString().slice(0, 10);
    };
    // 30 days ending yesterday: the period before holds the visit 40 days ago.
    const d = (await api.get('/reports/dashboard').query({ from: back(30), to: back(1) }).set(bearer(admin.token)).expect(200)).body;
    expect(d.now).toBeNull();
    expect(d.patients.visits).toBe(0);
    expect(d.previous).toEqual(expect.objectContaining({ from: back(60), to: back(31), visits: 1, completed: 1 }));
    expect(d.daily).toHaveLength(30);
    expect(d.previous.daily.visits).toHaveLength(30);
    expect(d.previous.daily.visits.reduce((a: number, b: number) => a + b, 0)).toBe(1);
  });

  it('validates the range and is admin-only', async () => {
    await api.get('/reports/dashboard').query({ from: '2026-02-01', to: '2026-01-01' }).set(bearer(admin.token)).expect(400);
    await api.get('/reports/dashboard').query({ from: '2024-01-01', to: '2026-01-01' }).set(bearer(admin.token)).expect(400);
    await api.get('/reports/dashboard').set(bearer(cashier.token)).expect(403);
    await api.get('/reports/moh-monthly').set(bearer(doctor.token)).expect(403);
  });

  it('runs every report in the library for the period', async () => {
    const keys = ['payments', 'revenue-by-service', 'invoices', 'discounts', 'debtors', 'opd-register', 'morbidity', 'lab-register', 'referrals', 'stock-on-hand', 'expiry', 'dispensing', 'stock-losses', 'staff-activity', 'appointments', 'cancelled-visits'];
    const run = async (key: string, extra: object = {}) => (await api.get(`/reports/library/${key}`).query({ from: today, to: today, ...extra }).set(bearer(admin.token)).expect(200)).body;
    for (const key of keys) expect(Array.isArray((await run(key)).rows)).toBe(true);

    const pay = await run('payments');
    expect(pay.rows).toEqual([expect.objectContaining({ kind: 'PAYMENT', method: 'TELEBIRR', amount: '426.00', mrn: expect.any(String) })]);
    expect(pay.totals).toEqual({ amount: '426.00' });
    expect((await run('payments', { method: 'CASH' })).rows).toEqual([]);

    const opd = await run('opd-register');
    expect(opd.rows.map((r: { visitType: string }) => r.visitType).sort()).toEqual(['NEW', 'REPEAT']);
    const rev = await run('revenue-by-service');
    expect(rev.totals).toEqual(expect.objectContaining({ amount: '576.00', billed: '426.00', notBilled: '150.00' }));
    const lab = await run('lab-register');
    expect(lab.rows).toEqual([expect.objectContaining({ test: 'Malaria blood film', result: 'P. falciparum', status: 'VERIFIED' })]);
    const stock = await run('stock-on-hand');
    expect(stock.asOfNow).toBe(true);
    expect(stock.rows).toEqual([expect.objectContaining({ onHand: 74, status: 'OK', value: '370.00' })]);
    expect((await run('dispensing')).rows).toEqual([expect.objectContaining({ units: 24, cost: '120.00', value: '216.00', margin: '96.00' })]);
    expect((await run('stock-losses')).rows).toEqual([expect.objectContaining({ type: 'ADJUSTMENT', quantity: 2, value: '10.00' })]);
    const morbidity = await run('morbidity');
    expect(morbidity.totals).toEqual(expect.objectContaining({ male: 1, female: 1, total: 2 }));
    const debtors = await run('debtors');
    expect(debtors.rows).toEqual([]); // the adult's visit is not invoiced yet: nothing owed on an invoice
    const staffRows = (await run('staff-activity')).rows;
    expect(staffRows).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'CASHIER', paymentsTaken: 1, collected: '426.00' }), expect.objectContaining({ role: 'DOCTOR', patientsSeen: 2 })]));
  });

  it('records exports in the audit log, and guards the library', async () => {
    await api.get('/reports/library/opd-register/export').query({ from: today, to: today }).set(bearer(admin.token)).expect(200);
    const entry = await db.auditLog.findFirst({ where: { tenantId, action: 'report.exported' }, orderBy: { createdAt: 'desc' } });
    expect(entry).toEqual(expect.objectContaining({ entity: 'Report', entityId: 'opd-register', data: expect.objectContaining({ rows: 2 }) }));
    await api.get('/reports/library/payments').query({ from: today, to: today }).set(bearer(cashier.token)).expect(403);
    await api.get('/reports/library/nope').query({ from: today, to: today }).set(bearer(admin.token)).expect(404);
    await api.get('/reports/library/payments').query({ from: '2026-02-30', to: today }).set(bearer(admin.token)).expect(400);
    await api.get('/reports/library/payments').query({ from: '2024-01-01', to: today }).set(bearer(admin.token)).expect(400);
  });

  it('builds the monthly MoH report for the current Ethiopian month', async () => {
    const r = (await api.get('/reports/moh-monthly').set(bearer(admin.token)).expect(200)).body;
    const ec = toEthiopian(today);
    expect([r.period.ecYear, r.period.ecMonth]).toEqual([ec.year, ec.month]);
    expect(r.facility.name).toBe('Reports Clinic');
    // The 40-day-old visit is in an earlier month, so this month has 2 visits: the child (new) and the adult (repeat).
    expect(r.opd).toEqual(expect.objectContaining({ total: 2, male: 1, female: 1, newVisits: 1, repeatVisits: 1, withoutDiagnosis: 0 }));
    const row = (g: string) => r.opd.byAge.find((x: { ageGroup: string }) => x.ageGroup === g);
    expect(row('1-4')).toEqual({ ageGroup: '1-4', male: 1, female: 0 });
    expect(row('30-64')).toEqual({ ageGroup: '30-64', male: 0, female: 1 });
    expect(r.morbidity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '1F40', male: 1, female: 0, total: 1 }),
        expect.objectContaining({ code: 'BA00', male: 0, female: 1, total: 1 }),
      ]),
    );
    expect(r.malaria).toEqual({ tested: 1, positive: 1, byResult: [{ result: 'P. falciparum', count: 1 }] });
  });

  it('reports an earlier month on request', async () => {
    const ec = toEthiopian(today);
    const prev = ec.month === 1 ? { y: ec.year - 1, m: 13 } : { y: ec.year, m: ec.month - 1 };
    const r = (await api.get('/reports/moh-monthly').query({ ecYear: prev.y, ecMonth: prev.m }).set(bearer(admin.token)).expect(200)).body;
    expect(r.period.endDay <= today).toBe(true);
    expect(r.malaria.tested).toBe(0);
  });
});
