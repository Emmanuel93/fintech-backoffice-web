import { useMemo, useState } from 'react';
import { scoringApi, type PoliticaScoring } from '@bo/api-client';
import { useAsync, Block, CardTitled, Badge, EmptyState, count } from '@bo/design-system';
import { PRODUCT_TYPE_LABELS } from '@bo/shared-types';
import { Politica } from './PoliticaVista';

/**
 * Qué políticas de riesgo existen y qué dice cada una.
 *
 * <p>Se podía ver la política desde un producto —«bajo qué reglas se autoriza esto»— pero no al
 * revés: no había forma de saber cuántas políticas hay, cuáles cubren qué, ni cuáles quedaron sin
 * cubrir. Y esa es la pregunta de gobierno: un producto activo sin política se autoriza sólo
 * contra su score mínimo, sin mirar el buró, y desde la ficha del producto ese hueco sólo se ve
 * si a alguien se le ocurre abrirlo uno por uno.
 *
 * <p>El resumen de cada renglón dice lo que se necesita para decidir si abrirla: a quién aplica,
 * cuántas reglas trae, cuántas descalifican y dónde están los cortes. Abrir muestra la política
 * completa, con la misma vista que usa la ficha del producto — leerla en dos formatos distintos
 * sería una invitación a que digan cosas distintas.
 */
export function PoliticasLista() {
  const state = useAsync(() => scoringApi.politicas(), []);
  const [abierta, setAbierta] = useState<string | null>(null);

  return (
    <CardTitled
      title="Políticas de riesgo"
      action={<span className="bo-page-sub">Abre una para ver sus reglas y su matriz</span>}
    >
      <Block
        state={state}
        emptyLabel="No hay políticas de riesgo dadas de alta."
        isEmpty={(d) => d.length === 0}
      >
        {(politicas) => (
          <div style={{ display: 'grid', gap: 8, padding: 14 }}>
            {politicas.length === 0
              ? <EmptyState message="Sin políticas." />
              : politicas.map((p) => (
                <PoliticaFila
                  key={p.policyId}
                  politica={p}
                  abierta={abierta === p.policyId}
                  onAlternar={() => setAbierta(abierta === p.policyId ? null : p.policyId)}
                />
              ))}
          </div>
        )}
      </Block>
    </CardTitled>
  );
}

function PoliticaFila({ politica, abierta, onAlternar }: {
  politica: PoliticaScoring; abierta: boolean; onAlternar: () => void;
}) {
  const resumen = useMemo(() => {
    const descalifican = politica.reglas.filter((r) => r.descalifica).length;
    const suman = politica.reglas.filter((r) => !r.descalifica && r.puntos > 0).length;
    const restan = politica.reglas.filter((r) => !r.descalifica && r.puntos <= 0).length;
    // El corte de aprobación automática es el número que de verdad se compara entre políticas:
    // dice qué tan exigente es cada una sin leer sus reglas.
    const auto = politica.umbrales.find((u) => u.decision === 'AUTO_APPROVED');
    return { descalifican, suman, restan, auto };
  }, [politica]);

  return (
    <div className={`bo-politica-fila${abierta ? ' abierta' : ''}`}>
      <button type="button" className="bo-politica-cabecera" onClick={onAlternar}>
        <span className="bo-tree-caret" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b>{politica.nombre}</b>
          <span className="bo-tree-code"> v{politica.version}</span>
          <div className="bo-page-sub">
            {PRODUCT_TYPE_LABELS[politica.tipoProducto as keyof typeof PRODUCT_TYPE_LABELS]
              ?? politica.tipoProducto}
            {' · '}{prospectoLabel(politica.tipoProspecto)}
          </div>
        </span>
        <span className="bo-politica-cifras">
          <span title="reglas que suman puntos">{count(resumen.suman)} suman</span>
          <span title="reglas que restan puntos">{count(resumen.restan)} restan</span>
          {resumen.descalifican > 0 && (
            <span style={{ color: 'var(--bo-bad)' }} title="descalifican de entrada">
              {count(resumen.descalifican)} descalifican
            </span>
          )}
          {resumen.auto && (
            <span title="score mínimo para aprobación automática">
              auto ≥ {resumen.auto.scoreMinimo}
            </span>
          )}
        </span>
        <Badge tone={politica.activa ? 'ok' : 'muted'}>
          {politica.activa ? 'Vigente' : 'Archivada'}
        </Badge>
      </button>

      {abierta && (
        <div style={{ padding: '0 12px 12px' }}>
          <Politica tipoProspecto={politica.tipoProspecto} politica={politica} />
        </div>
      )}
    </div>
  );
}

function prospectoLabel(t: string): string {
  const map: Record<string, string> = {
    INDIVIDUAL: 'persona física', BUSINESS: 'empresa', DISTRIBUTOR: 'distribuidor',
  };
  return map[t] ?? t.toLowerCase();
}
