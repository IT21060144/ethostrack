/**
 * Charts — small dependency-free SVG charts for the dashboard
 * ---------------------------------------------------------------------------
 * - ScoreRing:        the 0–100 consistency score as a ring
 * - HoursBarChart:    study hours per day, with the daily goal as a dashed line
 * - ScoreTrendChart:  the weekly consistency score over recent weeks
 *
 * Each chart measures its container and draws at real pixel size, so text
 * stays readable on phones. Hovering (or tapping) a bar or point shows a
 * tooltip with the exact value.
 */
import React, { useEffect, useRef, useState } from 'react';

// Width of the element, kept up to date as the window resizes
const useWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

// A rounded-top bar path anchored to the baseline
const barPath = (x, y, w, h, r) => {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

// Picks 3–5 tidy tick values from 0 to at least max
const niceTicks = (max, count = 4) => {
  const safeMax = Math.max(max, 1);
  const rawStep = safeMax / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep);
  const top = Math.ceil(safeMax / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
};

export const formatHours = (hours) => {
  const totalMinutes = Math.round((hours || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/* ------------------------------------------------------------------ */
export const ScoreRing = ({ score = 0, color = 'var(--brand-600)', size = 132 }) => {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Consistency score ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#edeff5" strokeWidth={stroke} />
      {pct > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      )}
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 34, fontWeight: 800, fill: 'var(--ink)' }}>
        {score}
      </text>
      <text x="50%" y="68%" textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: 'var(--ink-3)' }}>
        out of 100
      </text>
    </svg>
  );
};

/* ------------------------------------------------------------------ */
// days: [{ key, label, sublabel, hours, isToday }] oldest first
export const HoursBarChart = ({ days, goalHours, height = 230 }) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const pad = { top: 16, right: goalHours > 0 ? 56 : 8, bottom: 40, left: 36 };
  const innerW = Math.max(width - pad.left - pad.right, 0);
  const innerH = height - pad.top - pad.bottom;
  const maxValue = Math.max(...days.map((d) => d.hours), goalHours || 0, 0.5);
  const ticks = niceTicks(maxValue);
  const top = ticks[ticks.length - 1];
  const y = (v) => pad.top + innerH - (v / top) * innerH;

  const slot = days.length ? innerW / days.length : 0;
  const barW = Math.max(Math.min(slot * 0.62, 34), 4);
  // Show every label when there is room, otherwise every other one
  const labelEvery = slot < 30 ? 2 : 1;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Study hours per day">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text className="axis-label" x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t}h
              </text>
            </g>
          ))}

          {days.map((d, i) => {
            const x = pad.left + slot * i + (slot - barW) / 2;
            const barTop = y(d.hours);
            const isDim = hover !== null && hover !== i;
            return (
              <g key={d.key}>
                <path
                  className={`bar${d.isToday ? ' today' : ''}${isDim ? ' is-dim' : ''}`}
                  d={barPath(x, barTop, barW, pad.top + innerH - barTop, 4)}
                />
                {i % labelEvery === 0 && (
                  <>
                    <text
                      className="axis-label"
                      x={x + barW / 2}
                      y={height - pad.bottom + 16}
                      textAnchor="middle"
                      style={d.isToday ? { fontWeight: 700, fill: 'var(--ink)' } : undefined}
                    >
                      {d.label}
                    </text>
                    {d.sublabel && (
                      <text className="axis-label" x={x + barW / 2} y={height - pad.bottom + 30} textAnchor="middle" style={{ fontSize: 10 }}>
                        {d.sublabel}
                      </text>
                    )}
                  </>
                )}
                {/* Hit area larger than the bar, so thin bars are easy to hover */}
                <rect
                  className="bar-hit"
                  x={pad.left + slot * i}
                  y={pad.top}
                  width={slot}
                  height={innerH}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(i)}
                />
              </g>
            );
          })}

          {goalHours > 0 && (
            <g pointerEvents="none">
              <line className="goal-line" x1={pad.left} x2={width - pad.right + 4} y1={y(goalHours)} y2={y(goalHours)} />
              <text className="goal-label" x={width - pad.right + 8} y={y(goalHours) - 6}>
                Goal
              </text>
              <text className="goal-label" x={width - pad.right + 8} y={y(goalHours) + 9} style={{ fontWeight: 500 }}>
                {formatHours(goalHours)}
              </text>
            </g>
          )}

          <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="var(--border-strong)" />
        </svg>
      )}

      {hover !== null && days[hover] && (
        <div className="chart-tip" style={{ left: pad.left + slot * hover + slot / 2, top: y(days[hover].hours) }}>
          <strong>{formatHours(days[hover].hours)}</strong>
          {days[hover].tooltip}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
// points: [{ key, label, score, tooltip }] oldest first; score may be null
export const ScoreTrendChart = ({ points, height = 230 }) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const innerW = Math.max(width - pad.left - pad.right, 0);
  const innerH = height - pad.top - pad.bottom;
  const ticks = [0, 25, 50, 75, 100];
  const y = (v) => pad.top + innerH - (v / 100) * innerH;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i) => pad.left + step * i;

  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.score !== null && p.score !== undefined);
  const linePath = valid.map((p, n) => `${n ? 'L' : 'M'}${x(p.i)},${y(p.score)}`).join(' ');
  const areaPath = valid.length > 1 ? `${linePath} L${x(valid[valid.length - 1].i)},${y(0)} L${x(valid[0].i)},${y(0)} Z` : '';

  // Nearest point to the pointer, for the crosshair
  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = step ? Math.round((px - pad.left) / step) : 0;
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Weekly consistency score"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="scoreArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text className="axis-label" x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.key} className="axis-label" x={x(i)} y={height - 8} textAnchor="middle">
              {p.label}
            </text>
          ))}
          {areaPath && <path className="area" d={areaPath} />}
          {linePath && <path className="line" d={linePath} />}
          {hovered && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} />}
          {valid.map((p) => (
            <circle key={p.key} className="point" cx={x(p.i)} cy={y(p.score)} r={hover === p.i ? 6 : 4.5} />
          ))}
          {/* Direct label on the latest week only */}
          {valid.length > 0 && hover === null && (
            <text
              x={x(valid[valid.length - 1].i)}
              y={y(valid[valid.length - 1].score) - 12}
              textAnchor="middle"
              style={{ fontSize: 12, fontWeight: 700, fill: 'var(--ink)' }}
            >
              {valid[valid.length - 1].score}
            </text>
          )}
        </svg>
      )}
      {hovered && (
        <div className="chart-tip" style={{ left: x(hover), top: y(hovered.score ?? 0) }}>
          <strong>{hovered.score === null || hovered.score === undefined ? 'No data' : `Score ${hovered.score}`}</strong>
          {hovered.tooltip}
        </div>
      )}
    </div>
  );
};
