import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

const DAY = 86_400_000;
/** The clinic's day (Addis Ababa) shifted by whole days. */
const clinicDay = (by = 0) => new Date(Date.now() + 3 * 3_600_000 + by * DAY).toISOString().slice(0, 10);
const yearsLater = (day: string, n: number) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;

/** Family planning: methods given, resupplied, removed and stopped; the due list; the monthly tally. */
describe('family planning', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, doctor: Staff, cashier: Staff;

  beforeAll(async () => {
    tenantId = (await makeClinic(`FP Clinic ${Date.now()}`)).id;
    [desk, nurse, doctor, cashier] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'NURSE'), makeStaff(tenantId, 'DOCTOR'), makeStaff(tenantId, 'CASHIER')]);
  });

  const client = async (ageYears = 27, sex = 'FEMALE') =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Client', fatherName: `Fp${Date.now() % 100000}`, sex, ageYears, phone: '0911444555' }).expect(201)).body.id as string;
  const give = (id: string, body: object, who = nurse) => api.post(`/patients/${id}/family-planning`).set(bearer(who.token)).send(body);
  const record = async (id: string) => (await api.get(`/patients/${id}/family-planning`).set(bearer(desk.token)).expect(200)).body;

  it('starts a method, resupplies it, switches, and works out when she is next due', async () => {
    const id = await client();
    await give(id, { method: 'COC', quantity: 3 }, desk).expect(403);
    await give(id, { method: 'COC' }).expect(409); // how many cycles
    await give(id, { method: 'COC', quantity: 20 }).expect(409); // at most 13
    await give(id, { method: 'VASECTOMY' }).expect(409); // for men
    await give(id, { method: 'COC', quantity: 3, givenOn: clinicDay(1) }).expect(409); // future

    const first = (await give(id, { method: 'COC', quantity: 3, givenOn: clinicDay(-90) }).expect(201)).body;
    expect(first).toMatchObject({ service: 'START', clientType: 'NEW', quantity: 3, nextDueOn: clinicDay(-90 + 84) });
    const again = (await give(id, { method: 'COC', quantity: 1, clientType: 'NEW', givenOn: clinicDay(-6) }).expect(201)).body;
    expect(again).toMatchObject({ service: 'RESUPPLY', clientType: 'REPEAT', nextDueOn: clinicDay(22) }); // a repeat once served here

    const shot = (await give(id, { method: 'DMPA_IM' }).expect(201)).body; // switching: a start, still a repeat acceptor
    expect(shot).toMatchObject({ service: 'START', clientType: 'REPEAT', quantity: null, nextDueOn: clinicDay(91) });
    const r = await record(id);
    expect(r.current).toMatchObject({ method: 'DMPA_IM', since: clinicDay(), nextDueOn: clinicDay(91), device: false, late: false });
    expect(r.servedBefore).toBe(true);
    expect(r.records).toHaveLength(3);
  });

  it('keeps a device until it is removed, allows condoms alongside, and flags an early removal', async () => {
    const id = await client(31);
    const implant = (await give(id, { method: 'IMPLANT_5Y', clientType: 'REPEAT', givenOn: clinicDay(-400) }).expect(201)).body;
    expect(implant).toMatchObject({ service: 'START', clientType: 'REPEAT', nextDueOn: yearsLater(clinicDay(-400), 5) });
    expect((await give(id, { method: 'COC', quantity: 1 }).expect(409)).body.message).toMatch(/record its removal first/);
    await give(id, { method: 'IMPLANT_5Y' }).expect(409);
    // Condoms for dual protection don't replace the implant.
    expect((await give(id, { method: 'CONDOM_MALE', quantity: 24 }).expect(201)).body).toMatchObject({ service: 'START', nextDueOn: null });
    expect((await record(id)).current).toMatchObject({ method: 'IMPLANT_5Y', device: true, removalDue: false });

    const stop = (body: object) => api.post(`/patients/${id}/family-planning/stop`).set(bearer(nurse.token)).send(body);
    await stop({ reason: 'SIDE_EFFECTS' }).expect(409); // a device is removed, not stopped
    const remove = (body: object, who = nurse) => api.post(`/patients/${id}/family-planning/removal`).set(bearer(who.token)).send(body);
    await remove({ reason: 'SIDE_EFFECTS' }, desk).expect(403);
    await remove({ reason: 'NOT_A_REASON' }).expect(400);
    await remove({ reason: 'WANTS_PREGNANCY', givenOn: clinicDay(-500) }).expect(409); // before it went in
    const out = (await remove({ reason: 'WANTS_PREGNANCY' }).expect(201)).body;
    expect(out).toMatchObject({ service: 'REMOVAL', method: 'IMPLANT_5Y', early: true });
    expect((await record(id)).current).toBeNull();
    await remove({ reason: 'DUE' }).expect(409); // nothing left to remove
    // Now pills can start.
    expect((await give(id, { method: 'POP', quantity: 2 }).expect(201)).body.service).toBe('START');
  });

  it('stops a method, refuses during a pregnancy followed here, and voids mistakes', async () => {
    const id = await client(24);
    await give(id, { method: 'DMPA_SC' }).expect(201);
    const stop = (body: object) => api.post(`/patients/${id}/family-planning/stop`).set(bearer(nurse.token)).send(body);
    await stop({ reason: 'MENOPAUSE', givenOn: clinicDay(1) }).expect(409);
    await stop({ reason: 'WANTS_PREGNANCY' }).expect(201);
    expect((await record(id)).current).toBeNull();
    await stop({ reason: 'OTHER' }).expect(409); // no current method

    await api.post(`/patients/${id}/pregnancies`).set(bearer(nurse.token)).send({ lmp: clinicDay(-60), gravida: 1, para: 0 }).expect(201);
    expect((await give(id, { method: 'COC', quantity: 1 }).expect(409)).body.message).toMatch(/antenatal care/);
    await give(id, { method: 'CONDOM_FEMALE', quantity: 10 }).expect(201); // condoms excepted

    // A mistaken entry is voided; her current method is worked out again without it.
    const other = await client(29);
    const wrong = (await give(other, { method: 'IUCD', clientType: 'NEW' }).expect(201)).body;
    const voidIt = (body: object, who = nurse) => api.post(`/fp-records/${wrong.id}/void`).set(bearer(who.token)).send(body);
    await voidIt({ reason: 'x' }).expect(400);
    await voidIt({ reason: 'Wrong client' }, desk).expect(403);
    await voidIt({ reason: 'Wrong client' }).expect(201);
    await voidIt({ reason: 'Again' }).expect(409);
    const after = await record(other);
    expect([after.current, after.servedBefore, after.records[0].voidReason]).toEqual([null, false, 'Wrong client']);
    expect((await give(other, { method: 'COC', quantity: 1, clientType: 'NEW' }).expect(201)).body.clientType).toBe('NEW');
  });

  it('records men’s methods and refuses children', async () => {
    const man = await client(40, 'MALE');
    await give(man, { method: 'COC', quantity: 1 }).expect(409);
    expect((await give(man, { method: 'VASECTOMY', clientType: 'NEW' }).expect(201)).body).toMatchObject({ service: 'START', nextDueOn: null });
    await give(man, { method: 'VASECTOMY' }).expect(409); // already recorded
    const child = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Girl', fatherName: 'Young', sex: 'FEMALE', ageYears: 8 }).expect(201)).body.id;
    await give(child, { method: 'CONDOM_FEMALE', quantity: 5 }).expect(409);
  });

  it('lists clients due back: late resupplies first, devices due out within a month', async () => {
    const late = await client(22);
    await give(late, { method: 'DMPA_IM', clientType: 'NEW', givenOn: clinicDay(-120) }).expect(201); // due 29 days ago
    const soon = await client(26);
    await give(soon, { method: 'COC', quantity: 1, clientType: 'NEW', givenOn: clinicDay(-25) }).expect(201); // due in 3 days
    const device = await client(35);
    await give(device, { method: 'IMPLANT_3Y', clientType: 'REPEAT', givenOn: `${Number(clinicDay(10).slice(0, 4)) - 3}${clinicDay(10).slice(4)}` }).expect(201); // out in 10 days
    const fine = await client(28);
    await give(fine, { method: 'COC', quantity: 3, clientType: 'NEW' }).expect(201); // due in 84 days

    const due = (await api.get('/family-planning/due').set(bearer(desk.token)).expect(200)).body as { patient: { id: string }; method: string; late: boolean; removal: boolean; daysLate: number }[];
    const ids = due.map((d) => d.patient.id);
    expect(ids.indexOf(late)).toBe(0);
    expect(due[0]).toMatchObject({ method: 'DMPA_IM', late: true, removal: false, daysLate: 29 });
    expect(due.find((d) => d.patient.id === soon)).toMatchObject({ late: false, removal: false });
    expect(due.find((d) => d.patient.id === device)).toMatchObject({ method: 'IMPLANT_3Y', removal: true, late: false });
    expect(ids).not.toContain(fine);
    await api.get('/family-planning/due').set(bearer(cashier.token)).expect(403);
  });

  it('counts the month for the MoH report: acceptors by method and age, removals, CYP', async () => {
    const clinic = (await makeClinic(`FP Tally ${Date.now()}`)).id;
    const [n, d] = await Promise.all([makeStaff(clinic, 'NURSE'), makeStaff(clinic, 'RECEPTIONIST')]);
    const person = async (ageYears: number, sex = 'FEMALE') =>
      (await api.post('/patients').set(bearer(d.token)).send({ confirmDuplicate: true, firstName: 'Tally', fatherName: `T${Math.random()}`.slice(0, 8), sex, ageYears }).expect(201)).body.id;
    const g = (id: string, body: object) => api.post(`/patients/${id}/family-planning`).set(bearer(n.token)).send(body).expect(201);
    const teen = await person(17);
    await g(teen, { method: 'COC', quantity: 3, clientType: 'NEW' }); // 0.2 CYP
    await g(teen, { method: 'COC', quantity: 3 }); // repeat, 0.2
    const woman = await person(30);
    await g(woman, { method: 'IUCD', clientType: 'REPEAT' }); // 4.6
    await api.post(`/patients/${woman}/family-planning/removal`).set(bearer(n.token)).send({ reason: 'SIDE_EFFECTS' }).expect(201);
    const man = await person(35, 'MALE');
    await g(man, { method: 'CONDOM_MALE', quantity: 120, clientType: 'NEW' }); // 1

    const r = (await api.get('/reports/moh-monthly').set(bearer((await makeStaff(clinic, 'ADMIN')).token)).expect(200)).body;
    expect(r.familyPlanning).toMatchObject({ acceptorsNew: 2, acceptorsRepeat: 2, removals: 1, earlyRemovals: 1, cyp: 6 });
    expect(r.familyPlanning.byMethod).toEqual([
      { method: 'COC', label: 'Combined pills (COC)', new: 1, repeat: 1 },
      { method: 'IUCD', label: 'IUCD (copper T)', new: 0, repeat: 1 },
      { method: 'CONDOM_MALE', label: 'Male condoms', new: 1, repeat: 0 },
    ]);
    expect(r.familyPlanning.byAge).toEqual([
      { ageGroup: '15-19', new: 1, repeat: 1 },
      { ageGroup: '25-49', new: 1, repeat: 1 },
    ]);
  });

  it('keeps each clinic’s records to itself', async () => {
    const id = await client();
    const other = await makeStaff((await makeClinic(`Other FP ${Date.now()}`)).id, 'NURSE');
    await api.get(`/patients/${id}/family-planning`).set(bearer(other.token)).expect(404);
    await api.post(`/patients/${id}/family-planning`).set(bearer(other.token)).send({ method: 'COC', quantity: 1 }).expect(404);
    expect(await db.fpRecord.count({ where: { patientId: id } })).toBe(0);
    await api.get(`/patients/${id}/family-planning`).set(bearer(doctor.token)).expect(200);
  });
});
