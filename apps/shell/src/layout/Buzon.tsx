import { useEffect, useRef, useState } from 'react';
import { notificationsApi, type Aviso } from '@bo/api-client';
import { useAsync, dateTime } from '@bo/design-system';

/**
 * Qué dice cada aviso, en una línea.
 *
 * El dominio manda `eventType` en clave —`COLLECTION_AGREEMENT_OFFERED`—, que es lo correcto para
 * un evento y lo peor posible para una campana. Lo que no esté en el mapa se humaniza en vez de
 * pintarse en mayúsculas con guiones bajos: un aviso que nadie entiende es ruido, y el ruido enseña
 * a no abrir la campana.
 */
const AVISO: Record<string, string> = {
  OFFER_PRESENTED: 'Se presentó una oferta',
  WELCOME_ACTIVATED: 'Se activó un crédito',
  DISBURSEMENT_COMPLETED: 'Se completó un desembolso',
  PAYMENT_REMINDER: 'Recordatorio de pago',
  PAYMENT_OVERDUE: 'Un pago se venció',
  INSTALLMENT_PAID: 'Entró una parcialidad',
  LOAN_SETTLED: 'Un crédito quedó liquidado',
  COLLECTION_REMINDER: 'Recordatorio de cobranza',
  COLLECTION_HOW_TO_PAY: 'Se explicó cómo pagar',
  COLLECTION_OVERDUE_NOTICE: 'Aviso de mora',
  COLLECTION_CREDIT_HISTORY: 'Aviso de historial crediticio',
  COLLECTION_OFFER_HELP: 'Se ofreció ayuda al deudor',
  COLLECTION_PAYMENT_THANKS: 'Se agradeció un pago',
  COLLECTION_AGREEMENT_OFFERED: 'Se ofreció un convenio',
};

function texto(a: Aviso): string {
  if (!a.eventType) return 'Aviso';
  return AVISO[a.eventType]
    ?? a.eventType.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * El buzón del empleado en sesión.
 *
 * <p>Se pide **al abrir**, no en bucle: un sondeo cada treinta segundos por cada pestaña abierta
 * multiplica la carga del servicio por el número de pestañas para enterarse de algo que casi nunca
 * cambia. El conteo se refresca al montar y cada vez que se abre el panel, que es cuando le importa
 * a alguien.
 *
 * <p>El BFF **nunca falla** esta llamada: si notifications no responde devuelve el buzón vacío con
 * `degraded: true`. Se dice en pantalla, porque «no tienes avisos» y «no pudimos preguntar» son
 * cosas distintas y confundirlas hace que alguien deje de revisar algo que sí tenía.
 */
export function Buzon() {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const state = useAsync(() => notificationsApi.feed(), []);

  // Cerrar al tocar fuera y con Escape: un panel anclado que sólo cierra con su propio botón
  // atrapa al que ya está mirando otra cosa.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); window.removeEventListener('keydown', esc); };
  }, [abierto]);

  const buzon = state.data;
  const sinLeer = buzon?.unreadCount ?? 0;

  const marcarLeido = async () => {
    try { await notificationsApi.markAllRead(); } catch { /* Se reintenta al reabrir. */ }
    state.reload();
  };

  return (
    <div className="bo-bell" ref={caja}>
      <button
        type="button"
        className="bo-theme-btn"
        aria-label={sinLeer > 0 ? `Buzón, ${sinLeer} sin leer` : 'Buzón'}
        aria-expanded={abierto}
        title={sinLeer > 0 ? `${sinLeer} sin leer` : 'Sin avisos nuevos'}
        onClick={() => { setAbierto((v) => !v); if (!abierto) state.reload(); }}
      >
        <span aria-hidden="true">🔔</span>
        {sinLeer > 0 && <span className="bo-bell-badge">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>

      {abierto && (
        <div className="bo-buzon" role="dialog" aria-label="Buzón">
          <div className="bo-buzon-head">
            <span>Buzón{sinLeer > 0 ? ` · ${sinLeer} sin leer` : ''}</span>
            {sinLeer > 0 && (
              <button type="button" className="bo-crumb" onClick={() => void marcarLeido()}>
                Marcar todo leído
              </button>
            )}
          </div>

          <div className="bo-buzon-lista">
            {state.loading && <div className="bo-buzon-vacio">Cargando…</div>}

            {!state.loading && buzon?.degraded && (
              <div className="bo-buzon-vacio">
                No se pudo consultar el buzón. No es que no tengas avisos: es que
                notifications-service no contestó.
              </div>
            )}

            {!state.loading && !buzon?.degraded && (buzon?.content.length ?? 0) === 0 && (
              <div className="bo-buzon-vacio">Sin avisos.</div>
            )}

            {(buzon?.content ?? []).map((a) => (
              <div key={a.notificationId} className={`bo-aviso${a.readAt ? '' : ' nuevo'}`}>
                <div className="bo-aviso-t">{texto(a)}</div>
                <div className="bo-aviso-s">
                  {dateTime(a.sentAt)}
                  {a.eventKey && <> · {a.eventKey}</>}
                  {a.status && a.status !== 'SENT' && <> · {a.status.toLowerCase()}</>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
