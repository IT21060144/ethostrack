/**
 * Unit tests for generalisation and k-anonymity (proposal Sections 11.3, 19).
 */
const {
  LEVELS,
  anonymiseSessions,
  generaliseSlot,
  generaliseBand,
  generalisePeriod,
  reidentificationRisk,
} = require('../../privacy/kAnonymity');

const at = (iso, minutes, pseudoId, endReason = 'explicit') => ({
  pseudoId,
  loginTime: iso,
  activeSeconds: minutes * 60,
  endReason,
});

/** students x days, each studying at a slightly different minute and length. */
function cohort(students, days, { hour = 9, minutes = 60 } = {}) {
  const sessions = [];
  for (let s = 0; s < students; s += 1) {
    for (let d = 1; d <= days; d += 1) {
      const day = String(d).padStart(2, '0');
      const minute = String((s * 7 + d) % 60).padStart(2, '0');
      sessions.push(at(`2026-09-${day}T${String(hour).padStart(2, '0')}:${minute}:00Z`, minutes + ((s + d) % 13), `student-${s}`));
    }
  }
  return sessions;
}

describe('generalisation hierarchy', () => {
  test('start time becomes a block of hours', () => {
    expect(generaliseSlot(9.75, 1)).toBe('09:00-09:59');
    expect(generaliseSlot(9.75, 4)).toBe('08:00-11:59');
    expect(generaliseSlot(23.5, 12)).toBe('12:00-23:59');
  });

  test('duration becomes a band, with one open band at the top', () => {
    expect(generaliseBand(47, 15)).toBe('45-59');
    expect(generaliseBand(47, 60)).toBe('0-59');
    expect(generaliseBand(230, 60)).toBe('180-239');
    expect(generaliseBand(500, 15)).toBe('240+');
  });

  test('period becomes a day, the week (from Monday) or the month', () => {
    expect(generalisePeriod('2026-09-10', 'day')).toBe('2026-09-10');
    expect(generalisePeriod('2026-09-10', 'week')).toBe('week of 2026-09-07');
    expect(generalisePeriod('2026-09-10', 'month')).toBe('2026-09');
  });

  test('every level is at least as coarse as the one before', () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i].slotHours).toBeGreaterThanOrEqual(LEVELS[i - 1].slotHours);
      expect(LEVELS[i].bandMinutes).toBeGreaterThanOrEqual(LEVELS[i - 1].bandMinutes);
    }
  });
});

describe('anonymiseSessions', () => {
  test('every released group holds at least k distinct students', () => {
    const sessions = cohort(12, 20);
    const { rows, report } = anonymiseSessions(sessions, { k: 5, timeZone: 'UTC' });
    expect(report.achievedK).toBeGreaterThanOrEqual(5);
    expect(report.released).toBe(rows.length);
    expect(report.released + report.suppressed).toBe(sessions.length);
    expect(report.suppressionRate).toBeLessThanOrEqual(0.05);

    // Recount from the input: rows in one class must come from >= k students
    const level = LEVELS[report.level];
    const { generaliseRecord } = require('../../privacy/kAnonymity');
    const students = new Map();
    for (const s of sessions) {
      const r = generaliseRecord(s, level, 'UTC');
      const key = `${r.period}|${r.start_slot}|${r.active_band}`;
      if (!students.has(key)) students.set(key, new Set());
      students.get(key).add(s.pseudoId);
    }
    for (const row of rows) {
      const key = `${row.period}|${row.start_slot}|${row.active_band}`;
      expect(students.get(key).size).toBeGreaterThanOrEqual(5);
    }
  });

  test('released rows carry no pseudoId, exact time or idle time', () => {
    const { rows } = anonymiseSessions(cohort(10, 10), { k: 3, timeZone: 'UTC' });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['active_band', 'end_reason', 'period', 'start_slot']);
    }
  });

  test('k counts people: one student with many sessions cannot form a group alone', () => {
    const sessions = [];
    for (let i = 0; i < 30; i += 1) sessions.push(at(`2026-09-10T09:${String(i).padStart(2, '0')}:00Z`, 60, 'heavy-studier'));
    const { rows, report } = anonymiseSessions(sessions, { k: 2, timeZone: 'UTC' });
    expect(rows).toHaveLength(0);
    expect(report.suppressed).toBe(30);
    expect(report.achievedK).toBeNull();
  });

  test('an outlier session is suppressed rather than released', () => {
    const sessions = cohort(10, 7);
    sessions.push(at('2026-09-03T03:10:00Z', 400, 'night-owl'));
    const { rows, report } = anonymiseSessions(sessions, { k: 5, timeZone: 'UTC' });
    expect(report.suppressed).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.start_slot.startsWith('00:00') || r.start_slot.startsWith('03:00'))).toBeUndefined();
  });

  test('larger k needs a coarser level', () => {
    const sessions = cohort(20, 14);
    const small = anonymiseSessions(sessions, { k: 2, timeZone: 'UTC' }).report;
    const large = anonymiseSessions(sessions, { k: 15, timeZone: 'UTC' }).report;
    expect(large.level).toBeGreaterThanOrEqual(small.level);
    expect(large.achievedK).toBeGreaterThanOrEqual(15);
  });

  test('reports l-diversity of end_reason', () => {
    const sessions = cohort(10, 5).map((s, i) => ({ ...s, endReason: i % 2 ? 'timeout' : 'explicit' }));
    const { report } = anonymiseSessions(sessions, { k: 3, timeZone: 'UTC' });
    expect(report.lDiversity).toBeGreaterThanOrEqual(1);
    expect(report.lDiversity).toBeLessThanOrEqual(3);
  });

  test('empty input releases nothing', () => {
    const { rows, report } = anonymiseSessions([], { k: 5 });
    expect(rows).toEqual([]);
    expect(report.records).toBe(0);
    expect(report.suppressionRate).toBe(0);
  });

  test('invalid k is rejected', () => {
    expect(() => anonymiseSessions([], { k: 0 })).toThrow(/k must be/);
    expect(() => anonymiseSessions([], { k: 2.5 })).toThrow(/k must be/);
  });
});

describe('simulated linkage attack', () => {
  test('raw rows identify almost everyone; the k-anonymous release caps the risk at 1/k', () => {
    const sessions = cohort(15, 14);
    const raw = reidentificationRisk(sessions, { timeZone: 'UTC' });
    const { report } = anonymiseSessions(sessions, { k: 5, timeZone: 'UTC' });
    const safe = reidentificationRisk(sessions, { levelSpec: LEVELS[report.level], k: 5, timeZone: 'UTC' });

    expect(raw.uniqueShare).toBeGreaterThan(0.9);
    expect(safe.uniqueShare).toBe(0);
    expect(safe.averageRisk).toBeLessThanOrEqual(1 / 5);
    expect(safe.averageRisk).toBeLessThan(raw.averageRisk);
  });

  test('no sessions means no risk', () => {
    expect(reidentificationRisk([])).toEqual({ averageRisk: 0, uniqueShare: 0 });
  });
});
