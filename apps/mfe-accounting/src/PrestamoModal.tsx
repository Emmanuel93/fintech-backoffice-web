import { accountingApi, type Invoice, type LedgerBalance, type Voucher } from '@bo/api-client';
import {
  useAsync, Modal, Badge, DataTable, Defs, DefRow, EmptyState, Spinner,
  money, count, date, type Column,
} from '@bo/design-system';
import {
  ESTADO_FACTURA, NATURALEZA, TIPO_POLIZA,
  folioCompleto, hechoLabel, periodoLabel, plural, responsableLabel, saldoPresentado,
  sucursalLabel, tonoFactura, tonoTipo,
} from './lenguaje';

/**
 * La ficha contable de un préstamo: su historia completa, de la autorización a hoy.
 *
 * <p>Es la vista que contesta el «tracking total» al nivel que se pidió. Las pólizas van en orden
 * inverso —lo último arriba— porque la pregunta habitual es qué pasó recientemente; el orden
 * cronológico completo sigue disponible leyendo hacia abajo, y ahí abajo del todo está el alta.
 *
 * <p>Los saldos por cuenta son **acumulados de todos los períodos**, no del período seleccionado en
 * la pantalla de atrás: el auxiliar de un crédito no se corta por mes, y mostrarlo cortado haría
 * parecer que un préstamo de junio no debe nada en agosto.
 */
export function PrestamoModal({
  creditAccountId, onClose, onAbrirPoliza, onAbrirFactura,
}: {
  creditAccountId: string;
  onClose: () => void;
  onAbrirPoliza: (voucherId: string) => void;
  onAbrirFactura: (invoiceId: string) => void;
}) {
  const state = useAsync(() => accountingApi.loanLedger(creditAccountId), [creditAccountId]);
  const l = state.data;

  const polizas: Array<Column<Voucher>> = [
    {
      key: 'folio',
      header: 'Póliza',
      render: (v) => (
        <div>
          <b className="bo-mono-sm">{folioCompleto(v.voucherType, v.folio, v.orgUnitCode)}</b>
          <div className="bo-sub">{date(v.voucherDate)}</div>
        </div>
      ),
    },
    {
      key: 'hecho',
      header: 'Hecho económico',
      render: (v) => (
        <div>
          <b>{hechoLabel(v.triggerEvent)}</b>
          <div className="bo-sub">{v.concept}</div>
        </div>
      ),
    },
    {
      key: 'tipo',
      header: 'Tipo',
      render: (v) => <Badge tone={tonoTipo(v.voucherType)}>{TIPO_POLIZA[v.voucherType]}</Badge>,
    },
    { key: 'periodo', header: 'Período', render: (v) => periodoLabel(v.period) },
    { key: 'importe', header: 'Importe', align: 'right', render: (v) => money(v.totalDebit, true) },
  ];

  const saldos: Array<Column<LedgerBalance>> = [
    {
      key: 'cuenta',
      header: 'Cuenta',
      render: (b) => (
        <div>
          <b className="bo-mono-sm">{b.accountCode}</b> {b.accountName}
          <div className="bo-sub">{NATURALEZA[b.accountType]}</div>
        </div>
      ),
    },
    { key: 'cargos', header: 'Cargos', align: 'right', render: (b) => money(b.debit, true) },
    { key: 'abonos', header: 'Abonos', align: 'right', render: (b) => money(b.credit, true) },
    {
      key: 'saldo',
      header: 'Saldo',
      align: 'right',
      render: (b) => <b>{money(saldoPresentado(b.balance, b.accountType), true)}</b>,
    },
  ];

  const facturas: Array<Column<Invoice>> = [
    {
      key: 'folio',
      header: 'Factura',
      render: (i) => (
        <span className="bo-mono-sm">
          {i.serie && i.folio ? `${i.serie}-${i.folio}` : 'Sin folio'}
        </span>
      ),
    },
    { key: 'periodo', header: 'Período', render: (i) => periodoLabel(i.period) },
    {
      key: 'creditos',
      header: 'Alcance',
      // Una factura compartida no se puede conciliar contra este crédito solo, y quien la abra
      // desde aquí tiene que saberlo antes de cuadrar importes.
      render: (i) => i.loanCount > 1
        ? <span className="bo-sub">compartida con {plural(i.loanCount - 1, 'crédito más', 'créditos más')}</span>
        : <span className="bo-sub">sólo este crédito</span>,
    },
    { key: 'total', header: 'Total del CFDI', align: 'right', render: (i) => money(i.total, true) },
    {
      key: 'estado',
      header: 'Estado',
      render: (i) => <Badge tone={tonoFactura(i.status)}>{ESTADO_FACTURA[i.status]}</Badge>,
    },
  ];

  return (
    <Modal
      title={l ? l.contractNumber : 'Ficha contable'}
      subtitle={l ? `${l.obligorName} · ${sucursalLabel(l.orgUnitName)}` : undefined}
      onClose={onClose}
      size="wide"
    >
      {state.loading && <Spinner />}
      {state.error && <EmptyState message={`No se pudo abrir la ficha: ${state.error}`} />}

      {l && (
        <>
          <Defs>
            <DefRow k="Producto" v={l.productType} />
            <DefRow k="Monto autorizado" v={money(l.authorizedAmount)} />
            <DefRow k="Monto dispuesto" v={money(l.disbursedAmount)} />
            <DefRow k="Originado" v={date(l.originatedAt)} />
            <DefRow k="Sucursal de origen" v={sucursalLabel(l.orgUnitName)} />
            <DefRow k="Responsable" v={responsableLabel(l.orgUnitManager)} />
            <DefRow k="Pólizas" v={count(l.vouchers.length)} />
          </Defs>

          {l.orgUnitCode == null && (
            <div className="bo-alert bo-huerfanos" style={{ marginTop: 14 }}>
              <b>Sin sucursal de origen.</b> Este crédito es anterior al sellado de la unidad, así
              que su contabilidad no se atribuye a ninguna sucursal. Aparece contado bajo «Sin
              sucursal» en el resumen, no repartido entre las demás.
            </div>
          )}

          <h3 style={{ margin: '20px 0 10px', fontSize: 13, fontWeight: 600 }}>
            Saldos acumulados por cuenta
          </h3>
          <DataTable
            columns={saldos}
            rows={l.balances}
            rowKey={(b) => b.accountCode}
            emptyMessage="Este crédito no tiene saldos contables."
          />

          <h3 style={{ margin: '22px 0 10px', fontSize: 13, fontWeight: 600 }}>
            Pólizas, de la más reciente al alta
          </h3>
          <DataTable
            columns={polizas}
            rows={l.vouchers}
            rowKey={(v) => v.voucherId}
            onRowClick={(v) => onAbrirPoliza(v.voucherId)}
            emptyMessage="Este crédito todavía no genera asientos."
          />

          <h3 style={{ margin: '22px 0 10px', fontSize: 13, fontWeight: 600 }}>
            Facturas que incluyen este crédito
          </h3>
          <DataTable
            columns={facturas}
            rows={l.invoices}
            rowKey={(i) => i.invoiceId}
            onRowClick={(i) => onAbrirFactura(i.invoiceId)}
            emptyMessage="Ninguna factura incluye conceptos de este crédito todavía."
          />

          <p className="bo-sub" style={{ marginTop: 14 }}>
            Los saldos son el acumulado de todos los períodos, no el del mes seleccionado: el
            auxiliar de un crédito no se corta por mes. El total del CFDI puede ser mayor que lo
            facturado a este crédito cuando el cliente tiene varios.
          </p>
        </>
      )}
    </Modal>
  );
}
