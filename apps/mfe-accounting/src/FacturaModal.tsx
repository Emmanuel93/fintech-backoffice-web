import { useMemo } from 'react';
import { accountingApi, type InvoiceLine } from '@bo/api-client';
import {
  useAsync, Modal, Badge, Button, Defs, DefRow, EmptyState, Spinner,
  money, dateTime,
} from '@bo/design-system';
import { ESTADO_FACTURA, conceptoLabel, periodoLabel, tonoFactura } from './lenguaje';

/**
 * Un CFDI, con sus renglones **agrupados por préstamo**.
 *
 * <p>El agrupamiento es la respuesta al detalle que se pidió. Un cliente con tres créditos recibe
 * una sola factura, y la lista plana de nueve conceptos no permite contestar «cuánto de esto es del
 * contrato 0244» sin ir sumando a mano. Agrupada, cada crédito tiene su subtotal y su enlace a la
 * ficha contable.
 *
 * <p>Está escrito así también por si la decisión cambia: si el negocio pide un CFDI por préstamo,
 * el backend agrupa distinto y esta pantalla no se toca — enseñaría un grupo por factura.
 */
export function FacturaModal({
  invoiceId, onClose, onAbrirPrestamo,
}: {
  invoiceId: string;
  onClose: () => void;
  onAbrirPrestamo: (creditAccountId: string) => void;
}) {
  const state = useAsync(() => accountingApi.invoiceById(invoiceId), [invoiceId]);
  const inv = state.data;

  const grupos = useMemo(() => {
    if (!inv) return [];
    const byLoan = new Map<string, { contrato: string; lines: InvoiceLine[] }>();
    inv.lines.forEach((l) => {
      const key = l.creditAccountId ?? 'sin-credito';
      const g = byLoan.get(key)
        ?? { contrato: l.contractNumber ?? 'Sin contrato asociado', lines: [] };
      g.lines.push(l);
      byLoan.set(key, g);
    });
    return [...byLoan.entries()].map(([creditAccountId, g]) => ({
      creditAccountId: creditAccountId === 'sin-credito' ? null : creditAccountId,
      contrato: g.contrato,
      lines: g.lines,
      subtotal: g.lines.filter((l) => !l.isIva).reduce((s, l) => s + l.amount, 0),
      iva: g.lines.filter((l) => l.isIva).reduce((s, l) => s + l.amount, 0),
    }));
  }, [inv]);

  return (
    <Modal
      title={inv?.serie && inv.folio ? `Factura ${inv.serie}-${inv.folio}` : 'Factura sin folio'}
      subtitle={inv ? `${inv.receptorName} · ${periodoLabel(inv.period)}` : undefined}
      onClose={onClose}
      size="wide"
    >
      {state.loading && <Spinner />}
      {state.error && <EmptyState message={`No se pudo abrir la factura: ${state.error}`} />}

      {inv && (
        <>
          {inv.status === 'CANCELLED' && (
            <div className="bo-alert">
              <b>Factura cancelada.</b> Sus importes no cuentan en el total facturado del período,
              pero los asientos que la originaron siguen en el mayor: cancelar el CFDI no borra el
              ingreso devengado, y si además hay que revertirlo eso es otra póliza.
            </div>
          )}
          {inv.status === 'DRAFT' && (
            <div className="bo-alert bo-huerfanos">
              <b>Sin timbrar.</b> La corrida de facturación la generó y el PAC todavía no la selló.
              No tiene validez fiscal en este estado.
            </div>
          )}

          <Defs>
            <DefRow k="Estado" v={<Badge tone={tonoFactura(inv.status)}>{ESTADO_FACTURA[inv.status]}</Badge>} />
            <DefRow k="RFC receptor" v={<span className="bo-mono-sm">{inv.receptorRfc}</span>} />
            <DefRow k="Régimen fiscal" v={inv.receptorRegime ?? '—'} />
            <DefRow k="Uso del CFDI" v={inv.cfdiUse ?? '—'} />
            <DefRow k="Generada" v={dateTime(inv.createdAt)} />
            <DefRow k="Timbrada" v={inv.stampedAt ? dateTime(inv.stampedAt) : 'No timbrada'} />
            <DefRow
              k="Folio fiscal"
              v={<span className="bo-mono-sm">{inv.folioFiscal ?? '—'}</span>}
            />
          </Defs>

          <h3 style={{ margin: '20px 0 10px', fontSize: 13, fontWeight: 600 }}>
            Conceptos por préstamo
          </h3>

          {grupos.map((g) => (
            <div key={g.contrato} className="bo-card" style={{ marginBottom: 12 }}>
              <div className="bo-card-head">
                <span className="bo-mono-sm">{g.contrato}</span>
                {g.creditAccountId && (
                  <Button onClick={() => onAbrirPrestamo(g.creditAccountId!)}>
                    Ficha contable
                  </Button>
                )}
              </div>
              <div className="bo-table-wrap">
                <table className="bo-table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th className="num">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l, i) => (
                      <tr key={`${g.contrato}-${i}`}>
                        <td>
                          {conceptoLabel(l.concept)}
                          {l.isIva && <span className="bo-sub"> · impuesto trasladado</span>}
                        </td>
                        <td className="num">{money(l.amount, true)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td><b>Subtotal del crédito</b></td>
                      <td className="num">
                        <b>{money(g.subtotal + g.iva, true)}</b>
                        {g.iva > 0 && (
                          <div className="bo-sub">
                            {money(g.subtotal, true)} + {money(g.iva, true)} de IVA
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div
            style={{
              display: 'flex', justifyContent: 'flex-end', gap: 28,
              padding: '10px 4px 0', fontVariantNumeric: 'tabular-nums',
            }}
          >
            <div style={{ textAlign: 'right' }}>
              <div className="bo-sub">Subtotal</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{money(inv.subtotal, true)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bo-sub">IVA</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{money(inv.iva, true)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bo-sub">Total</div>
              <div style={{ fontSize: 20, fontWeight: 750 }}>{money(inv.total, true)}</div>
            </div>
          </div>

          <p className="bo-sub" style={{ marginTop: 14 }}>
            <b>La factura no tiene sucursal.</b> Consolida los conceptos de un cliente, que puede
            tener créditos colocados por sucursales distintas; la sucursal es del préstamo y se ve
            entrando por su ficha. Tampoco hay descarga de PDF ni XML: el timbrado de este entorno es
            un conector simulado, así que el folio fiscal no es válido ante el SAT y una
            representación impresa daría apariencia de comprobante a algo que no lo es.
          </p>
        </>
      )}
    </Modal>
  );
}
