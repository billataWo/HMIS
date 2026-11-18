import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

const DAY = 86_400_000;
/** The clinic's day (Addis Ababa) shifted by whole days, as YYYY-MM-DD. */
const clinicDay = (by = 0) => new Date(Date.now() + 3 * 3_600_000 + by * DAY).toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date(`${clinicDay()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

/** Immunization: the schedule from the birth date, doses in order, defaulters traced, the monthly tally. */
describe('immunization', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, admin: Staff;

  beforeAll(async () => {
    tenantId = (await makeClinic(`EPI Clinic ${Date.now()}`)).id;
    [desk, nurse, admin] = await Promise.all([makeStaff(tenantId, 'RECEPTIONIST'), makeStaff(tenantId, 'NURSE'), makeStaff(tenantId, 'ADMIN')]);
  });

  const child = async (dateOfBirth: string, sex = 'FEMALE') =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Baby', fatherName: `Epi${Date.now() % 100000}`, sex, dateOfBirth, phone: '0911222333' }).expect(201)).body.id as string;
  const give = (id: string, body: object, who = nurse) => api.post(`/patients/${id}/immunizations`).set(bearer(who.token)).send(body);
  const schedule = async (id: string) => (await api.get(`/patients/${id}/immunizations`).set(bearer(desk.token)).expect(200)).body;

  it('records doses in order, not too early, once each; card entries as written; mistakes voided', async () => {
    const id = await child(clinicDay(-74)); // 10 weeks and 4 days old
    const s = await schedule(id);
    expect(s.schedule.find((d: { label: string }) => d.label === 'Penta 1')).toMatchObject({ status: 'OVERDUE' });

    await give(id, { vaccine: 'BCG', doseNo: 1 }, desk).expect(403);
    await give(id, { vaccine: 'BCG', doseNo: 1, lotNo: 'B123', site: 'Left upper arm' }).expect(201);
    await give(id, { vaccine: 'BCG', doseNo: 1 }).expect(409); // once
    const order = await give(id, { vaccine: 'PENTA', doseNo: 2 }).expect(409);
    expect(order.body.message).toBe('Give Penta 1 first');
    await give(id, { vaccine: 'PENTA', doseNo: 1 }).expect(201);
    const early = await give(id, { vaccine: 'PENTA', doseNo: 2 }).expect(409);
    expect(early.body.message).toMatch(/Too early: Penta 2 is not given before/);
    await give(id, { vaccine: 'HPV', doseNo: 1 }).expect(409); // a baby: not before 9 years
    await give(id, { vaccine: 'OPV', doseNo: 0 }).expect(409); // past its first 14 days
    await give(id, { vaccine: 'OPV', doseNo: 0, elsewhere: true }).expect(400); // where?
    await give(id, { vaccine: 'OPV', doseNo: 0, elsewhere: true, facility: 'Adama hospital', givenOn: clinicDay(-74) }).expect(201);
    await give(id, { vaccine: 'PCV', doseNo: 1, givenOn: clinicDay(1) }).expect(409); // future

    const after = await schedule(id);
    const penta1 = after.doses.find((d: { label: string }) => d.label === 'Penta 1');
    expect(after.schedule.find((d: { label: string }) => d.label === 'OPV 0')).toMatchObject({ status: 'GIVEN' });
    await api.post(`/immunizations/${penta1.id}/void`).set(bearer(nurse.token)).send({ reason: 'x' }).expect(400);
    await api.post(`/immunizations/${penta1.id}/void`).set(bearer(nurse.token)).send({ reason: 'Recorded on the wrong child' }).expect(201);
    expect((await schedule(id)).schedule.find((d: { label: string }) => d.label === 'Penta 1').status).toBe('OVERDUE');
    await give(id, { vaccine: 'PENTA', doseNo: 1 }).expect(201); // voided entries free the dose

    const boy = await child(monthsAgo(13 * 12), 'MALE');
    expect((await give(boy, { vaccine: 'HPV', doseNo: 1 }).expect(409)).body.message).toMatch(/girls and women/);
    const unknown = (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'No', fatherName: 'Age', sex: 'FEMALE' }).expect(201)).body.id;
    expect((await give(unknown, { vaccine: 'BCG', doseNo: 1 }).expect(409)).body.message).toMatch(/birth date or age first/);
  });

  it('lists children due or late, defaulters first, until they come back or are traced away', async () => {
    const late = await child(clinicDay(-100)); // Penta 1 due 58 days ago
    await give(late, { vaccine: 'BCG', doseNo: 1 }).expect(201);
    const onTime = await child(clinicDay(-40)); // Penta 1 due in 2 days
    await give(onTime, { vaccine: 'BCG', doseNo: 1 }).expect(201);
    const notInCare = await child(clinicDay(-100)); // no dose here: not ours to trace
    void notInCare;

    const list = async () => (await api.get('/immunizations/due').set(bearer(desk.token)).expect(200)).body as { patient: { id: string }; defaulter: boolean; daysLate: number; doses: { label: string; status: string }[] }[];
    const rows = await list();
    const lateRow = rows.find((r) => r.patient.id === late)!;
    expect(lateRow).toMatchObject({ defaulter: true });
    expect(lateRow.daysLate).toBeGreaterThanOrEqual(57);
    expect(lateRow.doses.map((d) => d.label)).toEqual(expect.arrayContaining(['Penta 1', 'OPV 1', 'PCV 1', 'Rota 1']));
    expect(rows.find((r) => r.patient.id === onTime)).toMatchObject({ defaulter: false });
    expect(rows.findIndex((r) => r.patient.id === late)).toBeLessThan(rows.findIndex((r) => r.patient.id === onTime));
    expect(rows.some((r) => r.patient.id === notInCare)).toBe(false);

    await api.post(`/patients/${late}/immunization-follow-ups`).set(bearer(desk.token)).send({ outcome: 'NO_ANSWER' }).expect(201);
    expect((await list()).find((r) => r.patient.id === late)).toBeTruthy();
    await api.post(`/patients/${late}/immunization-follow-ups`).set(bearer(desk.token)).send({ outcome: 'MOVED_AWAY', note: 'Moved to Hawassa' }).expect(201);
    expect((await list()).some((r) => r.patient.id === late)).toBe(false);
    const call = await db.immunizationFollowUp.findFirstOrThrow({ where: { patientId: late } });
    await expect(db.immunizationFollowUp.delete({ where: { id: call.id } })).rejects.toThrow(/permanent record/);
  });

  it('counts the month: doses by age, fully immunized children, drop-out', async () => {
    const dob = monthsAgo(10);
    const id = await child(dob);
    // Everything for "fully immunized" from the card, then measles 1 given here today.
    for (const [vaccine, doseNo] of [['BCG', 1], ['PENTA', 1], ['PENTA', 2], ['PENTA', 3], ['OPV', 1], ['OPV', 2], ['OPV', 3], ['PCV', 1], ['PCV', 2], ['PCV', 3], ['ROTA', 1], ['ROTA', 2], ['IPV', 1]] as const) {
      await give(id, { vaccine, doseNo, elsewhere: true, facility: 'Health centre', givenOn: monthsAgo(6) }).expect(201);
    }
    await give(id, { vaccine: 'MCV', doseNo: 1 }).expect(201);
    const r = (await api.get('/reports/moh-monthly').set(bearer(admin.token)).expect(200)).body.immunization;
    expect(r.doses.find((d: { label: string }) => d.label === 'Measles 1')).toMatchObject({ under1: 1 });
    expect(r.doses.some((d: { label: string }) => d.label === 'Rota 1')).toBe(false); // given elsewhere: not counted here
    expect(r.fullyImmunized).toBeGreaterThanOrEqual(1);
    expect(r.dropOut).toHaveProperty('penta1ToPenta3');
  });

  it('records adverse events after a vaccine, and lists serious ones until they are reported', async () => {
    const id = await child(clinicDay(-50));
    const dose = (await give(id, { vaccine: 'PENTA', doseNo: 1, givenOn: clinicDay(-3) }).expect(201)).body;
    const aefi = (body: object, who = nurse) => api.post(`/patients/${id}/aefis`).set(bearer(who.token)).send(body);
    await aefi({ doseId: dose.id, onsetOn: clinicDay(-2), signs: ['FEVER'] }, desk).expect(403);
    await aefi({ doseId: dose.id, onsetOn: clinicDay(-2), signs: [] }).expect(400);
    await aefi({ doseId: dose.id, onsetOn: clinicDay(-2), signs: ['OTHER'] }).expect(400); // say what
    await aefi({ doseId: dose.id, onsetOn: clinicDay(-5), signs: ['FEVER'] }).expect(409); // before the dose
    await aefi({ doseId: dose.id, onsetOn: clinicDay(1), signs: ['FEVER'] }).expect(409); // future
    const mild = (await aefi({ doseId: dose.id, onsetOn: clinicDay(-2), signs: ['FEVER', 'INJECTION_SITE'], outcome: 'RECOVERED' }).expect(201)).body;
    const serious = (await aefi({ doseId: dose.id, onsetOn: clinicDay(-1), signs: ['SEIZURE'], serious: true, outcome: 'RECOVERING' }).expect(201)).body;

    const mine = async () => ((await api.get('/immunizations/aefis').set(bearer(nurse.token)).expect(200)).body as { id: string; patientId: string; reportPending: boolean; doseLabel: string }[]).filter((a) => a.patientId === id);
    expect((await mine()).map((a) => [a.id, a.reportPending, a.doseLabel])).toEqual([
      [serious.id, true, 'Penta 1'],
      [mild.id, false, 'Penta 1'],
    ]);
    await api.get('/immunizations/aefis').set(bearer(desk.token)).expect(403);

    await api.patch(`/aefis/${serious.id}`).set(bearer(nurse.token)).send({ reportedOn: clinicDay() }).expect(400); // to whom
    await api.patch(`/aefis/${serious.id}`).set(bearer(nurse.token)).send({ reportedTo: 'Woreda health office, EPI focal person', reportedOn: clinicDay(), outcome: 'RECOVERED' }).expect(200);
    expect((await mine()).every((a) => !a.reportPending)).toBe(true);
    expect((await schedule(id)).aefis).toHaveLength(2);

    // A death is serious, whatever was ticked; another clinic can't touch the record.
    const died = (await aefi({ onsetOn: clinicDay(), signs: ['ANAPHYLAXIS'], outcome: 'DIED' }).expect(201)).body;
    expect(died.serious).toBe(true);
    const other = await makeStaff((await makeClinic(`Other EPI ${Date.now()}`)).id, 'NURSE');
    await api.patch(`/aefis/${serious.id}`).set(bearer(other.token)).send({ outcome: 'UNKNOWN' }).expect(404);
  });

});
