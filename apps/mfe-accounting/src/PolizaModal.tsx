import { accountingApi } from '@bo/api-client';
import {
  useAsync, Modal, Badge, Button, DataTable, Defs, DefRow, EmptyState, Spinner,
  money, dateTime, type Column,
} from '@bo/design-system';
import type { VoucherLine } from '@bo/api-client';
import { TIPO_POLIZA, folioCompleto, hechoLabel, periodoLabel, tonoTipo } from './lenguaje';

/**
 * Una póliza con sus renglones.
 *
 * <p>El total de cargos y el de abonos se muestran siempre, aunque por construcción sean iguales.
 * Es lo primero que revisa quien audita una póliza, y obligarlo a sumar de cabeza siete renglones
 * para confirmar lo que la base ya garantiza convierte una comprobación de un vistazo en una tarea.
 *
 * <p>Un pago aparece con tres renglones —caja contra capital e intereses— y ése es exactamente el
 * caso que no cabía en el modelo anterior de un solo par débito/crédito.
 */
export function PolizaModal({
  voucherId, onClose, onAbrirPrestamo,
}: {
  voucherId: string;
  onClose: () => void;
  onAbrirPrestamo: (creditAccountId: string) => void;
}) {
  const state = useAsync(() => accountingApi.voucherById(voucherId), [voucherId]);
  const v = state.data;

  const columns: Array<Column<VoucherLine>> = [
    {
      key: 'cuenta',
      header: 'Cuenta',
      render: (l) => (
        <div>
          <b className="bo-mono-sm">{l.accountCode}</b> {l.accountName}
          {l.description && <div className="bo-sub">{l.description}</div>}
        </div>
      ),
    },
    {
      key: 'cargo',
      header: 'Cargo',
      align: 'right',
      render: (l) => l.debit > 0 ? money(l.debit, true) : <span className="bo-sub">—</span>,
    },
    {
      key: 'abono',
      header: 'Abono',
      align: 'right',
      render: (l) => l.credit > 0 ? money(l.credit, true) : <span className="bo-sub">—</span>,
    },
  ];

  // Con la serie, no sólo el consecutivo: es como se cita un folio y como se distingue del mismo
  // número en otra sucursal.
  const titulo = v
    ? `Póliza ${folioCompleto(v.voucherType, v.folio, v.orgUnitCode)}`
    : 'Póliza';

  return (
    <Modal
      title={titulo}
      subtitle={v ? `${hechoLabel(v.triggerEvent)} · ${periodoLabel(v.period)}` : undefined}
      onClose={onClose}
      size="wide"
      actions={v?.creditAccountId && (
        <Button onClick={() => onAbrirPrestamo(v.creditAccountId!)}>
          Ver el crédito
        </Button>
      )}
    >
      {state.loading && <Spinner />}
      {state.error && <EmptyState message={`No se pudo abrir la póliza: ${state.error}`} />}

      {v && (
        <>
          {v.status === 'CANCELLED' && (
            <div className="bo-alert">
              <b>Póliza cancelada.</b> Sigue aquí a propósito: se canceló con una póliza de reversa
              que la deja en cero, y las dos permanecen visibles. Borrarla dejaría un hueco en el
              folio consecutivo de la sucursal.
            </div>
          )}

          {v.isLatePosting && (
            <div className="bo-alert bo-huerfanos">
              <b>Asiento extemporáneo.</b> El hecho ocurrió en {periodoLabel(v.originalPeriod ?? '')},
              que ya estaba cerrado, así que se asentó en {periodoLabel(v.period)}. Es la diferencia
              entre los dos meses, y está explicada.
            </div>
          )}

          <Defs>
            <DefRow k="Tipo" v={<Badge tone={tonoTipo(v.voucherType)}>{TIPO_POLIZA[v.voucherType]}</Badge>} />
            <DefRow k="Fecha del hecho" v={dateTime(v.voucherDate)} />
            <DefRow k="Período" v={periodoLabel(v.period)} />
            <DefRow k="Sucursal" v={v.orgUnitName ?? 'Sin sucursal'} />
            <DefRow
              k="Código de la unidad"
              v={<span className="bo-mono-sm">{v.orgUnitCode ?? '—'}</span>}
            />
            <DefRow k="Contrato" v={<span className="bo-mono-sm">{v.contractNumber ?? '—'}</span>} />
            <DefRow k="Acreditado" v={v.obligorName ?? '—'} />
            <DefRow k="Concepto" v={v.concept} />
          </Defs>

          <div style={{ marginTop: 18 }}>
            <DataTable
              columns={columns}
              rows={v.lines}
              rowKey={(l) => l.accountCode}
              emptyMessage="Esta póliza no tiene renglones."
            />
          </div>

          <div
            style={{
              display: 'flex', justifyContent: 'flex-end', gap: 28,
              padding: '14px 4px 0', fontVariantNumeric: 'tabular-nums',
            }}
          >
            <div style={{ textAlign: 'right' }}>
              <div className="bo-sub">Total cargos</div>
              <div style={{ fontSize: 17, fontWeight: 750 }}>{money(v.totalDebit, true)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bo-sub">Total abonos</div>
              <div style={{ fontSize: 17, fontWeight: 750 }}>{money(v.totalCredit, true)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bo-sub">Cuadre</div>
              <Badge tone={v.totalDebit === v.totalCredit ? 'ok' : 'bad'}>
                {v.totalDebit === v.totalCredit ? 'Cuadra' : 'No cuadra'}
              </Badge>
            </div>
          </div>

          <p className="bo-sub" style={{ marginTop: 14 }}>
            Origen: <span className="bo-mono-sm">{v.sourceEventId}</span>. El asiento es idempotente
            por ese identificador: el mismo hecho reprocesado no genera una segunda póliza.
          </p>
        </>
      )}
    </Modal>
  );
}
