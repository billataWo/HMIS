/**
 * Offline work, one function per action. Each queues an operation that replays the same API
 * request the normal screens make, so every rule (pay-first, stock, safety checks) is applied
 * by the server when it is sent; nothing here bypasses them.
 */
import type { DrugOption, Frequency, IcdEntry, LabWorkOrder, Patient, PharmacyPrescription, QueuePatient, Service, VisitStatus } from "@/lib/api";
import { EN } from "@/lib/format";
import { enqueue } from "./engine";
import { type OfflineLabTest, tmpId } from "./types";
import type { OfflineVisit } from "./view";

const who = (p: Pick<QueuePatient, "firstName" | "fatherName">) => `${p.firstName} ${p.fatherName}`;
/** An operation's list label: the English text, and the key and values the workspace translates. */
const opLabel = (key: string, vars: Record<string, string | number>) => ({ label: EN(key, vars), labelKey: key, labelVars: vars });

export type NewPatient = {
  firstName: string;
  fatherName: string;
  grandfather?: string;
  sex: "MALE" | "FEMALE";
  ageYears?: number;
  phone?: string;
  confirmDuplicate?: boolean;
};

export async function registerPatient(userId: string, p: NewPatient) {
  const tmp = tmpId();
  const patient: Patient = {
    id: tmp,
    mrn: "New",
    firstName: p.firstName,
    fatherName: p.fatherName,
    grandfather: p.grandfather ?? null,
    sex: p.sex,
    phone: p.phone ?? null,
    dateOfBirth: p.ageYears !== undefined ? `${new Date().getFullYear() - p.ageYears}-07-01` : null,
    allergies: [],
  } as unknown as Patient;
  await enqueue({
    userId,
    kind: "register",
    ...opLabel("Register {name}", { name: who(p) }),
    steps: [{ method: "POST", path: "/patients", body: { ...p, confirmDuplicate: p.confirmDuplicate ?? false } }],
    creates: [{ tmp, step: 0, pick: "id" }],
    data: { patient },
  });
  return patient;
}

export async function checkIn(userId: string, patient: QueuePatient, service: Service | null) {
  const tmp = tmpId();
  const visit: OfflineVisit = {
    id: tmp,
    queueNumber: 0,
    status: "WAITING",
    checkedInAt: new Date().toISOString(),
    calledAt: null,
    completedAt: null,
    patient,
    doctor: null,
    consultationPaid: !service || Number(service.price) === 0,
    offline: true,
  };
  await enqueue({
    userId,
    kind: "checkin",
    ...opLabel("Check in {name}", { name: who(patient) }),
    steps: [{ method: "POST", path: "/visits", body: { patientId: patient.id, ...(service && { serviceId: service.id }) } }],
    creates: [{ tmp, step: 0, pick: "id" }],
    data: { visit, charge: service && Number(service.price) > 0 ? { description: service.name, unitPrice: service.price } : null },
  });
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  WAITING: "Back to waiting: {name}",
  IN_CONSULTATION: "Call in {name}",
  AWAITING_LAB: "Send {name} to the lab",
  AWAITING_PHARMACY: "Send {name} to the pharmacy",
  COMPLETED: "Complete the visit of {name}",
  CANCELLED: "Cancel the visit of {name}",
};

export const setStatus = (userId: string, visit: OfflineVisit, status: VisitStatus) =>
  enqueue({
    userId,
    kind: "status",
    ...opLabel(STATUS_LABEL[status], { name: who(visit.patient) }),
    steps: [{ method: "PATCH", path: `/visits/${visit.id}/status`, body: { status } }],
    data: { visitId: visit.id, status },
  });

export const saveNotes = (userId: string, visit: OfflineVisit, fields: Record<string, string | number>) =>
  enqueue({
    userId,
    kind: "notes",
    ...opLabel("Notes and vitals for {name}", { name: who(visit.patient) }),
    steps: [{ method: "PATCH", path: `/visits/${visit.id}`, body: fields }],
    data: { visitId: visit.id, fields },
  });

export const addDiagnosis = (userId: string, visit: OfflineVisit, icd: IcdEntry, isPrimary: boolean) =>
  enqueue({
    userId,
    kind: "diagnosis",
    ...opLabel("Diagnosis {code} for {name}", { code: icd.code, name: who(visit.patient) }),
    steps: [{ method: "POST", path: `/visits/${visit.id}/diagnoses`, body: { icd11Code: icd.code, label: icd.label, isPrimary } }],
    data: { visitId: visit.id, code: icd.code, label: icd.label },
  });

export async function orderLab(userId: string, visit: OfflineVisit, tests: OfflineLabTest[]) {
  const orders = tests.map((test) => ({ tmp: tmpId(), test }));
  await enqueue({
    userId,
    kind: "lab-order",
    ...opLabel("Lab: {tests} for {name}", { tests: tests.map((x) => x.name).join(", "), name: who(visit.patient) }),
    steps: [{ method: "POST", path: `/visits/${visit.id}/lab-orders`, body: { labTestIds: tests.map((t) => t.id) } }],
    // The API returns the orders in the order they were asked for.
    creates: orders.map((o, i) => ({ tmp: o.tmp, step: 0, pick: `${i}.id` })),
    data: { visitId: visit.id, visit: { id: visit.id, queueNumber: visit.queueNumber, patient: visit.patient }, orders },
  });
}

