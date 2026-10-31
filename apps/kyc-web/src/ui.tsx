import { useState, type ReactNode } from 'react';

/** Trazos de los íconos del diseño. Son rutas SVG sueltas: no vale una librería para seis dibujos. */
export const ICON = {
  ine: 'M3 6h18v12H3zM7 10.5h4M7 14h6M15.5 10.5h2.5M15.5 14h2.5',
  ineBack: 'M3 6h18v12H3zM7 9v6M10 9v6M13 9v6M16 9v6M19 9v6',
  phone: 'M7.5 3h9a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3M10.5 18h3',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 7.5V12l3 1.8',
  face: 'M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M5 20a7 7 0 0 1 14 0',
  shield: 'M12 3.5 20 6v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z',
  check: 'M4.5 12.5l5 5 10-11',
};

export function Icon({ d, size = 18, stroke = 1.9 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * El código de seis dígitos: seis cajas pintadas y **un solo** campo de verdad encima.
 *
 * Seis `<input>` sueltos rompen lo que sí importa en un celular: pegar el código del SMS, que el
 * teclado lo autocomplete (`one-time-code`) y que un lector de pantalla lo anuncie como un campo y
 * no como seis. Las cajas son dibujo; el campo invisible es el que recibe todo.
 */
export function OtpInput({ value, onChange, small, autoFocus, disabled }: {
  value: string;
  onChange: (v: string) => void;
  small?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={`k-otp${small ? ' small' : ''}`}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className={[
            'k-otp-box',
            value.length > i ? 'filled' : '',
            focused && (value.length === i || (i === 5 && value.length === 6)) ? 'cursor' : '',
          ].filter(Boolean).join(' ')}
        >
          {value[i] ?? ''}
        </div>
      ))}
      <input
        aria-label="Código de 6 dígitos"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  );
}

/** El botón grande del diseño. Es un `<button>` y no un `div` con `onClick`: se alcanza con teclado. */
export function Cta({ children, onClick, disabled, busy }: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button type="button" className="k-cta" onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('es-MX')}`;
}

/** Lo que se le muestra si algo falla. Nunca el código HTTP: ella no tiene a quién preguntarle qué es un 500. */
export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="k-error" role="alert">{children}</p>;
}

/** Sólo en desarrollo: el código fijo del ambiente local, para no ir a buscarlo a un log. */
export function DevHint() {
  if (!import.meta.env.DEV) return null;
  return <div className="k-devhint">Ambiente de pruebas: el código es 123456</div>;
}
