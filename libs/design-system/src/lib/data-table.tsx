import { Fragment, type ReactNode } from 'react';
import { EmptyState, Spinner } from './primitives.js';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, loading, emptyMessage = 'Sin resultados',
  expandedKey, renderExpanded,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  /**
   * La fila abierta, si hay una. Se controla desde fuera —y no con estado interno— porque abrir
   * una fila suele disparar una carga: quien la pide es quien tiene que saber por cuál está
   * esperando.
   */
  expandedKey?: string | null;
  /** El contenido desplegado bajo la fila. Ocupa el ancho completo de la tabla. */
  renderExpanded?: (row: T) => ReactNode;
}) {
  if (loading) return <Spinner />;
  return (
    <div className="bo-table-wrap">
      <table className="bo-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length}><EmptyState message={emptyMessage} /></td></tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            const abierta = expandedKey != null && expandedKey === key;
            return (
              <Fragment key={key}>
                <tr
                  className={[onRowClick ? 'clickable' : '', abierta ? 'bo-row-abierta' : '']
                    .filter(Boolean).join(' ')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.render(row)}</td>
                  ))}
                </tr>
                {abierta && renderExpanded && (
                  <tr className="bo-row-detalle">
                    <td colSpan={columns.length}>{renderExpanded(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
