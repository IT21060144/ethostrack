/**
 * Unit tests for the statistics used by scripts/evaluate.js, and for the
 * custom weights the ablations rely on.
 */
const { spearman, ranks, seededRandom } = require('../../scripts/evaluate');
const { calculateMetrics } = require('../../controllers/scoreController');

test('ranks give tied values their average rank', () => {
  expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
});

test('Spearman is 1 for the same order, -1 for the reverse, and ignores scale', () => {
  expect(spearman([1, 2, 3, 4], [10, 200, 3000, 40000])).toBeCloseTo(1);
  expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
});

test('the seeded generator repeats and stays inside (0, 1)', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  for (let i = 0; i < 1000; i += 1) {
    const x = a();
    expect(x).toBe(b());
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
  }
});

test('custom weights change the score; a zero weight removes a component', () => {
  const week = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
  const dailySummary = new Map([[week[0], { activeMinutes: 60, firstLoginHour: 9 }], [week[1], { activeMinutes: 60, firstLoginHour: 9 }]]);
  const goals = { targetDaysPerWeek: 4, plannedMinutesPerDay: 60, minMinutesPerDay: 30 };
  const onlyR = calculateMetrics({ dailySummary, goals, weeks: 1, windowDays: week, weights: { R: 1, A: 0, S: 0, H: 0 } });
  expect(onlyR.score).toBe(50); // 2 of 4 target days
  const full = calculateMetrics({ dailySummary, goals, weeks: 1, windowDays: week });
  expect(full.score).not.toBe(onlyR.score);
});
