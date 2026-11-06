"use client";

import { useMemo, useState, type ReactNode } from "react";

import { fmtNumber } from "@/lib/format";

/**
 * Small hand-built SVG charts. One series each, so the title names the series and no
 * legend is needed. Marks follow the data-viz spec: 2px line, >=8px markers, recessive
 * grid, text in text colours (never the series colour), and a hover layer on every mark.
 */

export interface TrendPoint {
  key: string;
  label: string;
  value: number;
  detail?: ReactNode;
  hollow?: boolean;
}

export function TrendLine({
  points,
  height = 220,
  valueLabel,
}: {
  points: TrendPoint[];
  height?: number;
  valueLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 960;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  // A line encodes position, not length, so the axis can start above zero; the domain
  // hugs the data so a change of ten findings is visible.
  const { min, max, ticks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const hi = Math.max(1, ...values);
    const lo = Math.min(...values);
    const step = niceStep(Math.max(1, (hi - lo) / 4));
    const bottom = Math.max(0, Math.floor((lo - step / 2) / step) * step);
    const top = Math.ceil((hi + step / 2) / step) * step;
    const t: number[] = [];
    for (let v = bottom; v <= top; v += step) t.push(v);
    return { min: bottom, max: top, ticks: t };
  }, [points]);

  if (points.length === 0) return null;
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min || 1)) * innerH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${valueLabel} over time`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {fmtNumber(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          // Thin the axis labels so they never collide; the hovered point always shows its own.
          const every = Math.ceil(points.length / 10);
          if (i % every !== 0 && i !== points.length - 1 && hover !== i) return null;
          return (
            <text
              key={p.key}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill={hover === i ? "var(--text)" : "var(--text-3)"}
            >
              {p.label}
            </text>
          );
        })}
        {active && hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="var(--border-strong)"
            strokeDasharray="3 3"
          />
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={p.key}
            cx={x(i)}
            cy={y(p.value)}
            r={hover === i ? 5 : 4}
            fill={p.hollow ? "var(--surface)" : "var(--series-1)"}
            stroke={p.hollow ? "var(--series-1)" : "var(--surface)"}
            strokeWidth="2"
          />
        ))}
        {/* Hit targets wider than the marks: one vertical band per point. */}
        {points.map((p, i) => {
          const half = points.length > 1 ? innerW / (points.length - 1) / 2 : innerW / 2;
          return (
            <rect
              key={p.key}
              x={x(i) - half}
              y={pad.top}
              width={half * 2}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              aria-label={`${p.label}: ${p.value} ${valueLabel}`}
            />
          );
        })}
      </svg>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-72 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] shadow-md"
          style={{
            left: `clamp(0px, calc(${(x(hover) / width) * 100}% - 144px), calc(100% - 288px))`,
          }}
        >
          <div className="font-medium text-fg">{active.label}</div>
          <div className="tabular text-fg-2">
            {fmtNumber(active.value)} {valueLabel}
          </div>
          {active.detail && <div className="mt-1.5 border-t border-line pt-1.5">{active.detail}</div>}
        </div>
      )}
    </div>
  );
}

export function BarList({
  items,
  format = fmtNumber,
  max,
  emptyLabel = "No data",
  labelWidth = "13rem",
}: {
  items: { key: string; label: ReactNode; value: number; sub?: ReactNode; href?: string }[];
  format?: (v: number) => string;
  max?: number;
  emptyLabel?: string;
  labelWidth?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (items.length === 0) return <div className="text-[13px] text-fg-3">{emptyLabel}</div>;
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.key}
          onMouseEnter={() => setHover(item.key)}
          onMouseLeave={() => setHover(null)}
          className="grid items-center gap-3 text-[13px]"
          style={{ gridTemplateColumns: `minmax(0, ${labelWidth}) 1fr auto` }}
          title={item.sub ? undefined : `${format(item.value)}`}
        >
          <span className="min-w-0">
            <span className="block truncate text-fg-2">{item.label}</span>
            {item.sub && <span className="block truncate text-[11.5px] text-fg-3">{item.sub}</span>}
          </span>
          <span className="relative h-2.5 rounded-r bg-transparent">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px]"
              style={{
                width: `${Math.max(1.5, (item.value / top) * 100)}%`,
                background: "var(--series-1)",
                opacity: hover && hover !== item.key ? 0.45 : 1,
              }}
            />
          </span>
          <span className="tabular whitespace-nowrap text-right text-fg">{format(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}
