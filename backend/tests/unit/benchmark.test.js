/**
 * Unit tests for the competitor measures rebuilt in scripts/benchmark.js.
 */
const { loopHabitStrength, currentStreak, focusBlocksPerWeek, atRiskAuc } = require('../../scripts/benchmark');

const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
const byDay = (minutes) => new Map(days.map((d, i) => [d, minutes[i]]));

test('Loop habit strength follows the uhabits formula for a 4-times-a-week habit', () => {
  const multiplier = 0.5 ** (Math.sqrt(4 / 7) / 13);
  // One day done: 1 of the 8 needed in the 14-day window
  expect(loopHabitStrength(byDay([45, 0, 0, 0]), days.slice(0, 1))).toBeCloseTo(100 * (1 / 8) * (1 - multiplier));
  // Nothing done keeps the score at 0, and a 29-minute day does not count
  expect(loopHabitStrength(byDay([29, 0, 0, 0]), days)).toBe(0);
});

test('Loop habit strength approaches 100 when the habit is always done', () => {
  const many = Array.from({ length: 400 }, (_, i) => `d${i}`);
  expect(loopHabitStrength(new Map(many.map((d) => [d, 60])), many)).toBeGreaterThan(99);
});

test('current streak counts back from the last day and forgives an unfinished last day', () => {
  expect(currentStreak(byDay([40, 0, 40, 40]), days, '2026-09-04')).toBe(2);
  expect(currentStreak(byDay([40, 40, 40, 0]), days, '2026-09-04')).toBe(3);
  expect(currentStreak(byDay([40, 40, 0, 40]), days, '2026-09-03')).toBe(2);
});

test('focus blocks count only uninterrupted 25-minute stretches of active time', () => {
  // Segments alternate active, idle, active: 50 min active, 5 min idle, 20 min active
  expect(focusBlocksPerWeek([{ activeSeconds: 4200, segments: [3000, 300, 1200] }], 1)).toBe(2);
});

test('at-risk AUC is 1 for a perfect split, 0.5 for no information', () => {
  expect(atRiskAuc([1, 2, 8, 9], [true, true, false, false])).toBe(1);
  expect(atRiskAuc([5, 5, 5, 5], [true, true, false, false])).toBe(0.5);
});
