import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/** Public health reporting (IDSR) and referrals followed up until the patient is seen. */
describe('notifiable diseases, the weekly IDSR report and referral tracking', () => {
  let tenantId: string;
  let desk: Staff, nurse: Staff, doctor: Staff, cashier: Staff, admin: Staff;

  beforeAll(async () => {
    tenantId = (await makeClinic(`IDSR Clinic ${Date.now()}`)).id;
    [desk, nurse, doctor, cashier, admin] = await Promise.all([
      makeStaff(tenantId, 'RECEPTIONIST'),
      makeStaff(tenantId, 'NURSE'),
      makeStaff(tenantId, 'DOCTOR'),
      makeStaff(tenantId, 'CASHIER'),
      makeStaff(tenantId, 'ADMIN'),
    ]);
  });

  const patient = async (firstName: string, ageYears: number, sex = 'FEMALE') =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName, fatherName: 'Case', sex, ageYears }).expect(201)).body.id as string;

  /** A finished consultation with these diagnoses, seen now or moved to `at`. */
  const consult = async (patientId: string, diagnoses: [string, string][], at?: Date) => {
    const id = (await api.post('/visits').set(bearer(desk.token)).send({ patientId }).expect(201)).body.id as string;
    await api.patch(`/visits/${id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    for (const [icd11Code, label] of diagnoses) await api.post(`/visits/${id}/diagnoses`).set(bearer(doctor.token)).send({ icd11Code, label }).expect(201);
    await db.visit.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), ...(at && { checkedInAt: at }) } });
    return id;
  };

  it('flags an immediately reportable disease on the visit and records its report once', async () => {
    const id = await consult(await patient('Measles', 4), [
      ['1F03', 'Measles'],
      ['1F40', 'Malaria due to Plasmodium falciparum'],
    ]);
    const before = (await api.get(`/visits/${id}`).set(bearer(nurse.token)).expect(200)).body;
    expect(before.notifiable.map((n: { key: string; immediate: boolean; notification: unknown }) => [n.key, n.immediate, n.notification])).toEqual([
      ['MEASLES', true, null],
      ['MALARIA', false, null],
    ]);

    const notify = (body: object, who = nurse) => api.post(`/visits/${id}/notifications`).set(bearer(who.token)).send(body);
    await notify({ disease: 'MEASLES', reportedTo: 'Woreda 3 health office' }, cashier).expect(403);
    await notify({ disease: 'MALARIA', reportedTo: 'Woreda 3 health office' }).expect(409); // weekly, not case by case
    await notify({ disease: 'CHOLERA', reportedTo: 'Woreda 3 health office' }).expect(409); // not this visit's
    await notify({ disease: 'MEASLES', reportedTo: '' }).expect(400);
    await notify({ disease: 'MEASLES', reportedTo: 'Woreda 3 health office, Sr. Hiwot', note: 'Phoned 10:20; sample to be collected' }).expect(201);
    await notify({ disease: 'MEASLES', reportedTo: 'again' }, doctor).expect(409);

    const after = (await api.get(`/visits/${id}`).set(bearer(doctor.token)).expect(200)).body;
    expect(after.notifiable[0].notification).toMatchObject({ reportedTo: 'Woreda 3 health office, Sr. Hiwot', note: 'Phoned 10:20; sample to be collected' });
    expect(after.notifiable[0].notification.reportedBy).toBeTruthy();
    const row = await db.diseaseNotification.findFirstOrThrow({ where: { visitId: id } });
    await expect(db.diseaseNotification.update({ where: { id: row.id }, data: { reportedTo: 'someone else' } })).rejects.toThrow(/permanent record/);
  });

  it('counts each disease of last week once per patient, by age, with malaria tests and unreported cases', async () => {
    const day = daysAgo(7);
    const at = new Date(`${day}T09:00:00+03:00`);
    const child = await patient('Child', 3);
    const adult = await patient('Adult', 30, 'MALE');
    await consult(child, [['1F03', 'Measles']], at);
    await consult(child, [['1F4Z', 'Malaria, unspecified']], at);
    await consult(adult, [['1F41', 'Malaria due to Plasmodium vivax']], at);
    await consult(adult, [['1F4Z', 'Malaria, unspecified']], at); // the same patient again: one case
    const cholera = await consult(await patient('Watery', 40), [['1A40', 'Acute watery diarrhoea']], at);
    const cancelled = await consult(await patient('Cancelled', 25), [['1A07', 'Typhoid fever']], at);
    await db.visit.update({ where: { id: cancelled }, data: { status: 'CANCELLED' } });

    // Malaria films released that week.
    const film = await db.labTest.create({ data: { tenantId, name: 'Malaria blood film', price: '60' } });
    for (const resultValue of ['Negative', 'P. falciparum', 'P. vivax', 'Mixed (Pf + Pv)', 'Negative']) {
      await db.labOrder.create({ data: { tenantId, visitId: cholera, labTestId: film.id, orderedById: doctor.id, status: 'VERIFIED', resultValue, verifiedAt: at } });
    }

    await api.get('/reports/idsr-weekly').query({ day }).set(bearer(doctor.token)).expect(403);
    const r = (await api.get('/reports/idsr-weekly').query({ day }).set(bearer(admin.token)).expect(200)).body;
    const row = (key: string) => r.diseases.find((d: { key: string }) => d.key === key);
    expect(r.week.start <= day && day < r.week.end).toBe(true);
    expect(r.diseases).toHaveLength(22); // every priority disease, zeros included
    expect(row('MEASLES')).toMatchObject({ under5: 1, over5: 0, total: 1, immediate: true });
    expect(row('MALARIA')).toMatchObject({ under5: 1, over5: 1, total: 2 });
    expect(row('CHOLERA')).toMatchObject({ over5: 1, total: 1 });
    expect(row('TYPHOID').total).toBe(0); // the cancelled visit does not count
    expect(r.malaria).toEqual({ tested: 5, positive: 3, falciparum: 1, vivax: 1, mixed: 1, notStated: 0 });
    expect(r.immediateCases.map((c: { label: string; notification: unknown }) => [c.label, c.notification])).toEqual([
      ['Measles', null],
      ['Cholera / acute watery diarrhoea', null],
    ]);
    expect(r.unreported.map((c: { disease: string }) => c.disease).sort()).toEqual(['CHOLERA', 'MEASLES']);
  });

  it('tracks a referral from sent to feedback received', async () => {
    const visitId = await consult(await patient('Referred', 50), [['BA00', 'Essential hypertension']]);
    const letter = { type: 'REFERRAL', to: 'Tikur Anbessa Hospital, cardiology', urgency: 'URGENT', reason: 'Echocardiography', summary: 'BP 190/120 despite two drugs' };
    const ref = (await api.post(`/visits/${visitId}/documents`).set(bearer(doctor.token)).send(letter).expect(201)).body;
    const cert = (await api
      .post(`/visits/${visitId}/documents`)
      .set(bearer(doctor.token))
      .send({ type: 'MEDICAL_CERTIFICATE', diagnosis: 'Hypertension', restDays: 2, fromDate: daysAgo(0) })
      .expect(201)).body;

    const open = async () => (await api.get('/referrals').set(bearer(nurse.token)).expect(200)).body as { id: string; status: string; overdue: boolean }[];
    expect((await open()).find((x) => x.id === ref.id)).toMatchObject({ status: 'SENT', overdue: false });
    await db.clinicalDocument.update({ where: { id: ref.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await open()).find((x) => x.id === ref.id)).toMatchObject({ status: 'SENT', overdue: true }); // urgent, 3 days, not heard of

    const follow = (body: object, who = nurse, id = ref.id) => api.post(`/documents/${id}/follow-ups`).set(bearer(who.token)).send(body);
    await follow({ status: 'ARRIVED' }, cashier).expect(403);
    await follow({ status: 'SENT' }).expect(400); // a note says what was done
    await follow({ status: 'ARRIVED' }, nurse, cert.id).expect(409); // certificates are not followed up
    await follow({ status: 'SENT', note: 'Phoned the patient: going tomorrow' }).expect(201);
    await follow({ status: 'ARRIVED', note: 'Seen in cardiology OPD' }).expect(201);
    expect((await open()).find((x) => x.id === ref.id)).toMatchObject({ status: 'ARRIVED', overdue: false });
    await follow({ status: 'FEEDBACK_RECEIVED' }, doctor).expect(400);
    await follow({ status: 'FEEDBACK_RECEIVED', note: 'LVH on echo; added bisoprolol, review in 3 months' }, doctor).expect(201);
    expect((await open()).some((x) => x.id === ref.id)).toBe(false);

    const all = (await api.get('/referrals').query({ view: 'all' }).set(bearer(admin.token)).expect(200)).body;
    expect(all.find((x: { id: string }) => x.id === ref.id)).toMatchObject({ status: 'FEEDBACK_RECEIVED', to: 'Tikur Anbessa Hospital, cardiology', urgency: 'URGENT' });
    const docs = (await api.get(`/visits/${visitId}/documents`).set(bearer(doctor.token)).expect(200)).body;
    const r = docs.find((d: { id: string }) => d.id === ref.id);
    expect(r.referralStatus).toBe('FEEDBACK_RECEIVED');
    expect(r.followUps.map((f: { status: string }) => f.status)).toEqual(['SENT', 'ARRIVED', 'FEEDBACK_RECEIVED']);
    expect(r.followUps[2].createdBy).toBeTruthy();
    expect(docs.find((d: { id: string }) => d.id === cert.id).referralStatus).toBeNull();
    const f = await db.referralFollowUp.findFirstOrThrow({ where: { documentId: ref.id } });
    await expect(db.referralFollowUp.delete({ where: { id: f.id } })).rejects.toThrow(/permanent record/);

    const moh = (await api.get('/reports/moh-monthly').set(bearer(admin.token)).expect(200)).body;
    expect(moh.opd.referralsOut).toBeGreaterThanOrEqual(1);
  });
});