export type RxLine = { drug: DrugOption; dose: string; frequency: Frequency; durationDays?: number; quantity: number };

export async function prescribe(userId: string, visit: OfflineVisit, lines: RxLine[]) {
  const rxTmp = tmpId();
  const items = lines.map((l) => ({
    id: tmpId(),
    dose: l.dose,
    frequency: l.frequency,
    durationDays: l.durationDays ?? null,
    quantity: l.quantity,
    instructions: null,
    billedQty: 0,
    dispensedQty: 0,
    paidQty: 0,
    inStock: l.drug.inStock,
    drug: l.drug,
  }));
  await enqueue({
    userId,
    kind: "prescribe",
    ...opLabel("Prescription ({drugs}) for {name}", { drugs: lines.map((l) => l.drug.genericName).join(", "), name: who(visit.patient) }),
    steps: [
      {
        method: "POST",
        path: `/visits/${visit.id}/prescriptions`,
        // Allergy and interaction checks run on the server when this is sent; an alert sends it
        // back to the doctor ("needs attention") instead of being accepted unseen.
        body: { items: lines.map((l) => ({ drugId: l.drug.id, dose: l.dose, frequency: l.frequency, durationDays: l.durationDays, quantity: l.quantity })) },
      },
    ],
    creates: [{ tmp: rxTmp, step: 0, pick: "id" }, ...items.map((it) => ({ tmp: it.id, step: 0, pick: `items[drugId=${it.drug.id}].id` }))],
    data: { visitId: visit.id, rxTmp, items, visit: { id: visit.id, queueNumber: visit.queueNumber, status: visit.status, patient: visit.patient } },
  });
}

/**
 * A payment toward what the visit owes. One request: the server bills anything not invoiced yet
 * and pays the visit's open invoices, so instalments work and a bill already settled on another
 * PC is refused ("Nothing is owed") instead of being taken twice.
 */
export const payVisit = (userId: string, visitId: string, patient: QueuePatient, amount: number, method: "CASH" | "TELEBIRR", reference?: string) =>
  enqueue({
    userId,
    kind: "pay",
    ...(method === "CASH"
      ? opLabel("Cash payment of {amount} ETB from {name}", { amount: amount.toFixed(2), name: who(patient) })
      : opLabel("Telebirr payment ({reference}) of {amount} ETB from {name}", { reference: reference ?? "", amount: amount.toFixed(2), name: who(patient) })),
    steps: [{ method: "POST", path: `/visits/${visitId}/payments`, body: { method, amount, ...(reference && { reference }) } }],
    data: { visitId, amount, method, patient },
  });

export const collectSample = (userId: string, order: LabWorkOrder, sampleId?: string) =>
  enqueue({
    userId,
    kind: "collect",
    ...opLabel("Sample for {test} ({name})", { test: order.labTest.name, name: who(order.visit.patient) }),
    steps: [{ method: "POST", path: `/lab-orders/${order.id}/collect`, body: sampleId ? { sampleId } : {} }],
    data: { orderId: order.id, sampleId },
  });

export const enterResult = (userId: string, order: LabWorkOrder, value: string, note?: string) =>
  enqueue({
    userId,
    kind: "result",
    ...opLabel("Result {test}: {value} ({name})", { test: order.labTest.name, value, name: who(order.visit.patient) }),
    steps: [{ method: "POST", path: `/lab-orders/${order.id}/result`, body: { value, ...(note && { note }) } }],
    data: { orderId: order.id, value, note },
  });

export const verifyResult = (userId: string, order: LabWorkOrder) =>
  enqueue({
    userId,
    kind: "verify",
    ...opLabel("Verify {test} ({name})", { test: order.labTest.name, name: who(order.visit.patient) }),
    steps: [{ method: "POST", path: `/lab-orders/${order.id}/verify` }],
    data: { orderId: order.id },
  });

export const billDrugs = (userId: string, rx: PharmacyPrescription, items: { itemId: string; quantity: number; name: string; price: string }[]) =>
  enqueue({
    userId,
    kind: "bill-drugs",
    ...opLabel("Bill drugs for {name}", { name: who(rx.visit.patient) }),
    steps: [{ method: "POST", path: `/prescriptions/${rx.id}/bill`, body: { items: items.map(({ itemId, quantity }) => ({ itemId, quantity })) } }],
    data: { rxId: rx.id, visitId: rx.visit.id, items },
  });

export const dispense = (userId: string, rx: PharmacyPrescription, items: { itemId: string; quantity: number }[]) =>
  enqueue({
    userId,
    kind: "dispense",
    ...opLabel("Hand over drugs to {name}", { name: who(rx.visit.patient) }),
    steps: [{ method: "POST", path: `/prescriptions/${rx.id}/dispense`, body: { items } }],
    data: { rxId: rx.id, items },
  });
