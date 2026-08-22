import { isMock } from './config.js';
import { request } from './http.js';

/**
 * El buzón del empleado en sesión.
 *
 * No es el histórico de un cliente —eso vive en `notifications-service` por `partyId`—: son los
 * avisos dirigidos a **quien está usando la consola**, y el BFF los resuelve por el `staffUserId`
 * del token. Por eso no lleva parámetro de destinatario: pedir el buzón de otro no es una operación
 * que exista.
 *
 * El BFF **nunca falla** esta llamada: si notifications no responde devuelve un buzón vacío con
 * `degraded: true`. Una campana que rompe la barra superior deja inservible toda la consola por un
 * panel accesorio.
 */
export interface Aviso {
  notificationId: string;
  /** Qué pasó, en clave del dominio: `COLLECTION_AGREEMENT_OFFERED`, `PAYMENT_OVERDUE`… */
  eventType: string | null;
  /** Sobre qué objeto — contrato, caso, solicitud. Es lo que permite llevar a alguien al sitio. */
  eventKey: string | null;
  channel: string | null;
  status: string | null;
  failureReason: string | null;
  sentAt: string | null;
  readAt: string | null;
}

export interface Buzon {
  recipientType: string;
  recipientId: string;
  unreadCount: number;
  content: Aviso[];
  /** `true` cuando notifications no contestó: el buzón está vacío por indisponibilidad, no por paz. */
  degraded?: boolean;
}

export const notificationsApi = {
  async feed(unreadOnly = false): Promise<Buzon> {
    if (isMock()) {
      return { recipientType: 'STAFF', recipientId: 'mock', unreadCount: 0, content: [], degraded: true };
    }
    return request<Buzon>('/notifications', { query: { unreadOnly: String(unreadOnly) } });
  },

  /** Marca todo el buzón como leído. Devuelve cuántos cambió. */
  async markAllRead(): Promise<{ updated: number }> {
    if (isMock()) return { updated: 0 };
    return request<{ updated: number }>('/notifications/read-all', { method: 'PUT' });
  },
};
