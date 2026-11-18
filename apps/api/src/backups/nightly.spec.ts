import { backupName, backupTime, lastScheduled, nightlyFromEnv, prunable } from './nightly.js';

const DAY = 86_400_000;
const obj = (at: Date) => ({ key: `hmis-backups/${backupName(at)}`, size: 1, lastModified: at.toISOString() });

describe('nightly backup: names', () => {
  it('names a copy by its UTC time and reads the time back', () => {
    const at = new Date('2026-11-19T02:03:04.567Z');
    expect(backupName(at)).toBe('hmis-2026-11-19T020304Z.hmisdump.gz.age');
    expect(backupTime(`x/${backupName(at)}`)?.toISOString()).toBe('2026-11-19T02:03:04.000Z');
    expect(backupTime('x/notes.txt')).toBeNull();
  });
});

describe('nightly backup: which copies are kept', () => {
  const now = new Date('2026-11-19T02:00:00Z');
  // One copy a night for 400 nights.
  const nights = Array.from({ length: 400 }, (_, i) => obj(new Date(now.getTime() - i * DAY)));

  it('keeps every night of the last 30 days and the first copy of each of the last 12 months', () => {
    const gone = new Set(prunable(nights, now, 30, 12).map((o) => o.key));
    const kept = nights.filter((o) => !gone.has(o.key)).map((o) => backupTime(o.key)!);
    const recent = kept.filter((d) => now.getTime() - d.getTime() <= 30 * DAY);
    expect(recent).toHaveLength(31); // today and the 30 nights before
    const older = kept.filter((d) => now.getTime() - d.getTime() > 30 * DAY);
    // Months before the 30 days, back to December 2025 (12 months including this one): each its 1st.
    expect(older.map((d) => d.toISOString().slice(0, 10)).sort()).toEqual(
      ['2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].sort(),
    );
  });

  it('always keeps the newest copy, never touches other files, and does nothing with no copies', () => {
    const old = obj(new Date(now.getTime() - 900 * DAY));
    expect(prunable([old], now, 1, 0)).toEqual([]);
    const other = { key: 'hmis-backups/readme.txt', size: 1, lastModified: '' };
    expect(prunable([other, old, obj(now)], now, 1, 0).map((o) => o.key)).toEqual([old.key]);
    expect(prunable([], now, 30, 12)).toEqual([]);
  });
});

describe('nightly backup: when it is due', () => {
  it('is due from today at the hour, or yesterday at the hour before then', () => {
    const at = (h: number) => {
      const d = new Date(2026, 10, 19, h, 30);
      return lastScheduled(d, 2);
    };
    expect(at(3).getDate()).toBe(19);
    expect(at(3).getHours()).toBe(2);
    expect(at(1).getDate()).toBe(18);
  });
});

describe('nightly backup: settings', () => {
  const base = { HMIS_BACKUP_RECIPIENT: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq', S3_BUCKET: 'b', AWS_ENDPOINT_URL_S3: 'https://s3.example.et', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' };

  it('is off without a public key or a bucket', () => {
    expect(nightlyFromEnv({})).toBeNull();
    expect(nightlyFromEnv({ ...base, HMIS_BACKUP_RECIPIENT: '' })).toBeNull();
    expect(nightlyFromEnv({ ...base, S3_BUCKET: '' })).toBeNull();
  });

  it("takes AletCloud's bucket settings and defaults", () => {
    const cfg = nightlyFromEnv(base)!;
    expect(cfg).toMatchObject({ prefix: 'hmis-backups/', hour: 2, keepDays: 30, keepMonths: 12, site: 's3.example.et/b' });
    expect(cfg.s3).toMatchObject({ endpoint: 'https://s3.example.et', bucket: 'b', region: 'us-east-1' });
  });

  it('refuses a secret key or anything else in place of the public key', () => {
    expect(() => nightlyFromEnv({ ...base, HMIS_BACKUP_RECIPIENT: 'AGE-SECRET-KEY-1ABC' })).toThrow(/not an age public key/);
  });
});
