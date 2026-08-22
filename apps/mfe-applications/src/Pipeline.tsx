import { useMemo } from 'react';
import type { ApplicationRow } from '@bo/api-client';
import { money, count, percent } from '@bo/design-system';

/**
 * El embudo de crédito, de la solicitud al desembolso.
 *
 * <p>La bandeja contestaba «qué solicitudes hay» y no «cómo va el negocio». Con once estatus en una
 * columna de tabla, saber cuántas esperan decisión humana obligaba a filtrar por cada uno y llevar
 * la cuenta a mano, y nadie hace eso: se abría la pantalla, se miraba la primera página y se
 * cerraba. Un embudo contesta de un vistazo dónde se está atorando la originación.
 *
 * <p>Los estatus se agrupan por <b>quién tiene la pelota</b>, no por orden alfabético ni por el
 * enum: el motor, una persona, el cliente, o nadie porque ya terminó. Es la lectura con la que se
 * decide dónde meter gente un lunes por la mañana.
 *
 * <p>Cada etapa es un filtro: al hacer clic, la tabla de abajo muestra exactamente esas. Un tablero
 * que sólo informa obliga a traducir a mano lo que acaba de leerse en un filtro.
 */

/** Etapa del embudo: qué estatus la componen y de quién depende avanzar. */
interface Etapa {
  clave: string;
  titulo: string;
  /** De quién depende que avance. Es lo que convierte un conteo en una acción. */
  quien: string;
  estatus: string[];
  tono: 'neutro' | 'espera' | 'ok' | 'bad';
}

export const ETAPAS: Etapa[] = [
  { clave: 'evaluacion', titulo: 'En evaluación', quien: 'el motor',
    estatus: ['PENDING_SCORING', 'SCORING'], tono: 'neutro' },
  { clave: 'decision', titulo: 'Esperan decisión', quien: 'una persona',
    estatus: ['UNDER_MANUAL_REVIEW', 'COMMITTEE_REVIEW', 'PENDING_DOCUMENTS'], tono: 'espera' },
  { clave: 'aprobadas', titulo: 'Aprobadas', quien: 'listo para ofertar',
    estatus: ['APPROVED'], tono: 'ok' },
  { clave: 'oferta', titulo: 'En oferta', quien: 'el cliente',
    estatus: ['OFFER_PRESENTED', 'OFFER_ACCEPTED'], tono: 'neutro' },
  { clave: 'firma', titulo: 'Formalización', quien: 'el cliente firma',
    estatus: ['PENDING_SIGNATURE', 'CONTRACT_SIGNED'], tono: 'neutro' },
  { clave: 'desembolsadas', titulo: 'Desembolsadas', quien: 'terminadas',
    estatus: ['DISBURSED'], tono: 'ok' },
  { clave: 'rechazadas', titulo: 'Rechazadas', quien: 'terminadas',
    estatus: ['REJECTED'], tono: 'bad' },
];

