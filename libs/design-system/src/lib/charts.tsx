// Dependency-free SVG charts. Self-contained so remotes stay light and there is
// no shared charting-lib to federate.

export interface Slice { label: string; value: number; color: string }

export function DonutChart({ data, size = 168, thickness = 26, centerLabel, centerValue }: {
  data: Slice[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--bo-border)" strokeWidth={thickness} />
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={i}
                cx={cx} cy={cx} r={r} fill="none"
                stroke={d.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        {(centerValue || centerLabel) && (
          <text x="50%" y="50%" textAnchor="middle">
            <tspan x="50%" dy="-2" fontSize="18" fontWeight="750" fill="var(--bo-text)">{centerValue}</tspan>
            <tspan x="50%" dy="18" fontSize="10.5" fill="var(--bo-text-muted)">{centerLabel}</tspan>
          </text>
        )}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />
            <span style={{ color: 'var(--bo-text-muted)' }}>{d.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface Bar { label: string; value: number; sub?: string }

export function BarList({ data, color = 'var(--bo-primary)', format }: {
  data: Bar[]; color?: string; format?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((d, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
            <span style={{ fontWeight: 600 }}>{d.label}</span>
            <span style={{ color: 'var(--bo-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {format ? format(d.value) : d.value}{d.sub ? ` · ${d.sub}` : ''}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 6, background: 'var(--bo-surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', borderRadius: 6, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal stacked bar for health composition (sana / SICR / vencida). */
export function StackedBar({ segments, height = 12 }: { segments: Slice[]; height?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div>
      <div style={{ display: 'flex', height, borderRadius: 6, overflow: 'hidden' }}>
        {segments.map((s, i) => (
          <div key={i} title={`${s.label}: ${Math.round((s.value / total) * 100)}%`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        {segments.map((s, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--bo-text-muted)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
            {s.label} · <b style={{ color: 'var(--bo-text)' }}>{Math.round((s.value / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}
