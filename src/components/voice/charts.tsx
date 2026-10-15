'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmt } from '@/lib/voice/calls';
import { useTip } from './dashboard-context';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export interface Bucket { label: string; short?: string; values: number[]; tip?: ReactNode }
export interface Series { name: string; color: string }

/** Stacked vertical bars with a 2px surface gap between segments and rounded tops. */
export function BarChart({ buckets, series, height = 240, yFormat = fmt.n, maxValue }: {
  buckets: Bucket[]; series: Series[]; height?: number; yFormat?: (v: number) => string; maxValue?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const W = Math.max(280, width || 600);
  const H = height;
  const pad = { t: 10, r: 4, b: 26, l: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = maxValue ?? niceMax(Math.max(1, ...buckets.map((b) => b.values.reduce((s, v) => s + v, 0))));
  const step = iw / Math.max(1, buckets.length);
  const bw = Math.max(2, Math.min(36, step * 0.66));
  const labelEvery = Math.ceil(buckets.length / Math.max(1, Math.floor(iw / 56)));

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bar chart: ${series.map((s) => s.name).join(', ')}`}>
          <g className="grid axis">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = pad.t + ih - t * ih;
              return (
                <g key={t}>
                  <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} style={t === 0 ? { stroke: 'var(--muted)', opacity: 0.5 } : undefined} />
                  <text x={pad.l - 8} y={y + 4} textAnchor="end" fill="var(--muted)">{yFormat(t * max)}</text>
                </g>
              );
            })}
          </g>
          <g className="axis">
            {buckets.map((b, i) => {
              const cx = pad.l + step * i + step / 2;
              const x = cx - bw / 2;
              const total = b.values.reduce((s, v) => s + v, 0);
              const lastIdx = b.values.reduce((li, v, j) => (v > 0 ? j : li), -1);
              let yCursor = pad.t + ih;
              const segs = b.values.map((v, j) => {
                if (v <= 0) return null;
                const h = (v / max) * ih;
                const y = yCursor - h;
                yCursor = y;
                return j === lastIdx
                  ? <path key={j} d={topRoundedRect(x, y, bw, h, 4)} fill={series[j].color} />
                  : <rect key={j} x={x} y={y + 2} width={bw} height={Math.max(0, h - 2)} fill={series[j].color} />;
              });
              const content = b.tip ?? (
                <>
                  <b>{b.label}</b>
                  {series.map((s, j) => <div key={s.name}>{s.name}: {yFormat(b.values[j])}</div>)}
                  {series.length > 1 && <div>Total: {yFormat(total)}</div>}
                </>
              );
              return (
                <g key={i} className="bar-group">
                  {segs}
                  <rect className="hit" x={pad.l + step * i} y={pad.t} width={step} height={ih} {...tip(content)} />
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" fill="var(--muted)">{b.short ?? b.label}</text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {width === 0 && <div style={{ height: H }} />}
    </div>
  );
}

export interface HBarRow { label: string; value: number; display?: string; tip?: ReactNode; color?: string }

export function HBars({ rows, color = 'var(--series-1)', format = fmt.n }: { rows: HBarRow[]; color?: string; format?: (v: number) => string }) {
  const tip = useTip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.label} {...tip(r.tip ?? <><b>{r.label}</b><div>{format(r.value)}</div></>)}>
          <span className="hbar-label" title={r.label}>{r.label}</span>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} /></div>
          <span className="hbar-val">{r.display ?? format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; extra?: ReactNode }[] }) {
  return (
    <div className="legend">
      {items.map((i) => <span key={i.name}><i style={{ background: i.color }} />{i.name}{i.extra}</span>)}
    </div>
  );
}
