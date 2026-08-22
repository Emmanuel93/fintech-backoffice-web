import type { ReactNode } from 'react';
import type { AsyncState } from './use-async.js';

/**
 * Un bloque de pantalla que falla solo.
 *
 * La ficha de análisis compone cinco fuentes distintas —solicitud, prospecto,
 * evaluación, créditos vigentes y buró—. Si el buró está caído, el analista
 * todavía puede leer el score y decidir; perder la pantalla entera por un panel
 * secundario convierte una degradación en una caída.
 *
 * Cada estado dice algo distinto y ninguno es "error":
 *
 * - **cargando** — todavía no se sabe.
 * - **vacío** — se sabe, y no hay nada. No es lo mismo que fallar.
 * - **fuera de alcance / falta unidad** — el backend contestó bien a una
 *   pregunta que no correspondía. Se explica, no se disculpa.
 * - **error** — algo se rompió, y se ofrece reintentar sólo este bloque.
 */
export interface BlockProps<T> {
  title?: string;
  state: AsyncState<T>;
  /** Qué decir cuando la respuesta llegó vacía. */
  emptyLabel?: string;
  /** `true` si `data` cuenta como vacío (lista sin elementos, objeto nulo…). */
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}

export function Block<T>({
  title,
  state,
  emptyLabel = 'Sin información',
  isEmpty,
  children,
}: BlockProps<T>) {
  const { data, loading, error, reload } = state;

  const body = (() => {
    if (loading) return <BlockNote tone="muted">Cargando…</BlockNote>;

    if (error) {
      // Los errores esperados —alcance, unidad faltante— se explican tal cual y
      // sin botón de reintentar: reintentar no va a cambiar la respuesta.
      const expected = /alcance|unidad/i.test(error);
      return (
        <BlockNote tone={expected ? 'muted' : 'bad'}>
          {error}
          {!expected && (
            <button type="button" onClick={reload} style={retryStyle}>
              Reintentar
            </button>
          )}
        </BlockNote>
      );
    }

    if (data == null || (isEmpty?.(data) ?? false)) {
      return <BlockNote tone="muted">{emptyLabel}</BlockNote>;
    }

    return children(data);
  })();

  return (
    <section>
      {title && <h3 style={titleStyle}>{title}</h3>}
      {body}
    </section>
  );
}

function BlockNote({ tone, children }: { tone: 'muted' | 'bad'; children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: '14px 0',
        fontSize: 13,
        color: tone === 'bad' ? 'var(--bo-danger, #ef4444)' : 'var(--bo-muted, #94a3b8)',
      }}
    >
      {children}
    </p>
  );
}

const titleStyle = {
  margin: '0 0 10px',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.2,
  color: 'var(--bo-text, #e2e8f0)',
} as const;

const retryStyle = {
  marginLeft: 10,
  padding: '2px 10px',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 6,
  border: '1px solid var(--bo-border, #334155)',
  background: 'transparent',
  color: 'inherit',
} as const;
