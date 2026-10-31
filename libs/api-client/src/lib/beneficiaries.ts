import type { Page } from '@bo/shared-types';
import { isMock } from './config.js';
import { request, requestBlob } from './http.js';

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

/**
 * El veredicto explícito de una persona sobre esa identidad, sin derivar.
 *
 * `identityStatus` mezcla dos cosas —lo que se dictaminó y, si nadie lo ha hecho, en qué paso va—;
 * esto es sólo lo primero. `PENDING` = nadie la ha revisado, que es la pregunta de la mesa.
 */
export type IdentityDecision = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** Los tres archivos que sube la beneficiaria desde la liga. */
export type BeneficiaryDocumentType = 'INE_FRONT' | 'INE_BACK' | 'SELFIE';

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
  // El dictamen, campo por campo. Opcionales porque la bandeja de una versión anterior del BFF no
  // los traía, y la pantalla tiene que seguir leyéndola.
  identityDecision?: IdentityDecision | null;
  /** `MANUAL` mientras no haya proveedor biométrico contratado. */
  identityVerificationSource?: string | null;
  identityDecidedBy?: string | null;
  identityDecidedAt?: string | null;
  identityRejectionReason?: string | null;
  identityReviewNotes?: string | null;
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

/** Un archivo del expediente de la beneficiaria, sin su contenido. */
export interface BeneficiaryDocument {
  documentType: BeneficiaryDocumentType | string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
}

/** Lo que ella capturó en la liga —prellenado de su INE y corregido por ella—. */
export interface BeneficiaryCaptured {
  firstName: string | null;
  lastName1: string | null;
  lastName2: string | null;
  curp: string | null;
  rfc: string | null;
  dateOfBirth: string | null;
  occupation: string | null;
  monthlyIncome: number | null;
  street: string | null;
  exteriorNumber: string | null;
  neighborhood: string | null;
  municipality: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** Enmascarada en origen: la consola necesita saber que existe, no poder copiarla. */
  clabeMasked: string | null;
}

export interface BeneficiaryConsent {
  consentType: 'PRIVACY_NOTICE' | 'BUREAU_AUTHORIZATION' | 'CREDIT_OWNERSHIP' | string;
  /** Qué texto aceptó. Sin la versión, un consentimiento no prueba a qué se dijo que sí. */
  textVersion: string | null;
  acceptedAt: string | null;
  ipAddress: string | null;
}

/**
 * Con qué se dictamina la identidad.
 *
 * `available: false` trae su `reason` —todavía no termina la liga, o el servicio no lo publica— y
 * no es un error: es la respuesta a «¿hay algo que mirar?».
 */
export interface IdentityEvidence {
  available: boolean;
  reason?: string | null;
  documents?: BeneficiaryDocument[] | null;
  captured?: BeneficiaryCaptured | null;
  consents?: BeneficiaryConsent[] | null;
}

export interface PlacementDetail {
  placement: Placement;
  timeline: PlacementStep[];
  identityEvidence?: IdentityEvidence | null;
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
    // El BFF filtra por `identityDecision` —el veredicto con autor— y no por `identityStatus`, que
    // es derivado. Mandar `identityStatus` se ignoraba en silencio y el filtro no filtraba nada.
    // «Pendiente» y «en curso» son el mismo veredicto (nadie ha dictaminado); «sin comprobar» es
    // un rechazo.
    const decision: Record<IdentityStatus, string> = {
      PENDING: 'PENDING', IN_PROGRESS: 'PENDING', VERIFIED: 'VERIFIED', NOT_VERIFIED: 'REJECTED',
    } as Record<IdentityStatus, string>;
    new Set(query.identityStatus?.map((s) => decision[s] ?? s))
      .forEach((d) => params.append('identityDecision', d));
    if (query.stalledDays != null) params.set('stalledDays', String(query.stalledDays));
    params.set('page', String(query.page ?? 0));
    params.set('size', String(query.size ?? 50));
    return request<Page<Placement>>(`/beneficiaries/placements?${params.toString()}`);
  },

  async detail(placementId: string): Promise<PlacementDetail> {
    if (isMock()) throw new Error('No disponible en modo simulado');
    return request<PlacementDetail>(`/beneficiaries/placements/${placementId}`);
  },

  /**
   * Un documento de la beneficiaria como `blob:`. Mismo trato que el expediente de solicitudes: el
   * endpoint exige el token, y quien lo pide revoca la URL al cerrar.
   */
  async documentUrl(placementId: string, documentType: string): Promise<string> {
    if (isMock()) throw new Error('No disponible en modo simulado');
    const blob = await requestBlob(
      `/beneficiaries/placements/${placementId}/documents/${documentType}/file`);
    return URL.createObjectURL(blob);
  },

  /**
   * El dictamen de identidad. Quién lo firma lo pone el BFF desde la sesión, nunca el cuerpo: si el
   * cliente pudiera decirlo, se podría firmar con el nombre de otro.
   */
  async reviewIdentity(
    placementId: string, decision: 'VERIFIED' | 'REJECTED', rejectionReason?: string,
  ): Promise<void> {
    if (isMock()) return;
    await request<unknown>(`/beneficiaries/placements/${placementId}/identity-review`, {
      method: 'POST',
      body: { decision, rejectionReason: decision === 'REJECTED' ? rejectionReason : undefined },
    });
  },
};
