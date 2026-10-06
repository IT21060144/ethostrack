/**
 * Unit tests for the Laplace mechanism (proposal Sections 11.3, 19).
 */
const {
  laplaceNoise,
  noisyCount,
  noisySum,
  noisyHistogram,
  partOfDay,
  cohortAggregates,
  trueAggregates,
  secureUniform,
} = require('../../privacy/differentialPrivacy');

const fixed = (u) => () => u;

function cohort(students, { minutes = 60, days = 4, weeks = 4 } = {}) {
  const sessions = [];
  for (let s = 0; s < students; s += 1) {
    for (let w = 0; w < weeks; w += 1) {
      for (let d = 0; d < days; d += 1) {
        const day = String(1 + w * 7 + d).padStart(2, '0');
        sessions.push({ pseudoId: `s${s}`, loginTime: `2026-09-${day}T03:30:00Z`, activeSeconds: minutes * 60 });
      }
    }
  }
  return sessions;
}

describe('laplaceNoise', () => {
  test('u = 0.5 is the centre of the distribution', () => {
    expect(laplaceNoise(3, fixed(0.5))).toBeCloseTo(0);
  });

  test('matches the Laplace inverse CDF', () => {
    // F^-1(u) = -b * sign(u - 0.5) * ln(1 - 2|u - 0.5|)
    expect(laplaceNoise(2, fixed(0.75))).toBeCloseTo(-2 * Math.log(0.5));
    expect(laplaceNoise(2, fixed(0.25))).toBeCloseTo(2 * Math.log(0.5));
  });

  test('zero scale adds no noise; negative scale is rejected', () => {
    expect(laplaceNoise(0, fixed(0.9))).toBeCloseTo(0);
    expect(() => laplaceNoise(-1)).toThrow();
  });

  test('secure samples have mean about 0 and mean absolute value about the scale', () => {
    const n = 20000;
    const scale = 4;
    let total = 0;
    let absolute = 0;
    for (let i = 0; i < n; i += 1) {
      const x = laplaceNoise(scale);
      total += x;
      absolute += Math.abs(x);
    }
    expect(Math.abs(total / n)).toBeLessThan(0.2);
    expect(absolute / n).toBeGreaterThan(scale * 0.93);
    expect(absolute / n).toBeLessThan(scale * 1.07);
  });

  test('secureUniform stays strictly inside (0, 1)', () => {
    for (let i = 0; i < 1000; i += 1) {
      const u = secureUniform();
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe('noisy queries', () => {
  test('a smaller epsilon means more noise', () => {
    const u = fixed(0.9);
    const strong = Math.abs(noisyCount(100, 0.1, u) - 100);
    const weak = Math.abs(noisyCount(100, 2, u) - 100);
    expect(strong).toBeGreaterThan(weak);
    expect(strong / weak).toBeCloseTo(20);
  });

  test('epsilon must be positive', () => {
    expect(() => noisyCount(1, 0)).toThrow(/epsilon/);
    expect(() => noisySum([1], 10, -1)).toThrow(/epsilon/);
  });

  test('values are clipped, which bounds one student\'s influence', () => {
    expect(noisySum([5000, 10, -3], 100, 1, fixed(0.5))).toBeCloseTo(110);
  });

  test('histograms are rounded and never negative', () => {
    const h = noisyHistogram(['a', 'a', 'b'], ['a', 'b', 'c'], 1, fixed(0.001));
    expect(h).toEqual({ a: 0, b: 0, c: 0 });
    expect(noisyHistogram(['a', 'a', 'b'], ['a', 'b', 'c'], 1, fixed(0.5))).toEqual({ a: 2, b: 1, c: 0 });
  });

  test('parts of the day', () => {
    expect(partOfDay(2)).toBe('night');
    expect(partOfDay(9)).toBe('morning');
    expect(partOfDay(15)).toBe('afternoon');
    expect(partOfDay(21)).toBe('evening');
  });
});

describe('cohortAggregates', () => {
  test('with no noise it returns the true statistics', () => {
    // 03:30 UTC is 09:00 in Sri Lanka: a morning start
    const sessions = cohort(10, { minutes: 60, days: 4, weeks: 4 });
    const result = cohortAggregates(sessions, { epsilon: 1, weeks: 4, timeZone: 'Asia/Colombo', rng: fixed(0.5) });
    expect(result.suppressed).toBe(false);
    expect(result.students).toBe(10);
    expect(result.meanWeeklyStudyMinutes).toBe(240);
    expect(result.studyDaysPerWeek['4']).toBe(10);
    expect(result.usualStartTime.morning).toBe(10);
    expect(trueAggregates(sessions, { weeks: 4 }).meanWeeklyStudyMinutes).toBe(240);
  });

  test('the total epsilon is split across the four queries', () => {
    const result = cohortAggregates(cohort(10), { epsilon: 2, rng: fixed(0.5) });
    expect(result.privacy).toMatchObject({ mechanism: 'Laplace', epsilon: 2, epsilonPerQuery: 0.5, queries: 4 });
  });

  test('a group smaller than k is suppressed', () => {
    const result = cohortAggregates(cohort(3), { epsilon: 1, k: 5, rng: fixed(0.5) });
    expect(result.suppressed).toBe(true);
    expect(result.students).toBeUndefined();
    expect(result.meanWeeklyStudyMinutes).toBeUndefined();
  });

  test('released numbers contain no identifiers', () => {
    const result = cohortAggregates(cohort(10), { epsilon: 1 });
    expect(JSON.stringify(result)).not.toMatch(/s\d/);
  });

  test('the noisy mean stays close to the truth for a reasonable epsilon', () => {
    const sessions = cohort(200, { minutes: 90, days: 3, weeks: 4 });
    const errors = [];
    for (let i = 0; i < 50; i += 1) {
      const r = cohortAggregates(sessions, { epsilon: 1, weeks: 4 });
      errors.push(Math.abs(r.meanWeeklyStudyMinutes - 270));
    }
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(meanError).toBeLessThan(270 * 0.15);
  });
});
