/**
 * What the offline workspace shows: the snapshot with this PC's queued work applied on top, so
 * staff see the effect of what they just did. Work the server already has (sent before the
 * snapshot was taken) is not applied twice; refused work is not applied at all.
 */
import type { Charge, IcdEntry, LabWorkOrder, Patient, PendingBill, PharmacyPrescription, QueuePatient, QueueVisit, VisitStatus } from "@/lib/api";
import type { OfflinePatient, Op, PatientIndex, Snapshot } from "./types";

export type OfflineVisit = QueueVisit & { offline?: boolean };
/** subtotal: what the visit still owes; paid: what has been paid toward it so far. */
export type OfflineBill = PendingBill & { offline?: boolean; paid?: string };
export type OfflinePayment = { opId: string; visitId: string; patient: QueuePatient; amount: number; method: string; at: string; sent: boolean };

export interface View {
  snap: Snapshot;
  queue: OfflineVisit[];
  /** Everyone this PC can find: registered here offline, today's patients, recent ones, then the clinic's list. */
  patients: OfflinePatient[];
  /** When the clinic's patient list was downloaded (front desk), or null when this PC has none. */
  patientListAt: string | null;
  lab: LabWorkOrder[];
  pharmacy: PharmacyPrescription[];
  bills: OfflineBill[];
  payments: OfflinePayment[];
  notes: Record<string, Record<string, string | number | boolean | null>>;
  diagnoses: Record<string, IcdEntry[]>;
  pending: Op[];
  failed: Op[];
}

const clone = <T>(v: T): T => structuredClone(v);

