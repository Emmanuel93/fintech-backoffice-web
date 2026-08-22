// Formatting helpers (MXN-first, es-MX) shared across all backoffice modules.

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const mxnCents = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat('es-MX');

export function money(v: number | null | undefined, cents = false): string {
  if (v == null || Number.isNaN(v)) return '—';
  return (cents ? mxnCents : mxn).format(v);
}

/** Compact currency for KPI tiles: $1.2M, $840K. */
export function moneyCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return mxn.format(v);
}

export function count(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return int.format(v);
}

export function percent(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

/** A nominal rate stored as a fraction (0.36) or already-a-percent (36) → "36.0%". */
export function rate(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

/**
 * Una fecha de calendario: vencimiento, nacimiento. Sin hora porque no la tienen —
 * un préstamo vence el día 15, no a las 15:00 del día 15.
 *
 * Para sellos de tiempo va `dateTime`: ahí el día suelto no alcanza.
 */
export function date(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Un instante: fecha y hora local.
 *
 * Va en todo lo que es un hecho registrado —cuándo entró un pago, cuándo se evaluó una
 * solicitud, cuándo se dio de alta un cliente—. La hora no es adorno: dos pagos del mismo
 * día son indistinguibles en orden si sólo se muestra la fecha, y conciliar es justamente
 * ordenarlos. Se conserva `date` para las fechas de calendario, que no tienen hora que dar.
 */
export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
