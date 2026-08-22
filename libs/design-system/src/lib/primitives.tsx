import { useCallback, useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { resolveTheme, subscribeTheme, toggleTheme, type ResolvedTheme } from './theme.js';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export function Card({ children, style, pad = true }: { children: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return <div className="bo-card" style={style}>{pad ? <div className="bo-card-pad">{children}</div> : children}</div>;
}

export function CardTitled({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="bo-card">
      <div className="bo-card-head"><span>{title}</span>{action}</div>
      <div>{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="bo-page-head">
      {/* El bloque de texto se estira y el de acciones no. Sin esto, un subtítulo largo empuja los
          botones a su propio renglón *pegados a la izquierda*, donde se leen como si fueran otra
          barra de filtros en vez de la acción principal de la pantalla. */}
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 className="bo-page-title">{title}</h1>
        {subtitle && <p className="bo-page-sub">{subtitle}</p>}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 10, flex: 'none', marginLeft: 'auto', alignItems: 'center' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`bo-badge ${tone}`}><span className="bo-dot" />{children}</span>;
}

export function KpiCard({
  label, value, delta, deltaTone, icon, accent,
}: {
  label: string; value: string; delta?: string; deltaTone?: Tone; icon?: ReactNode; accent?: string;
}) {
  return (
    <div className="bo-kpi">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="bo-kpi-label">{label}</div>
        {icon && <div className="bo-kpi-accent" style={{ background: accent ?? 'var(--bo-primary-soft)' }}>{icon}</div>}
      </div>
      <div className="bo-kpi-value">{value}</div>
      {delta && (
        <div className="bo-kpi-delta" style={{ color: toneColor(deltaTone) }}>{delta}</div>
      )}
    </div>
  );
}

export function Button({
  children, onClick, variant = 'default', disabled, type = 'button', title, selected,
}: {
  children: ReactNode; onClick?: () => void;
  /** `danger` es para lo que destruye o rechaza; nunca para «cancelar». */
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean; type?: 'button' | 'submit';
  /** Por qué está deshabilitado, o qué hace: se lee al posarse encima. */
  title?: string;
  /** Botón que además es un filtro activo — el patrón de los chips de la bandeja. */
  selected?: boolean;
}) {
  const className = [
    'bo-btn',
    variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger' : '',
    selected ? 'bo-btn-selected' : '',
  ].filter(Boolean).join(' ');
  return (
    <button type={type} className={className} onClick={onClick} disabled={disabled} title={title} aria-pressed={selected}>
      {children}
    </button>
  );
}

/**
 * Campo de texto de la consola. Todo lo que se teclea pasa por aquí: mismo alto que los botones y
 * los selects, mismo anillo de foco, mismo trato del estado deshabilitado y del inválido.
 *
 * `icon` y `suffix` van **dentro** del borde —una lupa a la izquierda, un «%» a la derecha—, que es
 * lo que evita que cada pantalla se invente su propio adorno pegado al lado del campo.
 */
export function TextInput({
  value, onChange, placeholder, grow, type = 'text', disabled, invalid, title,
  icon, suffix, onClear, align, id, name, autoComplete, inputMode, ariaLabel,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; grow?: boolean; type?: string;
  disabled?: boolean;
  /** Marca el borde en rojo; el texto del porqué va en el `error` del Field. */
  invalid?: boolean;
  title?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  /** Muestra la cruz de limpiar cuando hay algo escrito. Para buscadores. */
  onClear?: () => void;
  align?: 'left' | 'right';
  id?: string; name?: string; autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search';
  ariaLabel?: string;
}) {
  const showClear = onClear != null && value !== '' && !disabled;
  const field = (
    <input
      className={[
        'bo-input',
        grow && icon == null && suffix == null && !showClear ? 'grow' : '',
        icon ? 'has-ico' : '',
        suffix ? 'has-suffix' : '',
        align === 'right' ? 'num' : '',
      ].filter(Boolean).join(' ')}
      value={value}
      type={type}
      id={id}
      name={name}
      autoComplete={autoComplete}
      inputMode={inputMode}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  if (icon == null && suffix == null && !showClear) return field;
  return (
    <span className={`bo-input-wrap ${grow ? 'grow' : ''}`}>
      {icon && <span className="bo-input-ico" aria-hidden="true">{icon}</span>}
      {field}
      {suffix && <span className="bo-input-suffix" aria-hidden="true">{suffix}</span>}
      {showClear && (
        <button type="button" className="bo-input-clear" onClick={onClear} aria-label="Limpiar" title="Limpiar">×</button>
      )}
    </span>
  );
}

/** Buscador: lupa dentro del campo y cruz para vaciarlo sin borrar a mano. */
export function SearchInput(props: Omit<Parameters<typeof TextInput>[0], 'icon' | 'type'>) {
  return <TextInput {...props} type="search" inputMode="search" icon="🔍" grow={props.grow ?? true} />;
}

/**
 * Campo numérico. No usa `type="number"`: la ruedita del ratón cambia el monto sin querer al
 * desplazar la página y las flechas ocupan el sitio del sufijo. Lo que se necesita de un número
 * aquí es el teclado correcto en táctil y que las cifras alineen — eso es `inputMode` y `align`.
 */
export function NumberInput(props: Omit<Parameters<typeof TextInput>[0], 'type' | 'inputMode' | 'align'>) {
  return <TextInput {...props} type="text" inputMode="decimal" align="right" />;
}

export function TextArea({
  value, onChange, placeholder, rows, disabled, invalid, id, name, ariaLabel,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
  disabled?: boolean; invalid?: boolean; id?: string; name?: string; ariaLabel?: string;
}) {
  return (
    <textarea
      className="bo-textarea"
      value={value}
      rows={rows}
      id={id}
      name={name}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select({
  value, onChange, options, disabled, placeholder, invalid, id, name, ariaLabel, title,
}: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
  /** Para los pasos de una cascada que todavía no tienen de dónde colgar. */
  disabled?: boolean;
  /** Primera opción de valor vacío — «Todos los estatus». Sin ella el select obliga a elegir. */
  placeholder?: string;
  invalid?: boolean;
  id?: string; name?: string; ariaLabel?: string; title?: string;
}) {
  return (
    <select
      className="bo-select"
      value={value}
      id={id}
      name={name}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Casilla con su etiqueta: el texto también conmuta, que es donde la gente hace clic. */
export function Checkbox({
  checked, onChange, label, disabled, title,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <label className={`bo-check ${disabled ? 'disabled' : ''}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Etiqueta + control + una línea de apoyo. El `hint` dice qué se espera antes de teclear; el
 * `error` dice qué pasó al enviar y sustituye al hint — nunca se muestran los dos, porque leer una
 * ayuda debajo de un error es leer dos veces para quedarse con una.
 */
export function Field({
  label, children, hint, error, required,
}: {
  label: string; children: ReactNode; hint?: string; error?: string; required?: boolean;
}) {
  return (
    <label className="bo-field">
      <span className="bo-field-label">
        {label}
        {required && <span className="bo-field-req" aria-hidden="true">*</span>}
      </span>
      {children}
      {error
        ? <span className="bo-field-error">{error}</span>
        : hint && <span className="bo-field-hint">{hint}</span>}
    </label>
  );
}

/** Fila de filtros sobre una tabla. Alinea por la base: los campos con etiqueta y los que no. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="bo-toolbar">{children}</div>;
}

export function Spinner() {
  return <div className="bo-center"><div className="bo-spinner" /></div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="bo-table-empty">{message}</div>;
}

export function DefRow({ k, v }: { k: string; v: ReactNode }) {
  return <div><div className="bo-def-k">{k}</div><div className="bo-def-v">{v}</div></div>;
}

export function Defs({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`bo-defs ${className ?? ''}`}>{children}</div>;
}

/**
 * Diálogo centrado. Se usa donde el contenido *es* la tarea (el detalle de una cuenta, con sus
 * saldos y su tabla de amortización), no un apunte lateral: centrado tiene el ancho para que la
 * tabla se lea completa.
 *
 * Es el **único** patrón de sobreposición de la consola. Hubo un `Drawer` lateral y se retiró: en
 * 560px una ficha de análisis —score, reglas, buró, créditos vigentes— se lee por una rendija
 * mientras el resto de la pantalla se queda inerte de fondo.
 */
export function Modal({
  title, subtitle, onClose, children, actions, size = 'default',
}: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode;
  actions?: ReactNode; size?: 'narrow' | 'default' | 'wide';
}) {
  const box = useRef<HTMLDivElement>(null);
  useDismissOnEscape(onClose);

  // El foco entra al diálogo al abrirlo; si no, el teclado se queda en la tabla de atrás y el
  // Escape lo recoge la página, no el modal.
  useEffect(() => { box.current?.focus(); }, []);

  return (
    <div className="bo-modal-scrim" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`bo-modal ${size === 'default' ? '' : size}`}
        style={{ outline: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bo-modal-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
            {subtitle && <div className="bo-page-sub">{subtitle}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
            {actions}
            <button type="button" className="bo-x" onClick={onClose} aria-label="Cerrar">×</button>
          </div>
        </div>
        <div className="bo-modal-body">{children}</div>
      </div>
    </div>
  );
}

function useDismissOnEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Tabs<T extends string>({
  value, onChange, tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: Array<{ value: T; label: string; icon?: string; count?: number }>;
}) {
  return (
    <div className="bo-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          type="button"
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          className={`bo-tab ${t.value === value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.icon && <span aria-hidden="true">{t.icon}</span>}
          {t.label}
          {t.count != null && <span className="bo-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** El tema que se está viendo ahora — sigue tanto al botón como al cambio del sistema. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, () => resolveTheme(), () => 'light' as const);
}

export function ThemeToggle() {
  const theme = useResolvedTheme();
  const next = theme === 'dark' ? 'claro' : 'oscuro';
  const flip = useCallback(() => { toggleTheme(); }, []);
  return (
    // `type="button"` no es adorno: el conmutador vive en la tarjeta de acceso, que es un
    // formulario, y sin declararlo el navegador lo trata como submit. Cambiar a modo claro
    // iniciaba sesión.
    <button type="button" className="bo-theme-btn" onClick={flip} title={`Cambiar a modo ${next}`} aria-label={`Cambiar a modo ${next}`}>
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}

function toneColor(t?: Tone): string {
  switch (t) {
    case 'ok': return 'var(--bo-ok)';
    case 'bad': return 'var(--bo-bad)';
    case 'warn': return 'var(--bo-warn)';
    case 'info': return 'var(--bo-info)';
    default: return 'var(--bo-text-muted)';
  }
}
