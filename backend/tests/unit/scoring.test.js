/**
 * Unit tests for the Consistency Scoring Framework (proposal Sections 16.4
 * and 16.5): the worked example, boundary cases and monotonicity.
 */
const { calculateMetrics, aggregateDays, buildWindow, addDays } = require('../../controllers/scoreController');

const WEEK = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];

function summary(entries) {
  return new Map(entries.map(([day, minutes, hour]) => [day, { activeMinutes: minutes, firstLoginHour: hour }]));
}

function score(entries, goals = { targetDaysPerWeek: 4, plannedMinutesPerDay: 90, minMinutesPerDay: 30 }) {
  return calculateMetrics({ dailySummary: summary(entries), goals, weeks: 1, windowDays: WEEK });
}

describe('worked example (proposal 16.4)', () => {
  test('steady student: 80, 100, 60 and 90 minutes, start-time spread of 1 hour scores about 90', () => {
    // First logins 8, 10, 8, 10 h: population standard deviation exactly 1 hour
    const result = score([
      [WEEK[0], 80, 8],
      [WEEK[1], 100, 10],
      [WEEK[3], 60, 8],
      [WEEK[4], 90, 10],
    ]);
    expect(result.components).toEqual({ R: 1, A: 0.92, S: 0.82, H: 0.75 });
    expect(result.score).toBe(90);
    expect(result.band).toBe('Consistent');
  });

  test('same 330 minutes crammed into one night scores about 36', () => {
    const result = score([[WEEK[6], 330, 22]]);
    expect(result.components).toEqual({ R: 0.25, A: 0.92, S: 0, H: 0 });
    expect(result.score).toBe(36);
    expect(result.band).toBe('Building');
  });
});

describe('boundary cases (proposal 16.5)', () => {
  test('no sessions gives 0', () => {
    const result = score([]);
    expect(result.score).toBe(0);
    expect(result.summary.studyDaysCount).toBe(0);
  });

  test('one session: stability and rhythm need two days, so they are 0', () => {
    const result = score([[WEEK[2], 60, 9]]);
    expect(result.components.S).toBe(0);
    expect(result.components.H).toBe(0);
    expect(result.components.R).toBe(0.25);
  });

  test('a day below the minimum minutes does not count as a study day', () => {
    const result = score([[WEEK[0], 29, 9], [WEEK[1], 30, 9]]);
    expect(result.summary.studyDaysCount).toBe(1);
  });

  test('without a planned-minutes goal, adherence is left out and weights rescale', () => {
    const result = score([[WEEK[0], 60, 9], [WEEK[1], 60, 9], [WEEK[2], 60, 9], [WEEK[3], 60, 9]], {
      targetDaysPerWeek: 4,
      minMinutesPerDay: 30,
    });
    expect(result.components.A).toBeUndefined();
    expect(result.score).toBe(100);
  });

  test('rest days are removed from the window', () => {
    const goals = { targetDaysPerWeek: 4, plannedMinutesPerDay: 60, minMinutesPerDay: 30, restDays: [WEEK[5], WEEK[6]] };
    const result = score([[WEEK[6], 120, 9]], goals);
    expect(result.summary.trackedDaysCount).toBe(5);
    expect(result.summary.studyDaysCount).toBe(0);
  });

  test('score always stays between 0 and 100', () => {
    const result = score(WEEK.map((d) => [d, 600, 9]));
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('monotonicity (proposal 16.5)', () => {
  test('adding a study day never lowers regularity', () => {
    const entries = [];
    let previous = -1;
    for (let i = 0; i < WEEK.length; i += 1) {
      entries.push([WEEK[i], 45 + i * 5, 9 + (i % 2)]);
      const { R } = score(entries).components;
      expect(R).toBeGreaterThanOrEqual(previous);
      previous = R;
    }
  });

  test('more total minutes never lowers adherence', () => {
    let previous = -1;
    for (const minutes of [30, 60, 90, 120, 200]) {
      const { A } = score([[WEEK[0], minutes, 9], [WEEK[2], minutes, 9]]).components;
      expect(A).toBeGreaterThanOrEqual(previous);
      previous = A;
    }
  });
});

describe('windows and local days', () => {
  test('week window starts on Monday', () => {
    const w = buildWindow({ window: 'week', date: '2026-09-10', timeZone: 'UTC' });
    expect(w.start).toBe('2026-09-07');
    expect(w.days).toHaveLength(7);
  });

  test('rolling window covers 28 days ending on the date', () => {
    const w = buildWindow({ window: 'rolling', date: '2026-09-28', timeZone: 'UTC' });
    expect(w.days).toHaveLength(28);
    expect(w.end).toBe('2026-09-28');
    expect(w.start).toBe(addDays('2026-09-28', -27));
  });

  test('invalid window or date is a 400 error', () => {
    expect(() => buildWindow({ window: 'year', date: '2026-09-10', timeZone: 'UTC' })).toThrow(/window/);
    expect(() => buildWindow({ window: 'week', date: '10/09/2026', timeZone: 'UTC' })).toThrow(/date/);
  });

  test('sessions are grouped by the local day of the student', () => {
    // 20:00 UTC on 9 Sep is 01:30 on 10 Sep in Sri Lanka
    const sessions = [{ loginTime: '2026-09-09T20:00:00Z', activeSeconds: 3600 }];
    const days = aggregateDays(sessions, WEEK, 'Asia/Colombo');
    expect([...days.keys()]).toEqual(['2026-09-10']);
    expect(days.get('2026-09-10').firstLoginHour).toBeCloseTo(1.5);
  });
});
