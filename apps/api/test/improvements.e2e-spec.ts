import { api, bearer, db, login, makeClinic, makeStaff, makeUser, startApp, stopApp, recordDiagnosis } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };

describe('improvements to the current modules', () => {
  let tenantId: string;
  let admin: Staff, doctor: Staff, nurse: Staff, desk: Staff, cashier: Staff, tech: Staff, pharmacist: Staff;
  let amoxId: string;

  const newPatient = async (body: object = {}) =>
    (await api.post('/patients').set(bearer(desk.token)).send({ confirmDuplicate: true, firstName: 'Imp', fatherName: 'Rove', sex: 'FEMALE', ...body }).expect(201)).body;
  const seen = async () => {
    const p = await newPatient();
    const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id }).expect(201)).body;
    await api.patch(`/visits/${v.id}/status`).set(bearer(doctor.token)).send({ status: 'IN_CONSULTATION' }).expect(200);
    await recordDiagnosis(v.id);
    return { patient: p, visitId: v.id as string };
  };

  beforeAll(async () => {
    tenantId = (await makeClinic('Improvements Clinic')).id;
    [admin, doctor, nurse, desk, cashier, tech, pharmacist] = await Promise.all(
      (['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'CASHIER', 'LAB_TECH', 'PHARMACIST'] as const).map((r) => makeStaff(tenantId, r)),
    );
    amoxId = (await db.drug.create({ data: { tenantId, genericName: 'Amoxicillin', drugClass: 'penicillin', form: 'capsule', unit: 'capsule', sellPrice: '5.00' } })).id;
    await db.stockBatch.create({ data: { drugId: amoxId, batchNo: 'A1', expiryDate: new Date(Date.now() + 200 * 86_400_000), quantity: 100, costPrice: '2.00' } });
  });

  describe('patient records', () => {
    it('lets reception correct details and doctors update allergies, which the prescribing check then uses', async () => {
      const { patient, visitId } = await seen();
      const fixed = (await api.patch(`/patients/${patient.id}`).set(bearer(desk.token)).send({ firstName: 'Ima', phone: '+251 911 22 33 44' }).expect(200)).body;
      expect([fixed.firstName, fixed.phone]).toEqual(['Ima', '0911223344']);
      await api.patch(`/patients/${patient.id}`).set(bearer(doctor.token)).send({ firstName: 'Nope' }).expect(403);
      await api.patch(`/patients/${patient.id}`).set(bearer(cashier.token)).send({ allergies: ['X'] }).expect(403);
      expect((await api.patch(`/patients/${patient.id}`).set(bearer(doctor.token)).send({ allergies: ['Penicillin'] }).expect(200)).body.allergies).toEqual(['Penicillin']);

      const rx = await api
        .post(`/visits/${visitId}/prescriptions`)
        .set(bearer(doctor.token))
        .send({ items: [{ drugId: amoxId, dose: '500 mg', frequency: 'TID', durationDays: 5, quantity: 15 }] })
        .expect(409);
      expect(rx.body.alerts[0].type).toBe('ALLERGY');
      const audit = await db.auditLog.findFirst({ where: { tenantId, action: 'patient.update', entityId: patient.id }, orderBy: { createdAt: 'desc' } });
      expect(audit?.data).toMatchObject({ fields: ['allergies'] }); // which fields, never the content
    });
  });

  describe('procedures', () => {
    it('charges procedures given during the visit', async () => {
      const injection = await db.serviceItem.create({ data: { tenantId, code: 'INJ', name: 'Injection', price: '30.00', kind: 'PROCEDURE' } });
      const fee = await db.serviceItem.create({ data: { tenantId, code: 'FEE', name: 'Consultation', price: '150.00' } });
      const { visitId } = await seen();
      await api.post(`/visits/${visitId}/procedures`).set(bearer(nurse.token)).send({ serviceId: fee.id }).expect(404); // not a procedure
      await api.post(`/visits/${visitId}/procedures`).set(bearer(cashier.token)).send({ serviceId: injection.id }).expect(403);
      const added = (await api.post(`/visits/${visitId}/procedures`).set(bearer(nurse.token)).send({ serviceId: injection.id, quantity: 2 }).expect(201)).body;
      const extra = (await api.post(`/visits/${visitId}/procedures`).set(bearer(doctor.token)).send({ serviceId: injection.id }).expect(201)).body;
      await api.delete(`/visits/${visitId}/procedures/${extra.id}`).set(bearer(doctor.token)).expect(200); // recorded by mistake

      const pending = (await api.get('/billing/pending').set(bearer(cashier.token)).expect(200)).body.find((v: { id: string }) => v.id === visitId);
      expect(pending.subtotal).toBe('60.00');
      await api.post('/invoices').set(bearer(cashier.token)).send({ visitId }).expect(201);
      await api.delete(`/visits/${visitId}/procedures/${added.id}`).set(bearer(doctor.token)).expect(409); // invoiced
    });
  });

  describe('lab panels', () => {
    it('takes one result per component, flags each, and hides them until verified', async () => {
      const cbc = await db.labTest.create({
        data: {
          tenantId,
          name: 'CBC',
          price: '0',
          resultOptions: [],
          components: {
            create: [
              { tenantId, name: 'WBC', unit: '×10³/µL', refLow: '4', refHigh: '11', sortOrder: 0, resultOptions: [] },
              { tenantId, name: 'Hemoglobin', unit: 'g/dL', refLow: '12', refHigh: '17', sortOrder: 1, resultOptions: [] },
              { tenantId, name: 'Film', sortOrder: 2, resultOptions: ['Normal', 'Abnormal'] },
            ],
          },
        },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      });
      const [wbc, hb, film] = cbc.components;
      const { visitId } = await seen();
      const [order] = (await api.post(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).send({ labTestIds: [cbc.id] }).expect(201)).body;
      expect(order.labTest.components.map((c: { name: string }) => c.name)).toEqual(['WBC', 'Hemoglobin', 'Film']);
      await api.post(`/lab-orders/${order.id}/collect`).set(bearer(tech.token)).send({}).expect(201);

      await api.post(`/lab-orders/${order.id}/result`).set(bearer(tech.token)).send({ values: [{ componentId: film.id, value: 'Maybe' }] }).expect(409);
      await api.post(`/lab-orders/${order.id}/result`).set(bearer(tech.token)).send({ values: [{ componentId: wbc.id, value: 'x' }] }).expect(409);
      const r = (
        await api
          .post(`/lab-orders/${order.id}/result`)
          .set(bearer(tech.token))
          .send({ values: [{ componentId: wbc.id, value: '13.2' }, { componentId: hb.id, value: '9' }, { componentId: film.id, value: 'Normal' }] })
          .expect(201)
      ).body;
      const flags = Object.fromEntries(r.values.map((v: { componentId: string; flag: string | null }) => [v.componentId, v.flag]));
      expect([flags[wbc.id], flags[hb.id], flags[film.id]]).toEqual(['H', 'L', null]);
      expect(r.resultFlag).toBe('H');
      expect(r.resultValue).toBe('WBC 13.2 H; Hemoglobin 9 L; Film Normal');

      const hidden = (await api.get(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).expect(200)).body[0];
      expect(hidden.values).toEqual([]);
      await api.post(`/lab-orders/${order.id}/verify`).set(bearer(tech.token)).send({}).expect(201);
      expect((await api.get(`/visits/${visitId}/lab-orders`).set(bearer(doctor.token)).expect(200)).body[0].values).toHaveLength(3);

      // Components can't be replaced once results point at them.
      await api.patch(`/catalog/lab-tests/${cbc.id}`).set(bearer(admin.token)).send({ components: [{ name: 'Only one' }] }).expect(409);
    });
  });

  describe('sign-in security', () => {
    it('signs out a deactivated user on their next request, and applies role changes at once', async () => {
      const user = await makeUser(tenantId, 'CASHIER');
      const token = await login(user.phone);
      await api.get('/billing/pending').set(bearer(token)).expect(200);
      await api.patch(`/users/${user.id}`).set(bearer(admin.token)).send({ role: 'LAB_TECH' }).expect(200);
      await api.get('/billing/pending').set(bearer(token)).expect(403); // same token, new role
      await api.patch(`/users/${user.id}`).set(bearer(admin.token)).send({ active: false }).expect(200);
      await api.get('/auth/me').set(bearer(token)).expect(401);
    });

    it('locks a phone number after 5 wrong passwords', async () => {
      const user = await makeUser(tenantId, 'NURSE');
      for (let i = 0; i < 5; i++) await api.post('/auth/login').send({ phone: user.phone, password: 'wrong-one' }).expect(401);
      const locked = await api.post('/auth/login').send({ phone: user.phone, password: 'password123' }).expect(429);
      expect(locked.body.message).toContain('Too many');
    });

    it('makes a new account replace its temporary password before working', async () => {
      const created = (
        await api.post('/users').set(bearer(admin.token)).send({ fullName: 'New Hire', phone: `09${String(Date.now()).slice(-8)}`, role: 'CASHIER', password: 'temporary1' }).expect(201)
      ).body;
      const first = (await api.post('/auth/login').send({ phone: created.phone, password: 'temporary1' }).expect(200)).body;
      expect(first.mustChangePassword).toBe(true);
      const blocked = await api.get('/billing/pending').set(bearer(first.token)).expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await api.get('/auth/me').set(bearer(first.token)).expect(200)).body.mustChangePassword).toBe(true);

      await api.post('/auth/password').set(bearer(first.token)).send({ current: 'wrong', next: 'my-own-pass' }).expect(401);
      await api.post('/auth/password').set(bearer(first.token)).send({ current: 'temporary1', next: 'temporary1' }).expect(400);
      const changed = (await api.post('/auth/password').set(bearer(first.token)).send({ current: 'temporary1', next: 'my-own-pass' }).expect(200)).body;
      // The change ends other sign-ins; this one carries on with the fresh token it returns.
      await api.get('/billing/pending').set(bearer(changed.token)).expect(200);
      await api.post('/auth/login').send({ phone: created.phone, password: 'my-own-pass' }).expect(200);
    });
  });

  describe('walk-in pharmacy sales', () => {
    it('sells over the counter through the usual pay-then-dispense steps, outside the queue', async () => {
      const sale = (await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ items: [{ drugId: amoxId, quantity: 6 }] }).expect(201)).body;
      await api.post('/pharmacy/walk-in').set(bearer(cashier.token)).send({ items: [{ drugId: amoxId, quantity: 1 }] }).expect(403);
      const visit = await db.visit.findUniqueOrThrow({ where: { id: sale.visitId }, include: { patient: true } });
      expect([visit.kind, visit.status, visit.patient.mrn]).toEqual(['WALK_IN', 'AWAITING_PHARMACY', 'WALK-IN']);

      const item = { itemId: sale.items[0].id, quantity: 6 };
      await api.post(`/prescriptions/${sale.id}/dispense`).set(bearer(pharmacist.token)).send({ items: [item] }).expect(201); // bill-at-end clinic
      expect((await db.visit.findUniqueOrThrow({ where: { id: sale.visitId } })).status).toBe('COMPLETED');
      const invoice = (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId: sale.visitId }).expect(201)).body;
      expect(invoice.total).toBe('30');

      const queue = (await api.get('/queue').set(bearer(desk.token)).expect(200)).body;
      expect(queue.visits.some((v: { id: string }) => v.id === sale.visitId)).toBe(false);
      const search = (await api.get('/patients?q=walk').set(bearer(desk.token)).expect(200)).body;
      expect(search.some((p: { mrn: string }) => p.mrn === 'WALK-IN')).toBe(false);
    });

    it("checks a named customer's allergies", async () => {
      const p = await newPatient({ allergies: ['Penicillin'] });
      const refused = await api.post('/pharmacy/walk-in').set(bearer(pharmacist.token)).send({ patientId: p.id, items: [{ drugId: amoxId, quantity: 1 }] }).expect(409);
      expect(refused.body.alerts[0].type).toBe('ALLERGY');
    });
  });

  describe('audit log', () => {
    it('shows admins who did what', async () => {
      const res = (await api.get('/audit').set(bearer(admin.token)).expect(200)).body;
      expect(res.entries.length).toBeGreaterThan(0);
      expect(res.entries.some((e: { action: string; user: { fullName: string } | null }) => e.action === 'patient.create' && e.user?.fullName)).toBe(true);
      const onlyPatients = (await api.get('/audit?action=patient.').set(bearer(admin.token)).expect(200)).body.entries;
      expect(onlyPatients.every((e: { action: string }) => e.action.startsWith('patient.'))).toBe(true);
      await api.get('/audit').set(bearer(cashier.token)).expect(403);
    });
  });

  describe('credit and insurance accounts', () => {
    it('keeps an account per payer, prints a statement, and settles invoices oldest first', async () => {
      const ethio = (await api.post('/payers').set(bearer(admin.token)).send({ type: 'CREDIT', name: 'Ethio Cement PLC', phone: '0911000099' }).expect(201)).body;
      await api.post('/payers').set(bearer(cashier.token)).send({ type: 'CREDIT', name: 'Other' }).expect(403);
      const fee = await db.serviceItem.create({ data: { tenantId, code: 'FEE2', name: 'Consultation', price: '100.00' } });

      const bill = async () => {
        const p = await newPatient();
        const v = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: p.id, serviceId: fee.id }).expect(201)).body;
        return (await api.post('/invoices').set(bearer(cashier.token)).send({ visitId: v.id, payerType: 'CREDIT', payerId: ethio.id }).expect(201)).body;
      };
      const [first, second] = [await bill(), await bill()];
      expect(first.payerName).toBe('Ethio Cement PLC');

      const listed = (await api.get('/payers').set(bearer(cashier.token)).expect(200)).body.find((p: { id: string }) => p.id === ethio.id);
      expect([listed.balance, listed.openInvoices]).toEqual(['200.00', 2]);
      const statement = (await api.get(`/payers/${ethio.id}/statement`).set(bearer(cashier.token)).expect(200)).body;
      expect([statement.billed, statement.balance, statement.invoices.length]).toEqual(['200.00', '200.00', 2]);

      await api.post(`/payers/${ethio.id}/settlements`).set(bearer(cashier.token)).send({ method: 'BANK_TRANSFER', amount: 500, reference: 'CHQ-1' }).expect(409); // more than owed
      const settled = (await api.post(`/payers/${ethio.id}/settlements`).set(bearer(cashier.token)).send({ method: 'BANK_TRANSFER', amount: 150, reference: 'CHQ-1' }).expect(201)).body;
      expect(settled.applied).toEqual([
        { number: first.number, amount: '100.00' },
        { number: second.number, amount: '50.00' },
      ]);
      expect(settled.remainingBalance).toBe('50.00');
      expect((await db.invoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('PAID');
      expect((await db.invoice.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PARTIALLY_PAID');
      await api.post(`/payers/${ethio.id}/settlements`).set(bearer(cashier.token)).send({ method: 'BANK_TRANSFER', amount: 50, reference: 'CHQ-1' }).expect(409); // reference reused
    });
  });

  describe('purchase orders and stock counts', () => {
    it('orders from a supplier and fills the order from deliveries', async () => {
      const supplier = await db.supplier.create({ data: { tenantId, name: 'EPSS Hub' } });
      const po = (
        await api.post('/purchase-orders').set(bearer(pharmacist.token)).send({ supplierId: supplier.id, lines: [{ drugId: amoxId, quantity: 100, unitCost: 2 }] }).expect(201)
      ).body;
      expect([po.number, po.status, po.total]).toEqual([expect.stringMatching(/^PO-\d{5}$/), 'DRAFT', '200.00']);
      const receipt = (items: object[]) =>
        api.post('/inventory/receipts').set(bearer(pharmacist.token)).send({ supplierId: supplier.id, purchaseOrderId: po.id, items });
      const expiry = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
      await receipt([{ drugId: amoxId, batchNo: 'P1', expiryDate: expiry, quantity: 60, costPrice: 2 }]).expect(409); // not sent yet
      await api.post(`/purchase-orders/${po.id}/order`).set(bearer(pharmacist.token)).expect(201);
      await receipt([{ drugId: amoxId, batchNo: 'P1', expiryDate: expiry, quantity: 60, costPrice: 2 }]).expect(201);
      expect((await api.get(`/purchase-orders/${po.id}`).set(bearer(pharmacist.token)).expect(200)).body.status).toBe('PARTLY_RECEIVED');
      // No supplier named: a delivery against the order comes from the order's supplier.
      await api
        .post('/inventory/receipts')
        .set(bearer(pharmacist.token))
        .send({ purchaseOrderId: po.id, items: [{ drugId: amoxId, batchNo: 'P2', expiryDate: expiry, quantity: 40, costPrice: 2 }] })
        .expect(201);
      const done = (await api.get(`/purchase-orders/${po.id}`).set(bearer(pharmacist.token)).expect(200)).body;
      expect([done.status, done.lines[0].receivedQty]).toEqual(['RECEIVED', 100]);
      const p2 = await db.stockBatch.findFirstOrThrow({ where: { drugId: amoxId, batchNo: 'P2' } });
      expect([p2.supplierId, p2.supplier]).toEqual([supplier.id, 'EPSS Hub']);
    });

    it('sets counted batches to what is on the shelf and records each difference', async () => {
      const batch = await db.stockBatch.create({ data: { drugId: amoxId, batchNo: 'C1', expiryDate: new Date(Date.now() + 100 * 86_400_000), quantity: 50, costPrice: '2.00' } });
      const res = (await api.post('/inventory/counts').set(bearer(pharmacist.token)).send({ lines: [{ batchId: batch.id, counted: 47 }] }).expect(201)).body;
      expect(res.differences).toEqual([expect.objectContaining({ system: 50, counted: 47, difference: -3, value: '-6.00' })]);
      expect((await db.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })).quantity).toBe(47);
      const movement = await db.stockMovement.findFirst({ where: { batchId: batch.id, type: 'ADJUSTMENT' } });
      expect([movement?.quantity, movement?.reason?.startsWith('COUNT_CORRECTION')]).toEqual([-3, true]);
      await api.post('/inventory/counts').set(bearer(cashier.token)).send({ lines: [{ batchId: batch.id, counted: 1 }] }).expect(403);
    });
  });

  describe('clinical documents', () => {
    it('issues medical certificates and referral letters from a visit', async () => {
      const waiting = await newPatient();
      const w = (await api.post('/visits').set(bearer(desk.token)).send({ patientId: waiting.id }).expect(201)).body;
      const cert = { type: 'MEDICAL_CERTIFICATE', diagnosis: 'Acute gastroenteritis', restDays: 3, fromDate: '2026-11-08' };
      await api.post(`/visits/${w.id}/documents`).set(bearer(doctor.token)).send(cert).expect(409); // not seen yet

      const { visitId } = await seen();
      await api.post(`/visits/${visitId}/documents`).set(bearer(nurse.token)).send(cert).expect(403);
      const doc = (await api.post(`/visits/${visitId}/documents`).set(bearer(doctor.token)).send(cert).expect(201)).body;
      await db.visit.update({ where: { id: visitId }, data: { temperatureC: '38.4', pulse: 104, systolicBp: 118, diastolicBp: 76 } });
      const referral = (
        await api
          .post(`/visits/${visitId}/documents`)
          .set(bearer(doctor.token))
          .send({ type: 'REFERRAL', to: 'Tikur Anbessa Hospital, surgery', urgency: 'URGENT', reason: 'Suspected appendicitis', summary: 'RLQ pain 2 days, fever' })
          .expect(201)
      ).body;
      // The letter carries what the receiving clinician needs: allergies, vital signs, released results.
      const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
      await db.patient.update({ where: { id: v.patientId }, data: { allergies: ['Penicillin'] } });
      const hbTest = await db.labTest.create({ data: { tenantId, name: 'Hemoglobin (referral)', unit: 'g/dL', price: '0', resultOptions: [] } });
      const lab = (status: 'VERIFIED' | 'RESULTED', resultValue: string) =>
        db.labOrder.create({ data: { tenantId, visitId, labTestId: hbTest.id, orderedById: doctor.id, status, resultValue, resultFlag: 'L', rangeText: '12–16 g/dL', verifiedAt: status === 'VERIFIED' ? new Date() : null } });
      await lab('VERIFIED', '9.8');
      await lab('RESULTED', '9.9'); // entered, not released: never on a letter
      const letter = (await api.get(`/documents/${referral.id}`).set(bearer(doctor.token)).expect(200)).body;
      expect(letter.visit).toMatchObject({ temperatureC: '38.4', pulse: 104, systolicBp: 118, diastolicBp: 76 });
      expect(letter.visit.labOrders).toEqual([expect.objectContaining({ resultValue: '9.8', resultFlag: 'L', rangeText: '12–16 g/dL', labTest: { name: 'Hemoglobin (referral)', unit: 'g/dL' } })]);
      expect(letter.visit.patient.allergies).toEqual(['Penicillin']);

      // Issued with a mistake: voided with the reason (the doctor issues a new one), and no longer followed up.
      const voidDoc = (body: object, who = doctor) => api.post(`/documents/${referral.id}/void`).set(bearer(who.token)).send(body);
      await voidDoc({ reason: 'Wrong hospital' }, nurse).expect(403);
      await voidDoc({ reason: 'x' }).expect(400);
      await voidDoc({ reason: 'Wrong hospital' }).expect(201);
      await voidDoc({ reason: 'Again' }).expect(409);
      expect((await api.get(`/documents/${referral.id}`).set(bearer(nurse.token)).expect(200)).body).toMatchObject({ voidReason: 'Wrong hospital' });
      await api.post(`/documents/${referral.id}/follow-ups`).set(bearer(nurse.token)).send({ status: 'ARRIVED' }).expect(409);
      const open = (await api.get('/referrals?view=all').set(bearer(doctor.token)).expect(200)).body;
      expect(open.some((r: { id: string }) => r.id === referral.id)).toBe(false);
      const printed = (await api.get(`/documents/${doc.id}`).set(bearer(doctor.token)).expect(200)).body;
      expect([printed.data.restDays, printed.data.issuedBy, printed.visit.tenant.name]).toEqual([3, 'DOCTOR user', 'Improvements Clinic']);
      expect((await api.get(`/visits/${visitId}/documents`).set(bearer(nurse.token)).expect(200)).body).toHaveLength(2);
    });
  });
});
