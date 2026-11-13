import { westgard } from './qc.js';

describe('westgard', () => {
  it('passes a run near the mean', () => {
    expect(westgard(0.4, [-0.2, 1.1])).toEqual({ status: 'PASS', rule: null });
  });

  it('warns at 1-2s and fails at 1-3s', () => {
    expect(westgard(2.4, [0.1])).toEqual({ status: 'WARN', rule: '1-2s' });
    expect(westgard(-3.2, [])).toEqual({ status: 'FAIL', rule: '1-3s' });
  });

  it('fails two runs in a row beyond 2 SD on the same side (2-2s), not on opposite sides', () => {
    expect(westgard(2.3, [2.1])).toEqual({ status: 'FAIL', rule: '2-2s' });
    expect(westgard(2.3, [-2.1])).toEqual({ status: 'WARN', rule: '1-2s' });
  });

  it('fails when two levels today are beyond 2 SD in opposite directions (R-4s)', () => {
    expect(westgard(2.2, [0.3], [-2.5])).toEqual({ status: 'FAIL', rule: 'R-4s' });
    expect(westgard(2.2, [0.3], [2.5])).toEqual({ status: 'WARN', rule: '1-2s' });
  });

  it('fails four runs beyond 1 SD on one side (4-1s) and ten on one side of the mean (10x)', () => {
    expect(westgard(1.2, [1.5, 1.1, 1.8])).toEqual({ status: 'FAIL', rule: '4-1s' });
    expect(westgard(1.2, [1.5, 0.9, 1.8])).toEqual({ status: 'PASS', rule: null });
    expect(westgard(0.3, [0.5, 0.2, 0.8, 0.1, 0.4, 0.6, 0.3, 0.2, 0.7])).toEqual({ status: 'FAIL', rule: '10x' });
    expect(westgard(0.3, [0.5, 0.2, 0.8, -0.1, 0.4, 0.6, 0.3, 0.2, 0.7])).toEqual({ status: 'PASS', rule: null });
  });
});
