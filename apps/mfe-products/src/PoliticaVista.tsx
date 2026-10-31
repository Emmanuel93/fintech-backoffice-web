import type { PoliticaScoring, ReglaScoring } from '@bo/api-client';
import { Badge, money, percent } from '@bo/design-system';

/**
 * Cómo se lee una política de riesgo.
 *
 * <p>Vive aparte porque se muestra en dos sitios: dentro de la ficha de un producto —«bajo qué
 * reglas se autoriza esto»— y en el listado de políticas —«qué políticas existen y qué dice cada
 * una». Con dos copias, la del listado se habría quedado atrás en cuanto se agregara una
 * variable, y entonces la misma política se leería distinto según por dónde se llegue.
 */
export function Politica({ tipoProspecto, politica }: { tipoProspecto: string; politica: PoliticaScoring }) {
  // Las descalificantes primero: una sola de ellas manda a rechazo sin evaluar el resto, así que
  // leerlas después de veinte reglas que suman puntos invierte el orden en que se decide.
  const descalifican = politica.reglas.filter((r) => r.descalifica);
  const suman = politica.reglas.filter((r) => !r.descalifica && r.puntos > 0);
  const restan = politica.reglas.filter((r) => !r.descalifica && r.puntos <= 0);

  return (
    <div className="bo-politica">
      <div className="bo-politica-head">
        <div>
          <b>{politica.nombre}</b>
          <span className="bo-tree-code"> · {tipoProspecto} · v{politica.version}</span>
        </div>
        <Badge tone={politica.activa ? 'ok' : 'muted'}>{politica.activa ? 'Activa' : 'Inactiva'}</Badge>
      </div>

      {politica.descripcion && (
        <p className="bo-page-sub" style={{ margin: '0 0 12px' }}>{politica.descripcion}</p>
      )}

      {/* Los umbrales primero: son el marcador final —qué score se traduce en qué decisión— y sin
          ellos las reglas de abajo son puntos sin escala en la que valgan algo. */}
      <div className="bo-umbrales">
        {politica.umbrales.map((u) => (
          <div key={u.nivelRiesgo} className={`bo-umbral n-${u.nivelRiesgo.toLowerCase()}`}>
            <div className="bo-umbral-n">{u.nivelRiesgo}</div>
            <div className="bo-umbral-s">
              {u.scoreMinimo <= -9000 ? 'cualquier score menor' : `score ≥ ${u.scoreMinimo}`}
            </div>
            <div className="bo-umbral-d">{decisionLabel(u.decision)}</div>
          </div>
        ))}
      </div>

      <SinHistorial politica={politica} />

      <GrupoReglas titulo="Descalifican de entrada" reglas={descalifican} tono="bad"
                   nota="Se cumple una y la solicitud va a rechazo sin evaluar el resto." />
      <GrupoReglas titulo="Suman puntos" reglas={suman} tono="ok" />
      <GrupoReglas titulo="Restan puntos" reglas={restan} tono="warn" />
    </div>
  );
}

/**
 * Qué pasa con quien no tiene historial en buró. Va junto a la matriz porque es la matriz la que
 * decide: el score sin historial cae en una de sus bandas como cualquier otro.
 */
function SinHistorial({ politica }: { politica: PoliticaScoring }) {
  const sh = politica.sinHistorial ?? { score: 0, requisitos: [] };
  const banda = [...politica.umbrales]
    .sort((a, b) => b.scoreMinimo - a.scoreMinimo)
    .find((u) => sh.score >= u.scoreMinimo) ?? politica.umbrales[politica.umbrales.length - 1];
  return (
    <div className="bo-page-sub" style={{ marginTop: 10 }}>
      <b>Sin historial en buró:</b> score {sh.score}
      {banda && <> → {banda.nivelRiesgo}, {decisionLabel(banda.decision)}</>}
      {sh.requisitos.length > 0 && <> · se pide: {sh.requisitos.map((r) => r.etiqueta).join(', ')}</>}
    </div>
  );
}

function GrupoReglas({ titulo, reglas, tono, nota }: {
  titulo: string; reglas: ReglaScoring[]; tono: 'ok' | 'warn' | 'bad'; nota?: string;
}) {
  if (reglas.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="bo-regla-titulo">
        {titulo} <span className="bo-tree-code">· {reglas.length}</span>
      </div>
      {nota && <div className="bo-page-sub" style={{ margin: '2px 0 6px' }}>{nota}</div>}
      <div style={{ display: 'grid', gap: 4 }}>
        {reglas.map((r, i) => (
          <div key={`${r.tipo}-${i}`} className={`bo-regla t-${tono}`}>
            <span className="bo-regla-attr">{atributoLabel(r.tipo)}</span>
            <span className="bo-regla-cond">{r.legible}</span>
            <span className="bo-regla-pts">
              {r.descalifica ? 'descalifica' : `${r.puntos > 0 ? '+' : ''}${r.puntos} pts`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dato({ k, v }: { k: string; v: string }) {
  return <div><div className="bo-def-k">{k}</div><div className="bo-def-v">{v}</div></div>;
}

/**
 * Qué atributo del expediente mira cada regla.
 *
 * El tipo crudo —MORA_CHECK, FICO_THRESHOLD— nombra la regla desde dentro del motor. Quien abre el
 * catálogo pregunta qué se toma en cuenta, y la respuesta es el atributo: los días de mora, el
 * puntaje del buró, cuántas tarjetas trae.
 */
function atributoLabel(tipo: string): string {
  const map: Record<string, string> = {
    // Comportamiento de pago
    MORA_CHECK: 'Días de mora',
    WORST_ARREARS_BALANCE: 'Mora máxima histórica',
    BALANCE_CHECK: 'Saldo en mora actual',
    OVERDUE_ACCOUNTS_COUNT: 'Cuentas en mora',
    CURRENT_ACCOUNTS_COUNT: 'Cuentas al corriente',
    OVERDUE_PAYMENTS_COUNT: 'Pagos vencidos',
    ARREARS_RECENCY_MONTHS: 'Antigüedad del atraso',
    PREVENTION_KEY_COUNT: 'Clave de prevención',
    // Exposición y capacidad
    TOTAL_DEBT: 'Deuda total',
    CREDIT_UTILIZATION: 'Uso de líneas',
    MONTHLY_PAYMENT_LOAD: 'Pago mensual',
    DEBT_TO_INCOME: 'Carga vs ingreso',
    // Perfil crediticio
    FICO_THRESHOLD: 'Puntaje FICO',
    CREDIT_COUNT: 'Créditos vigentes',
    CREDIT_HISTORY_MONTHS: 'Antigüedad historial',
    INQUIRY_COUNT: 'Consultas al buró',
    // Persona
    AGE_YEARS: 'Edad',
    MONTHLY_INCOME: 'Ingreso mensual',
    EMPLOYMENT_MONTHS: 'Antigüedad laboral',
    DEPENDENTS_COUNT: 'Dependientes',
  };
  return map[tipo] ?? tipo;
}

function decisionLabel(d: string): string {
  const map: Record<string, string> = {
    AUTO_APPROVED: 'aprobación automática',
    MANUAL_REVIEW: 'a revisión manual',
    REJECTED: 'rechazo',
  };
  return map[d] ?? d.toLowerCase();
}

