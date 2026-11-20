/** Age bands used for the OPD tables; review against the Regional Health Bureau's current form. */
export const AGE_GROUPS = [
  { key: '<1', min: 0, max: 0 },
  { key: '1-4', min: 1, max: 4 },
  { key: '5-14', min: 5, max: 14 },
  { key: '15-29', min: 15, max: 29 },
  { key: '30-64', min: 30, max: 64 },
  { key: '65+', min: 65, max: 200 },
] as const;

export function ageAt(dob: Date | null, at: Date): number | null {
  if (!dob) return null;
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = at.getUTCMonth() < dob.getUTCMonth() || (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age--;
  return Math.max(0, age);
}

export function ageGroup(age: number | null) {
  if (age === null) return 'unknown';
  return AGE_GROUPS.find((g) => age >= g.min && age <= g.max)?.key ?? 'unknown';
}
