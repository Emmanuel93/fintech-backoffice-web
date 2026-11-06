import { useState, type ReactNode } from 'react';

/**
 * Una sección que se abre a petición.
 *
 * <p>Existe para las vistas donde un mismo bloque tiene que ofrecer el resumen y la evidencia. Con
 * devengo diario, el detalle de un crédito son sesenta y tantas pólizas más sus facturas: puestas
 * todas a la vez, la cifra que se venía a consultar queda enterrada y hay que hacer scroll de
 * vuelta para leerla. Plegadas, el resumen manda y el detalle está a un clic.
 *
 * <p>El contador va en el encabezado <b>siempre</b>, incluso plegado: saber que hay 62 pólizas es
 * parte de la respuesta, y obligar a abrir para averiguar cuántas hay convierte un dato en una
 * búsqueda.
 *
 * <p>El estado es interno porque abrir una sección no afecta a nadie más. Cuando abrir dispara una
 * carga —como las filas de una tabla— el patrón correcto es el `expandedKey` de `DataTable`, que lo
 * controla desde fuera: quien pide los datos tiene que saber por cuál está esperando.
 */
export function Collapsible({
  title, count, subtitle, children, defaultOpen = false, actions, ariaLabel,
}: {
  title: string;
  /** Cuántos elementos hay dentro. Se muestra plegado y desplegado. */
  count?: number;
  /** Una línea de contexto que se lee sin abrir: texto, o cifras ya formateadas. */
  subtitle?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /**
   * What can be done without opening (e.g. «Descargar último»). It sits beside the header, not inside its button:
   * a button inside a button is invalid HTML and its click would also fold the section.
   */
  actions?: ReactNode;
  /** Accessible name of the region; the title when not given. */
  ariaLabel?: string;
}) {
  const [abierto, setAbierto] = useState(defaultOpen);

  return (
    <section className="bo-collapsible" aria-label={ariaLabel ?? title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="bo-collapsible-head"
          onClick={() => setAbierto(!abierto)}
          aria-expanded={abierto}
          style={actions ? { flex: 1, minWidth: 0 } : undefined}
        >
          <span className="bo-collapsible-chevron" data-abierto={abierto || undefined}>›</span>
          <b>{title}</b>
          {count != null && <span className="bo-collapsible-count">{count}</span>}
          {subtitle && <span className="bo-sub">{subtitle}</span>}
        </button>
        {actions && <div style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>{actions}</div>}
      </div>
      {abierto && <div className="bo-collapsible-body">{children}</div>}
    </section>
  );
}
