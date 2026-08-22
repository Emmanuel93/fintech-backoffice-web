import type { Page } from '@bo/shared-types';
import { isMock } from './config.js';
import { request } from './http.js';

/**
 * Colocaciones a beneficiarios: el B2B2C visto desde la financiera.
 *
 * Una distribuidora invita a una persona con una liga, esa persona verifica su identidad desde el
 * teléfono, se consulta su historial, la distribuidora decide colocar **firmando que asume el
 * riesgo**, y el dinero sale por SPEI a la CLABE de la beneficiaria. La deuda queda con la
 * distribuidora, no con ella.
 *
 * Lo que la financiera valida es **identidad, no riesgo**: el score que ve la distribuidora es
 * informativo y no bloquea la colocación. Lo único que detiene el depósito es una identidad sin
 * comprobar — por eso `identityStatus` y `disbursementAllowed` van separados del `status` del
 * proceso, y por eso el teléfono llega enmascarado desde el servicio: es dato de una persona que no
 * es cliente de la casa.
 */

/** El proceso, de la liga al pago. Cinco de estos estados son terminales. */
export type PlacementStatus =
  | 'INVITED' | 'KYC_IN_PROGRESS' | 'KYC_COMPLETED' | 'BUREAU_READY'
  | 'APPROVED' | 'DISBURSING' | 'DISBURSED' | 'PAID_OFF'
  | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

/** Si su identidad está comprobada. Es lo que habilita el depósito, y sólo eso lo detiene. */
export type IdentityStatus = 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'NOT_VERIFIED';

export interface Placement {
  placementId: string;
  distributorPartyId: string;
  /** Lo resuelve el BFF contra party para no obligar a la pantalla a pedirlo por fila. */
  distributorName: string | null;
  beneficiaryName: string | null;
  /** Enmascarado en origen. La consola no debe poder recomponerlo. */
  beneficiaryPhoneMask: string | null;
  beneficiaryPartyId: string | null;
  status: PlacementStatus;
  /** Por qué se detuvo. Los estados de fallo siempre lo traen. */
  statusReason: string | null;
  identityStatus: IdentityStatus;
  disbursementAllowed: boolean;
  amount: number;
  termFortnights: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Días sin avanzar. Es lo que convierte la bandeja en una cola de trabajo. */
  staleDays: number;
}

/** Cada salto de estado, con quién lo provocó. Es la trazabilidad de la colocación. */
export interface PlacementStep {
  fromStatus: PlacementStatus | null;
  toStatus: PlacementStatus;
  actor: 'DISTRIBUTOR' | 'BENEFICIARY' | 'SYSTEM' | string;
  actorPartyId: string | null;
  reason: string | null;
  occurredAt: string | null;
}

export interface PlacementDetail {
  placement: Placement;
  timeline: PlacementStep[];
}

export interface PlacementsQuery {
  distributorPartyId?: string;
  status?: PlacementStatus[];
  identityStatus?: IdentityStatus[];
  /** Sólo las que llevan al menos estos días sin moverse. */
  stalledDays?: number;
  page?: number;
  size?: number;
}

export const beneficiariesApi = {
  async list(query: PlacementsQuery = {}): Promise<Page<Placement>> {
    if (isMock()) return { content: [], page: 0, size: query.size ?? 50, totalElements: 0, totalPages: 0 };
    // Los filtros de lista van repetidos —`status=A&status=B`—, que es como los declara el
    // controlador; unirlos con coma produce un 400 que parece un fallo de la pantalla.
    const params = new URLSearchParams();
    if (query.distributorPartyId) params.set('distributorPartyId', query.distributorPartyId);
    query.status?.forEach((s) => params.append('status', s));
    query.identityStatus?.forEach((s) => params.append('identityStatus', s));
    if (query.stalledDays != null) params.set('stalledDays', String(query.stalledDays));
    params.set('page', String(query.page ?? 0));
    params.set('size', String(query.size ?? 50));
    return request<Page<Placement>>(`/beneficiaries/placements?${params.toString()}`);
  },

  async detail(placementId: string): Promise<PlacementDetail> {
    if (isMock()) throw new Error('No disponible en modo simulado');
    return request<PlacementDetail>(`/beneficiaries/placements/${placementId}`);
  },
};
