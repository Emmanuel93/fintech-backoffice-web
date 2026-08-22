import type { ReactNode } from 'react';
import type { Tone } from './primitives.js';

/**
 * Piezas de lectura de la consola: lo que se mira antes de tocar nada.
 *
 * Viven aparte de `primitives.tsx` porque no son controles —no reciben eventos ni tienen estado—:
 * son las formas en que esta consola presenta una cifra, una proporción y una secuencia. Tenerlas
 * en un solo sitio es lo que evita que cada módulo se invente su barra de progreso y su tarjeta de
 * indicador, que fue justo lo que pasó antes con los filtros.
 */

/**
 * Rótulo. Se distingue del `Badge` en que **no lleva punto**: el punto significa «esto tiene un
 * estado que puede cambiar solo». Un segmento («B2B2C»), una política («POL-DISTRIB-V1») o un tipo
 * de línea no cambian mientras se mira la pantalla, así que van en chip.
 */
export function Chip({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`bo-chip ${tone ?? ''}`} title={title}>{children}</span>;
}

/**
 * Cifra de encabezado: la fila de cuatro que encuadra la tabla de abajo.
 *
 * Es deliberadamente más discreta que `KpiCard` —sin icono ni acento de color de fondo—. El KPI
 * está hecho para ser el contenido de un tablero; puesto encima de una tabla compite con ella y la
 * pantalla deja de tener un punto de entrada claro.
 */
export function StatCard({ label, value, sub, tone }: {
  label: string;
  value: string;
  /** La línea de apoyo: contra qué se compara la cifra, o de qué se compone. */
  sub?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="bo-stat">
      <div className="bo-stat-l">{label}</div>
      <div className={`bo-stat-v ${tone ? `t-${tone}` : ''}`}>{value}</div>
      {sub && <div className="bo-stat-s">{sub}</div>}
    </div>
  );
}

/** La rejilla de las cifras de encabezado. Se reparte sola según el ancho disponible. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="bo-stats">{children}</div>;
}

/**
 * Etiqueta, cifra y barra: una proporción dentro de un conjunto.
 *
 * `pct` es el largo de la barra, 0-100, y va **explícito** en vez de derivarse del valor: en
 * «colocación por producto» la barra es proporción del total, y en «pipeline» es proporción de la
 * etapa más ancha. Calcularlo aquí obligaría a elegir uno de los dos y el otro saldría mal.
 *
 * Con `onClick` el renglón entero filtra —el mismo gesto que las etapas del embudo—: leer dónde se
 * atora algo y acotar por ello no deberían ser dos acciones distintas.
 */
export function Meter({ label, value, pct, tone, onClick, title }: {
  label: ReactNode;
  /** Lo que se lee a la derecha: el monto, el conteo, el porcentaje ya formateado. */
  value?: ReactNode;
  pct: number;
  tone?: 'ok' | 'warn' | 'bad' | 'info';
  onClick?: () => void;
  title?: string;
}) {
  const color = tone === 'ok' ? 'var(--bo-ok)'
    : tone === 'warn' ? 'var(--bo-warn)'
      : tone === 'bad' ? 'var(--bo-bad)'
        : tone === 'info' ? 'var(--bo-info)'
          : 'var(--bo-primary)';
  const body = (
    <>
      <div className="bo-meter-head">
        <span className="bo-meter-l">{label}</span>
        {value != null && <span className="bo-meter-v">{value}</span>}
      </div>
      <div className="bo-meter-bar">
        <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
    </>
  );

  if (!onClick) return <div className="bo-meter" title={title}>{body}</div>;
  return (
    <button type="button" className="bo-meter abrible" onClick={onClick} title={title}>{body}</button>
  );
}

/** Varios medidores en columna, con el aire que necesitan para leerse como una comparación. */
export function MeterList({ children }: { children: ReactNode }) {
  return <div className="bo-meter-list">{children}</div>;
}

export interface TimelineStep {
  label: string;
  /** Cuándo pasó, ya formateado. Vacío para los pasos que todavía no ocurren. */
  time?: string;
  /** `hecho` ya pasó · `ahora` es donde está · `falla` terminó mal · sin tono, pendiente. */
  tone?: 'hecho' | 'ahora' | 'falla';
}

/**
 * La secuencia de un expediente: qué pasó y cuándo, de arriba abajo.
 *
 * El hilo entre puntos no es decoración — es lo que hace que cinco fechas apiladas se lean como un
 * recorrido. El último paso no lo lleva: un hilo que baja hacia la nada sugiere un paso pendiente
 * que nadie prometió.
 */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="bo-timeline">
      {steps.map((s, i) => (
        <div className="bo-tl-row" key={`${s.label}-${i}`}>
          <div className="bo-tl-rail">
            <span className={`bo-tl-dot ${s.tone ?? ''}`} />
            {i < steps.length - 1 && <span className="bo-tl-line" />}
          </div>
          <div className="bo-tl-body">
            <div className="bo-tl-l">{s.label}</div>
            {s.time && <div className="bo-tl-t">{s.time}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * El score, del tamaño que le corresponde.
 *
 * Es la cifra que decide y la primera que se busca al abrir un expediente. Puesta en una fila de
 * definiciones queda entre otras doce y hay que leerlas todas para encontrarla; en disco se ve
 * antes de enfocar. El color lo pone el nivel de riesgo, no el propio número: qué score es bueno
 * depende de la política del producto, y eso lo resuelve el motor.
 */
export function ScoreRing({ value, label = 'SCORE', tone }: {
  value: number | string | null | undefined;
  label?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className={`bo-ring ${tone ? `t-${tone}` : ''}`}>
      <div>
        <div className="bo-ring-n">{value ?? '—'}</div>
        <div className="bo-ring-l">{label}</div>
      </div>
    </div>
  );
}

/**
 * De dónde salen las cifras de la pantalla y qué regla las gobierna.
 *
 * Va al pie y en gris a propósito: es lo que se lee cuando un número no cuadra —para saber contra
 * qué servicio compararlo—, no en el recorrido normal. Arriba competiría con el título.
 */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="bo-footnote">{children}</p>;
}