export function Pipeline({ rows, activa, onElegir }: {
  /** Todas las solicitudes del periodo, **sin** filtrar por estatus: el embudo es el total. */
  rows: ApplicationRow[];
  activa: string | null;
  onElegir: (estatus: string[] | null) => void;
}) {
  const resumen = useMemo(() => {
    const porEtapa = new Map<string, { n: number; monto: number; detalle: Map<string, number> }>();
    ETAPAS.forEach((e) => porEtapa.set(e.clave, { n: 0, monto: 0, detalle: new Map() }));
    let sinClasificar = 0;
    for (const r of rows) {
      const etapa = ETAPAS.find((e) => e.estatus.includes(r.status));
      if (!etapa) { sinClasificar++; continue; }
      const acc = porEtapa.get(etapa.clave)!;
      acc.n += 1;
      acc.monto += r.requestedAmount ?? 0;
      acc.detalle.set(r.status, (acc.detalle.get(r.status) ?? 0) + 1);
    }
    return { porEtapa, sinClasificar };
  }, [rows]);

  const total = rows.length;
  const resueltas = (resumen.porEtapa.get('desembolsadas')?.n ?? 0)
                  + (resumen.porEtapa.get('rechazadas')?.n ?? 0);
  const desembolsadas = resumen.porEtapa.get('desembolsadas')?.n ?? 0;
  // Tasa de aprobación sobre lo **resuelto**, no sobre el total: incluir las que siguen en
  // trámite la deprime sin que nadie haya rechazado nada, y entonces el número no mide una
  // política de crédito sino cuántas solicitudes entraron esta semana.
  const tasaAprobacion = resueltas === 0 ? 0 : (desembolsadas * 100) / resueltas;
  const enEspera = resumen.porEtapa.get('decision')?.n ?? 0;

  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      <div className="bo-kpis">
        <KpiSimple label="Solicitudes" valor={count(total)}
                   pie={`${money(rows.reduce((s, r) => s + (r.requestedAmount ?? 0), 0))} solicitados`} />
        <KpiSimple label="Esperan decisión humana" valor={count(enEspera)}
                   pie={enEspera > 0 ? 'requieren a alguien hoy' : 'nada atorado'}
                   tono={enEspera > 0 ? 'espera' : 'ok'} />
        <KpiSimple label="Tasa de aprobación" valor={percent(tasaAprobacion, 0)}
                   pie={`sobre ${count(resueltas)} ya resueltas`} />
        <KpiSimple label="Desembolsadas" valor={count(desembolsadas)}
                   pie={money(resumen.porEtapa.get('desembolsadas')?.monto ?? 0)} tono="ok" />
      </div>

      <div className="bo-embudo">
        {ETAPAS.map((e) => {
          const acc = resumen.porEtapa.get(e.clave)!;
          const parte = total === 0 ? 0 : (acc.n * 100) / total;
          const seleccionada = activa === e.clave;
          return (
            <button
              type="button"
              key={e.clave}
              className={`bo-etapa t-${e.tono}${seleccionada ? ' activa' : ''}`}
              onClick={() => onElegir(seleccionada ? null : e.estatus)}
              title={`${e.titulo} — depende de ${e.quien}. Clic para filtrar la tabla.`}
            >
              <div className="bo-etapa-n">{count(acc.n)}</div>
              <div className="bo-etapa-t">{e.titulo}</div>
              <div className="bo-etapa-q">{e.quien}</div>
              {/* La barra da la proporción sin obligar a comparar números entre sí. */}
              <div className="bo-etapa-barra"><span style={{ width: `${parte}%` }} /></div>
              <div className="bo-etapa-m">{acc.monto > 0 ? money(acc.monto) : '—'}</div>
              {/* El desglose fino sólo si la etapa junta varios estatus: para una sola sería
                  repetir el título en letra chica. */}
              {acc.detalle.size > 1 && (
                <div className="bo-etapa-d">
                  {[...acc.detalle.entries()].map(([s, n]) => (
                    <span key={s}>{estatusCorto(s)} {n}</span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {resumen.sinClasificar > 0 && (
        <span className="bo-page-sub">
          {count(resumen.sinClasificar)} solicitudes con un estatus que el embudo todavía no
          agrupa — aparecen en la tabla, no en las etapas.
        </span>
      )}
    </div>
  );
}

function KpiSimple({ label, valor, pie, tono }: {
  label: string; valor: string; pie: string; tono?: 'espera' | 'ok';
}) {
  const color = tono === 'espera' ? 'var(--bo-warn)' : tono === 'ok' ? 'var(--bo-ok)' : undefined;
  return (
    <div className="bo-kpi">
      <div className="bo-kpi-label">{label}</div>
      <div className="bo-kpi-value">{valor}</div>
      <div className="bo-kpi-delta" style={{ color: color ?? 'var(--bo-text-muted)' }}>{pie}</div>
    </div>
  );
}

/** Nombre corto para el desglose dentro de una etapa, donde no cabe la etiqueta larga. */
function estatusCorto(s: string): string {
  const map: Record<string, string> = {
    PENDING_SCORING: 'por evaluar',
    SCORING: 'evaluando',
    UNDER_MANUAL_REVIEW: 'revisión',
    COMMITTEE_REVIEW: 'comité',
    PENDING_DOCUMENTS: 'documentos',
    OFFER_PRESENTED: 'presentada',
    OFFER_ACCEPTED: 'aceptada',
    PENDING_SIGNATURE: 'por firmar',
    CONTRACT_SIGNED: 'firmada',
  };
  return map[s] ?? s.toLowerCase();
}
