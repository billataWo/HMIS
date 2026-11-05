import { tenantContext } from '../src/common/tenant-context.js';
import { appPrisma, db, makeClinic, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

/**
 * These queries deliberately leave out any tenant filter: only PostgreSQL row-level security
 * stands between clinics here.
 */
describe('row-level security', () => {
  let a: string, b: string;

  beforeAll(async () => {
    a = (await makeClinic('RLS Clinic A')).id;
    b = (await makeClinic('RLS Clinic B')).id;
    for (const [tenantId, name] of [[a, 'Alpha'], [b, 'Beta']] as const) {
      const p = await db.patient.create({ data: { tenantId, mrn: `MRN-${name}`, firstName: name, fatherName: 'X', sex: 'MALE', allergies: [] } });
      const v = await db.visit.create({ data: { tenantId, patientId: p.id, queueNumber: 1 } });
      await db.charge.create({ data: { visitId: v.id, source: 'OTHER', description: `${name} charge`, unitPrice: '10.00' } });
    }
  });

  const asTenant = <T>(tenantId: string | undefined, fn: () => Promise<T>) => tenantContext.run({ tenantId }, fn);

  it('shows a clinic only its own rows, even with no filter in the query', async () => {
    const { client } = appPrisma();
    const patients = await asTenant(a, () => client.patient.findMany({ where: { mrn: { startsWith: 'MRN-' }, firstName: { in: ['Alpha', 'Beta'] } } }));
    expect(patients.map((p) => p.firstName)).toEqual(['Alpha']);
    const tenants = await asTenant(a, () => client.tenant.findMany());
    expect(tenants.map((t) => t.id)).toEqual([a]);
  });

  it('covers child tables through their parent', async () => {
    const { client } = appPrisma();
    const charges = await asTenant(b, () => client.charge.findMany({ where: { description: { in: ['Alpha charge', 'Beta charge'] } } }));
    expect(charges.map((c) => c.description)).toEqual(['Beta charge']);
  });

  it('shows nothing when no clinic is set', async () => {
    const { client } = appPrisma();
    expect(await asTenant(undefined, () => client.patient.count())).toBe(0);
    expect(await asTenant(undefined, () => client.charge.count())).toBe(0);
  });

  it("refuses writes into another clinic's rows", async () => {
    const { client } = appPrisma();
    await expect(
      asTenant(a, () => client.patient.create({ data: { tenantId: b, mrn: 'MRN-sneaky', firstName: 'Sneaky', fatherName: 'X', sex: 'MALE', allergies: [] } })),
    ).rejects.toThrow();
    const beta = await db.patient.findFirstOrThrow({ where: { tenantId: b, firstName: 'Beta' } });
    const updated = await asTenant(a, () => client.patient.updateMany({ where: { id: beta.id }, data: { firstName: 'Hacked' } }));
    expect(updated.count).toBe(0);
    expect((await db.patient.findUniqueOrThrow({ where: { id: beta.id } })).firstName).toBe('Beta');
  });

  it('applies inside interactive transactions too', async () => {
    const { client } = appPrisma();
    const seen = await asTenant(b, () => client.$transaction(async (tx) => tx.patient.findMany({ where: { firstName: { in: ['Alpha', 'Beta'] } } })));
    expect(seen.map((p) => p.firstName)).toEqual(['Beta']);
  });

  it('keeps concurrent requests for different clinics apart', async () => {
    const { client } = appPrisma();
    const runs = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const t = i % 2 ? a : b;
        return asTenant(t, async () => ({ t, rows: await client.patient.findMany({ where: { firstName: { in: ['Alpha', 'Beta'] } } }) }));
      }),
    );
    for (const r of runs) expect(r.rows.map((p) => p.firstName)).toEqual([r.t === a ? 'Alpha' : 'Beta']);
  });
});
