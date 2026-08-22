import { productsApi } from '@bo/api-client';
import {
  useAsync, Block, Modal, Badge, Spinner, money, rate, percent,
} from '@bo/design-system';
import { PRODUCT_TYPE_LABELS, type ProductDefinition } from '@bo/shared-types';
import { Dato, Politica } from './PoliticaVista';

/**
 * Ficha de producto: sus condiciones y **bajo qué reglas se aprueba**.
 *
 * <p>El catálogo decía tasa, plazo y monto —lo que el producto cobra— y ahí se acababa. Bajo qué
 * criterio se autoriza vivía sólo en la base de scoring, así que «¿por qué a este cliente lo
 * rechazaron?» o «¿qué pesa más, el FICO o la mora?» sólo se contestaban leyendo tablas. Un
 * catálogo que no dice cómo se decide describe medio producto.
 *
 * <p>Se muestra la política que el motor <b>de verdad</b> aplica: la que casa por tipo de
 * prospecto y tipo de producto, que es exactamente como la resuelve scoring al evaluar. Si no hay
 * ninguna, se dice — un producto sin política se aprueba con el umbral simple del propio producto,
 * y eso es una decisión operativa que conviene ver, no un hueco que esconder.
 */
export function ProductoModal({ producto, onClose }: {
  producto: ProductDefinition;
  onClose: () => void;
}) {
  const state = useAsync(() => productsApi.detail(producto.id), [producto.id]);

  return (
    <Modal
      title={producto.name}
      subtitle={`${producto.productCode} · v${producto.productVersion} · ${PRODUCT_TYPE_LABELS[producto.productType] ?? producto.productType}`}
      onClose={onClose}
      size="wide"
    >
      <Block state={state} emptyLabel="No se pudo leer el detalle del producto.">
        {(d) => (
          <div style={{ display: 'grid', gap: 20 }}>
            <section>
              <div className="bo-grupo-cap">Condiciones</div>
              <div className="bo-defs cols-3">
                <Dato k="Tasa anual" v={rate(producto.nominalRateAnnual)} />
                <Dato k="Moratoria" v={rate(producto.moratoriumRateAnnual)} />
                <Dato k="Comisión de apertura" v={percent((producto.openingFeeRate ?? 0) * 100)} />
                {producto.behavior === 'REVOLVING' ? (
                  <Dato k="Línea de crédito"
                        v={`${money(producto.minCreditLine ?? 0)} – ${money(producto.maxCreditLine ?? 0)}`} />
                ) : (
                  <Dato k="Monto"
                        v={`${money(producto.minAmount ?? 0)} – ${money(producto.maxAmount ?? 0)}`} />
                )}
                <Dato k="Plazo" v={producto.behavior === 'REVOLVING' ? 'revolvente'
                  : `${producto.minTerm ?? '?'} – ${producto.maxTerm ?? '?'} meses`} />
                <Dato k="Audiencia" v={producto.targetAudience ?? '—'} />
              </div>
            </section>

            <section>
              <div className="bo-grupo-cap">Cómo se autoriza</div>
              <div className="bo-defs cols-3" style={{ marginBottom: 12 }}>
                <Dato k="Score mínimo de aprobación"
                      v={d.scoring.scoreMinimoAprobacion != null ? String(d.scoring.scoreMinimoAprobacion) : '—'} />
                <Dato k="Flujo por omisión" v={flujoLabel(d.scoring.flujoAprobacion)} />
                <Dato k="Política de riesgo"
                      v={d.scoring.tienePoliticaAsignada ? 'asignada' : 'sin política — sólo umbral del producto'} />
              </div>

              {!d.scoring.tienePoliticaAsignada && (
                <div className="bo-alert">
                  Este producto no tiene política de scoring configurada para su tipo de prospecto.
                  Se autoriza contra el score mínimo del propio producto, sin reglas de buró: nada
                  suma ni descalifica por comportamiento crediticio.
                </div>
              )}

              {d.scoring.porTipoProspecto
                .filter((p) => p.gobernadoPor)
                .map((p) => (
                  <Politica key={p.tipoProspecto} tipoProspecto={p.tipoProspecto}
                            politica={p.gobernadoPor!} />
                ))}
            </section>
          </div>
        )}
      </Block>
      {state.loading && <Spinner />}
    </Modal>
  );
}

function flujoLabel(f: string | null): string {
  const map: Record<string, string> = {
    AUTOMATIC: 'automático', MANUAL: 'revisión manual', COMMITTEE: 'comité',
  };
  return f ? map[f] ?? f : '—';
}
