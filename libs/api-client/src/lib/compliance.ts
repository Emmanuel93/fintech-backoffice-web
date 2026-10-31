import type { Page } from '@bo/shared-types';
import { isMock } from './config.js';
import { request, requestBlob } from './http.js';

/**
 * Cumplimiento por persona: su identidad y su paso por las listas, para cualquier producto.
 *
 * Son dos preguntas distintas y van en dos columnas a propósito. **Identidad** es «¿es quien dice
 * ser?» —sin proveedor biométrico conectado, lo contesta una persona comparando la INE contra la
 * selfie—. **Listas** es «¿aparece en una lista de personas bloqueadas?», y una coincidencia
 * posible no es una coincidencia: casi siempre es un homónimo, y resolverla es una firma aparte.
 * Mezclarlas en un solo estado haría imposible saber cuál de las dos detiene a alguien.
 */

/** Si alguien comprobó que la persona es quien dice ser. */
export type ComplianceIdentityStatus = 'PENDING' | 'IN_REVIEW' | 'VERIFIED' | 'REJECTED';

/** Su paso por las listas. `POTENTIAL_MATCH` espera a una persona; `CONFIRMED_MATCH` bloquea. */
export type ScreeningStatus = 'PENDING' | 'CLEARED' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';

export interface VerificationRow {
  verificationId: string;
  prospectId: string;
  partyId: string | null;
  fullName: string | null;
  curp: string | null;
  rfc: string | null;
  dateOfBirth: string | null;
  identityStatus: ComplianceIdentityStatus;
  screeningStatus: ScreeningStatus;
  /** Lo que de verdad importa aguas abajo: si esta persona puede seguir. */
  allowsToProceed: boolean;
  blockReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Lo que capturó el prospecto. Se lee junto a la INE: es contra lo que se compara. */
export interface VerificationProspect {
  firstName: string | null;
  lastName1: string | null;
  lastName2: string | null;
  curp: string | null;
  rfc: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  exteriorNumber: string | null;
  neighborhood: string | null;
  municipality: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  channelType: string | null;
  prospectType: string | null;
}

export interface VerificationDocument {
  documentType: string;
  fileName: string | null;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
}

/** Una corrida contra las listas: cuándo, por qué se disparó y con qué versión de cada lista. */
export interface ScreeningCheck {
  checkedAt: string | null;
  trigger: string | null;
  outcome: string | null;
  listVersions: unknown;
  matches?: unknown;
}

/**
 * La ficha. Cada bloque puede venir `null` o vacío —el prospecto sin captura, la persona sin
 * documentos, nadie la ha cotejado todavía— y la pantalla los degrada uno por uno.
 */
export interface VerificationDetail {
  verification: VerificationRow;
  prospect: VerificationProspect | null;
  documents: VerificationDocument[] | null;
  checks: ScreeningCheck[] | null;
}

export interface VerificationsQuery {
  identityStatus?: ComplianceIdentityStatus[];
  screeningStatus?: ScreeningStatus[];
  q?: string;
  page?: number;
  size?: number;
}

export const complianceApi = {
  async list(query: VerificationsQuery = {}): Promise<Page<VerificationRow>> {
    if (isMock()) return { content: [], page: 0, size: query.size ?? 50, totalElements: 0, totalPages: 0 };
    // Repetidos —`identityStatus=A&identityStatus=B`—, como en beneficiarios: es como los declara
    // el controlador, y unidos con coma producen un 400.
    const params = new URLSearchParams();
    query.identityStatus?.forEach((s) => params.append('identityStatus', s));
    query.screeningStatus?.forEach((s) => params.append('screeningStatus', s));
    if (query.q?.trim()) params.set('q', query.q.trim());
    params.set('page', String(query.page ?? 0));
    params.set('size', String(query.size ?? 50));
    return request<Page<VerificationRow>>(`/compliance/verifications?${params.toString()}`);
  },

  async detail(verificationId: string): Promise<VerificationDetail> {
    if (isMock()) throw new Error('No disponible en modo simulado');
    return request<VerificationDetail>(`/compliance/verifications/${verificationId}`);
  },

  /** El archivo como `blob:`. Quien lo pide revoca la URL al cerrar. */
  async documentUrl(verificationId: string, documentType: string): Promise<string> {
    if (isMock()) throw new Error('No disponible en modo simulado');
    const blob = await requestBlob(
      `/compliance/verifications/${verificationId}/documents/${documentType}/file`);
    return URL.createObjectURL(blob);
  },

  /**
   * El dictamen de identidad. Las notas son obligatorias **también al aprobar**: sin proveedor,
   * «aprobada» sólo vale lo que diga quién miró qué, y eso es lo que se le pregunta en una revisión.
   */
  async reviewIdentity(
    verificationId: string, decision: 'VERIFIED' | 'REJECTED', notes: string,
  ): Promise<VerificationRow> {
    return request<VerificationRow>(`/compliance/verifications/${verificationId}/identity`, {
      method: 'POST',
      body: { decision, notes },
    });
  },

  /** Resolver una coincidencia posible: homónimo (`CLEARED`) o la persona listada. */
  async adjudicate(
    verificationId: string, decision: 'CLEARED' | 'CONFIRMED_MATCH', notes: string,
  ): Promise<VerificationRow> {
    return request<VerificationRow>(`/compliance/verifications/${verificationId}/adjudicate`, {
      method: 'POST',
      body: { decision, notes },
    });
  },
};