export function buildView(snap: Snapshot, ops: Op[], index?: PatientIndex | null): View {
  const v: View = {
    snap,
    queue: clone(snap.queue),
    patients: clone(snap.patients) as OfflinePatient[],
    patientListAt: index?.userId === snap.me.id ? index.at : null,
    lab: clone(snap.lab),
    pharmacy: clone(snap.pharmacy),
    bills: clone(snap.bills),
    payments: [],
    notes: {},
    diagnoses: {},
    pending: ops.filter((o) => o.status === "pending"),
    failed: ops.filter((o) => o.status === "failed"),
  };
  const visit = (id: unknown) => v.queue.find((q) => q.id === id);
  const bill = (visitId: unknown) => v.bills.find((b) => b.id === visitId);
  const addCharge = (visitId: string, charge: Pick<Charge, "description" | "unitPrice" | "quantity" | "source">) => {
    let b = bill(visitId);
    const q = visit(visitId);
    if (!b && q) {
      b = { id: visitId, queueNumber: q.queueNumber, checkedInAt: q.checkedInAt, status: q.status, patient: q.patient, doctor: q.doctor, charges: [], subtotal: "0.00", offline: true };
      v.bills.push(b);
    }
    if (!b) return;
    b.charges.push({ id: `local-${b.charges.length}`, createdAt: new Date().toISOString(), ...charge });
    // Added to what is owed (not recomputed from the lines: part of them may be paid already).
    b.subtotal = (Number(b.subtotal) + Number(charge.unitPrice) * charge.quantity).toFixed(2);
  };

  for (const op of ops) {
    const live = op.status === "pending" || (op.status === "done" && (op.doneAt ?? "") > snap.at);
    if (!live) continue;
    const d = op.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (op.kind) {
      case "register":
        v.patients.unshift(d.patient as Patient);
        break;
      case "checkin":
        v.queue.push({ ...(d.visit as OfflineVisit), offline: true });
        if (d.charge) addCharge(d.visit.id, { ...d.charge, quantity: 1, source: "CONSULTATION" });
        break;
      case "status": {
        const q = visit(d.visitId);
        if (q) q.status = d.status as VisitStatus;
        break;
      }
      case "notes": {
        v.notes[d.visitId] = { ...v.notes[d.visitId], ...d.fields };
        const q = visit(d.visitId);
        if (q && "triageLevel" in d.fields) q.triageLevel = d.fields.triageLevel;
        break;
      }
      case "diagnosis": {
        (v.diagnoses[d.visitId] ??= []).push({ code: d.code, label: d.label });
        const q = visit(d.visitId);
        if (q) q.diagnosed = true;
        break;
      }
      case "lab-order":
        for (const o of d.orders as { tmp: string; test: { id: string; name: string; price: string; unit: string | null; resultOptions: string[] } }[]) {
          v.lab.push({
            id: o.tmp,
            status: "ORDERED",
            sampleId: null,
            sampleCollectedAt: null,
            resultValue: null,
            resultFlag: null,
            resultNote: null,
            orderedAt: op.at,
            resultedAt: null,
            verifiedAt: null,
            labTest: { id: o.test.id, name: o.test.name, unit: o.test.unit, resultOptions: o.test.resultOptions, loincCode: null, refLow: null, refHigh: null },
            orderedBy: { id: op.userId, fullName: snap.me.fullName },
            collectedBy: null,
            resultedBy: null,
            verifiedBy: null,
            paid: false,
            visit: d.visit,
          });
          if (Number(o.test.price) > 0) addCharge(d.visitId, { description: o.test.name, unitPrice: o.test.price, quantity: 1, source: "LAB" });
        }
        if (visit(d.visitId)) visit(d.visitId)!.labPending = true;
        break;
      case "prescribe":
        v.pharmacy.push({
          id: d.rxTmp,
          status: "PENDING",
          createdAt: op.at,
          dispensedAt: null,
          alerts: null,
          overrideReason: null,
          prescriber: { id: op.userId, fullName: snap.me.fullName },
          items: d.items,
          visit: d.visit,
        });
        if (visit(d.visitId)) visit(d.visitId)!.rxPending = true;
        break;
      case "pay": {
        const b = bill(d.visitId);
        const q = visit(d.visitId);
        // A part payment leaves the rest owed; only a full one settles the visit.
        let settled = true;
        if (b) {
          const left = Math.round((Number(b.subtotal) - Number(d.amount)) * 100) / 100;
          b.paid = (Number(b.paid ?? 0) + Number(d.amount)).toFixed(2);
          b.subtotal = Math.max(0, left).toFixed(2);
          settled = left <= 0;
          if (settled) v.bills = v.bills.filter((x) => x.id !== d.visitId);
        }
        if (settled) {
          if (q) {
            q.consultationPaid = true;
            q.owed = "0.00";
          }
          for (const o of v.lab) if (o.visit.id === d.visitId) o.paid = true;
          for (const rx of v.pharmacy) if (rx.visit.id === d.visitId) for (const it of rx.items) it.paidQty = it.billedQty;
        }
        v.payments.push({ opId: op.id, visitId: d.visitId, patient: b?.patient ?? q?.patient ?? d.patient, amount: d.amount, method: d.method, at: op.at, sent: op.status === "done" });
        break;
      }
      case "collect": {
        const o = v.lab.find((x) => x.id === d.orderId);
        if (o) Object.assign(o, { status: "SAMPLE_COLLECTED", sampleId: d.sampleId ?? null, sampleCollectedAt: op.at });
        break;
      }
      case "reject": {
        const o = v.lab.find((x) => x.id === d.orderId);
        // The whole tube goes back, as on the server: every unreleased test sharing the sample.
        const tube = o?.sampleId ? v.lab.filter((x) => x.visit.id === o.visit.id && x.sampleId === o.sampleId && (x.status === "SAMPLE_COLLECTED" || x.status === "RESULTED")) : o ? [o] : [];
        for (const x of tube) {
          Object.assign(x, { status: "ORDERED", sampleId: null, sampleCollectedAt: null, resultValue: null, resultFlag: null, resultNote: null, values: [], critical: false, rejectReason: d.label ?? d.reason, rejections: (x.rejections ?? 0) + 1 });
        }
        break;
      }
      case "result": {
        const o = v.lab.find((x) => x.id === d.orderId);
        if (o) {
          Object.assign(o, { status: "RESULTED", resultValue: d.summary ?? d.value, resultFlag: d.flag ?? null, rangeText: d.rangeText ?? null, critical: !!d.critical, resultNote: d.note ?? null, resultedAt: op.at });
          if (d.values) o.values = d.values;
        }
        break;
      }
      case "verify": {
        const o = v.lab.find((x) => x.id === d.orderId);
        if (o) Object.assign(o, { status: "VERIFIED", verifiedAt: op.at, criticalNotified: d.notified ?? null });
        break;
      }
      case "bill-drugs": {
        const rx = v.pharmacy.find((x) => x.id === d.rxId);
        for (const it of d.items as { itemId: string; quantity: number; name: string; price: string }[]) {
          const item = rx?.items.find((x) => x.id === it.itemId);
          if (item) item.billedQty += it.quantity;
          addCharge(d.visitId, { description: it.name, unitPrice: it.price, quantity: it.quantity, source: "PHARMACY" });
        }
        break;
      }
      case "dispense": {
        const rx = v.pharmacy.find((x) => x.id === d.rxId);
        if (!rx) break;
        for (const it of d.items as { itemId: string; quantity: number }[]) {
          const item = rx.items.find((x) => x.id === it.itemId);
          if (item) item.dispensedQty += it.quantity;
        }
        rx.status = rx.items.every((i) => i.dispensedQty >= i.quantity) ? "DISPENSED" : "PARTIALLY_DISPENSED";
        break;
      }
    }
  }
  // Patients seen today but missing from the recent list are still findable, and so is everyone
  // in the clinic's list (the front desk's). The fresher copy of each patient comes first.
  const byId = new Map(v.patients.map((p) => [p.id, p]));
  for (const p of [...v.queue.map((q) => q.patient), ...(index?.userId === snap.me.id ? index.patients : [])] as OfflinePatient[]) {
    const known = byId.get(p.id);
    if (known) {
      // The card number of a merged record is only in the clinic's list.
      if (p.oldMrns && !known.oldMrns) known.oldMrns = p.oldMrns;
      continue;
    }
    byId.set(p.id, p);
    v.patients.push(p);
  }
  return v;
}
