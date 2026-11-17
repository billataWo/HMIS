import { addMonths, scheduleFor } from './schedule.js';

const at = (s: ReturnType<typeof scheduleFor>, label: string) => s.find((d) => d.label === label)!;

describe('immunization schedule', () => {
  const today = '2026-11-14';
  const baby = { dob: '2026-09-01', sex: 'MALE' as const }; // 10 weeks and 4 days old

  it('works out what is due, late, upcoming and past its window', () => {
    const s = scheduleFor(baby, [], today);
    expect(at(s, 'BCG')).toMatchObject({ status: 'OVERDUE', dueOn: '2026-09-01' });
    expect(at(s, 'OPV 0')).toMatchObject({ status: 'MISSED' }); // only in the first 14 days
    expect(at(s, 'Penta 1')).toMatchObject({ status: 'OVERDUE', dueOn: '2026-10-13' });
    expect(at(s, 'Penta 2')).toMatchObject({ status: 'DUE', dueOn: '2026-11-10', waitingFor: 'Penta 1' });
    expect(at(s, 'Measles 1')).toMatchObject({ status: 'UPCOMING', dueOn: '2027-06-01' });
    expect(at(s, 'Vitamin A 1')).toMatchObject({ status: 'UPCOMING', dueOn: '2027-03-01' });
    expect(s.some((d) => d.vaccine === 'HPV' || d.vaccine === 'TD')).toBe(false);
  });

  it('spaces a series from the dose before', () => {
    const s = scheduleFor(baby, [{ id: 'a', vaccine: 'PENTA', doseNo: 1, givenOn: '2026-11-01' }], today);
    expect(at(s, 'Penta 1').status).toBe('GIVEN');
    // 28 days after Penta 1, later than the 10-week date.
    expect(at(s, 'Penta 2')).toMatchObject({ status: 'UPCOMING', dueOn: '2026-11-29', notBefore: '2026-11-29', waitingFor: null });
  });

  it('gives women Td and girls HPV, never overdue; nothing for an adult man', () => {
    const woman = scheduleFor({ dob: '2001-05-10', sex: 'FEMALE' }, [], today);
    expect(woman.map((d) => d.label)).toEqual(['Td 1', 'Td 2', 'Td 3', 'Td 4', 'Td 5']);
    expect(at(woman, 'Td 1').status).toBe('DUE');
    expect(at(woman, 'Td 2').waitingFor).toBe('Td 1');
    const girl = scheduleFor({ dob: addMonths(today, -12 * 12), sex: 'FEMALE' }, [], today);
    expect(at(girl, 'HPV')).toMatchObject({ status: 'UPCOMING', notBefore: addMonths(today, -12 * 12 + 108) });
    expect(scheduleFor({ dob: '1990-01-01', sex: 'MALE' }, [], today)).toEqual([]);
  });

  it('still shows a vaccine already recorded, whatever the age', () => {
    const s = scheduleFor({ dob: '2015-01-01', sex: 'MALE' }, [{ id: 'x', vaccine: 'MCV', doseNo: 1, givenOn: '2015-10-01' }], today);
    expect(at(s, 'Measles 1').status).toBe('GIVEN');
    expect(at(s, 'Measles 2').status).toBe('OVERDUE');
  });
});
