import { isMock } from './config.js';
import { request, requestBlob } from './http.js';

/** Fila de la bandeja. El folio y el nombre los resuelve el BFF. */
export interface ApplicationRow {
  applicationId: string;
  folio: string | null;
  prospectId: string | null;
  prospectName: string | null;
  productType: string;
  requestedAmount: number | null;
  requestedTerm: number | null;
  status: string;
  approvalFlow: string | null;
  riskLevel: string | null;
  decision: string | null;
  decidedBy: string | null;
  rejectionReason: string | null;
  offeredAmount: number | null;
  offeredLine: number | null;
  offeredTerm: number | null;
  nominalRate: number | null;
  cat: number | null;
  createdAt: string | null;
}

export interface RuleDetail {
  ruleId?: string;
  ruleType: string;
  creditType?: string | null;
  matched: boolean;
  scoreApplied: number | null;
  disqualifying: boolean;
  detail?: string | null;
}

export interface Evaluation {
  evaluationId?: string;
  totalScore: number | null;
  riskLevel: string | null;
  decision: string | null;
  evaluatedAt: string | null;
  ruleDetails: RuleDetail[] | null;
}

export interface ProspectDocument {
  documentType: string;
  status?: string | null;
  fileName?: string | null;
  uploadedAt?: string | null;
}

export interface Prospect {
  prospectId: string;
  firstName?: string | null;
  lastName1?: string | null;
  lastName2?: string | null;
  curp?: string | null;
  rfc?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  stateOfBirth?: string | null;
  status?: string | null;
  address?: Record<string, unknown> | null;
  privacyNoticeAccepted?: boolean | null;
  privacyNoticeAcceptedAt?: string | null;
  circuloConsentAccepted?: boolean | null;
  circuloConsentAcceptedAt?: string | null;
  documents?: ProspectDocument[] | null;
}

/**
 * La ficha de análisis: cinco bloques de cinco fuentes distintas.
 *
 * `prospect` y `bureauReport` pueden venir `null` — el primero si el prospecto
 * no tiene captura, el segundo si el rol no analiza o si scoring no responde.
 * La UI los trata como bloques que se degradan por separado, no como error.
 */
export interface ApplicationDetail {
  // La ficha trae un superset de la fila —contrato, oferta, sellos de tiempo—
  // que la UI de decisión no usa; se tipa lo que sí se pinta.
  application: ApplicationRow;
  prospect: Prospect | null;
  evaluation: Evaluation | null;
  existingCredits: Array<Record<string, unknown>> | null;
  bureauReport: Record<string, unknown> | null;
}

/** Un archivo del expediente, sin su contenido. */
export interface ExpedienteFile {
  fileId: string;
  documentType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
}

export interface ApplicationQuery {
  status?: string;
  productType?: string;
  targetAudience?: string;
  from?: string;
  to?: string;
  q?: string;
}

/** Los estados en los que una persona todavía tiene que decidir. */
export const REVIEW_STATUSES = ['UNDER_MANUAL_REVIEW', 'COMMITTEE_REVIEW'] as const;

export const applicationsApi = {
  async list(query: ApplicationQuery = {}): Promise<ApplicationRow[]> {
    if (!isMock()) return request<ApplicationRow[]>('/origination/applications', { query: { ...query } });
    return MOCK_ROWS.filter((r) => (!query.status || r.status === query.status));
  },

  async detail(applicationId: string): Promise<ApplicationDetail> {
    if (!isMock()) return request<ApplicationDetail>(`/origination/applications/${applicationId}`);
    const row = MOCK_ROWS.find((r) => r.applicationId === applicationId) ?? MOCK_ROWS[0];
    return { application: row, prospect: null, evaluation: null, existingCredits: [], bureauReport: null };
  },

  /** Aprobar o rechazar. El motivo es obligatorio al rechazar — lo exige el BFF. */
  async decide(applicationId: string, approved: boolean, rejectionReason?: string): Promise<void> {
    if (isMock()) return;
    await request<void>(`/origination/applications/${applicationId}/decision`, {
      method: 'POST',
      body: { approved, rejectionReason },
    });
  },

  async requestDocuments(applicationId: string, note: string): Promise<void> {
    if (isMock()) return;
    await request<void>(`/origination/applications/${applicationId}/request-documents`, {
      method: 'POST',
      body: { note },
    });
  },

  /** Qué hay en el expediente. No trae los archivos: eso se pide del que se abre. */
  async expediente(applicationId: string): Promise<ExpedienteFile[]> {
    if (!isMock()) return request<ExpedienteFile[]>(`/origination/applications/${applicationId}/documents`);
    return MOCK_EXPEDIENTE;
  },

  /**
   * El archivo, como `blob:` listo para un `<img>` o un `<iframe>`.
   *
   * Va por `fetch` y no por la URL directa porque el endpoint exige el token, y una
   * etiqueta `<img src>` no manda cabeceras. Quien lo pide **debe revocar** la URL
   * al cerrar: cada documento abierto retiene su blob en memoria hasta que se haga.
   */
  async documentUrl(applicationId: string, documentType: string): Promise<string> {
    if (isMock()) return MOCK_IMAGE;
    const blob = await requestBlob(
      `/origination/applications/${applicationId}/documents/${documentType}/file`);
    return URL.createObjectURL(blob);
  },

  async documentsReceived(applicationId: string): Promise<void> {
    if (isMock()) return;
    await request<void>(`/origination/applications/${applicationId}/documents-received`, {
      method: 'POST',
    });
  },
};

const MOCK_EXPEDIENTE: ExpedienteFile[] = [
  { fileId: 'f-1', documentType: 'INE_FRONT', fileName: 'ine_front.png',
    contentType: 'image/png', sizeBytes: 24_500, uploadedAt: '2026-08-10T12:00:00Z' },
  { fileId: 'f-2', documentType: 'INE_BACK', fileName: 'ine_back.png',
    contentType: 'image/png', sizeBytes: 23_100, uploadedAt: '2026-08-10T12:00:00Z' },
];

/** Un pixel gris: en mock no hay documentos, y fingir uno legible sería peor. */
const MOCK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

const MOCK_ROWS: ApplicationRow[] = [
  {
    applicationId: 'mock-1', folio: 'SOL-202608-MOCK0001', prospectId: 'p-1',
    prospectName: 'Julieta Tejeda Rojas', productType: 'PERSONAL_LOAN',
    requestedAmount: 45000, requestedTerm: 12, status: 'UNDER_MANUAL_REVIEW',
    approvalFlow: 'MANUAL', riskLevel: 'MEDIO', decision: 'MANUAL_REVIEW',
    decidedBy: null, rejectionReason: null, offeredAmount: null, offeredLine: null,
    offeredTerm: null, nominalRate: 0.32, cat: 41.2, createdAt: '2026-08-10T12:00:00Z',
  },
];
