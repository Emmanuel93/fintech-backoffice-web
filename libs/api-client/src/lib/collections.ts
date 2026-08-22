import { isMock } from './config.js';
import { request } from './http.js';

/**
 * Cobranza, tal como la publica el BFF.
 *
 * <p>Dos cosas que condicionan cómo se lee todo lo demás.
 *
 * <p>**El saldo bueno es el de `account`, no el del caso.** `totalDebt` del caso es una proyección
 * local que cobranza alimenta por eventos, así que va un instante por detrás de cartera. Se
 * conserva porque es contra ese número que el dominio valida el tope de condonación —si la pantalla
 * calculara el máximo con el saldo de cartera, ofrecería una quita que el backend rechaza—, pero
 * no es el que se pinta.
 *
 * <p>**Nada de esto cambia de estado al instante.** Autorizar un convenio o aprobar un quebranto
 * publica un evento; los saldos los aplica cartera después. La pantalla tiene que decirlo, no
 * fingir que ya ocurrió.
 */
export type CaseStatus = 'OPEN' | 'MANAGED' | 'LEGAL' | 'WRITTEN_OFF' | 'CLOSED';

export type DelinquencyBucket =
  | 'CURRENT' | 'B1_30' | 'B31_60' | 'B61_90' | 'B91_120' | 'B121_180' | 'B181_PLUS';

export type AgreementStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED';
export type AgreementType = 'RESTRUCTURE' | 'QUITA_PARCIAL';
export type PromiseStatus = 'ACTIVE' | 'KEPT' | 'BROKEN' | 'EXPIRED';
/**
 * Los cuatro primeros describen una llamada y los captura un agente. Los tres últimos describen el
 * ciclo de vida de un mensaje y los escribe el sistema al confirmar entrega: un WhatsApp entregado
 * no «contestó», y forzarlo a `ANSWERED` haría que el reporte de gestión contara como
 * conversaciones cosas que nadie leyó.
 */
export type ContactResult =
  | 'ANSWERED' | 'NO_ANSWER' | 'WRONG_NUMBER' | 'PROMISE_MADE'
  | 'DELIVERED' | 'READ' | 'FAILED';
export type WriteOffReason = 'UNRECOVERABLE' | 'REGULATORY' | 'LEGAL_SETTLEMENT';

/**
 * El canal de contacto lo fija la consola, no el backend.
 *
 * El dominio acepta cualquier texto no vacío. Sin un catálogo del lado del cliente, el mismo hecho
 * entra como «PHONE», «phone» y «Teléfono», y el reporte de gestión —que es lo que se le enseña a
 * CONDUSEF— deja de poder agruparse.
 */
export const CONTACT_CHANNELS = ['PHONE', 'SMS', 'EMAIL', 'WHATSAPP', 'VISIT'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export interface CollectionCase {
  caseId: string;
  creditAccountId: string;
  obligorPartyId: string | null;
  /** Lo resuelve el BFF en lote contra party; el dominio sólo guarda el id. */
  obligorName?: string | null;
  productType: string | null;
  status: CaseStatus;
  currentBucket: DelinquencyBucket;
  daysDelinquent: number;
  /** Proyección local. Para el tope de condonación, no para mostrar. */
  totalDebt: number | null;
  assignedAgentId: string | null;
  externalAgencyId: string | null;
  strategy: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

/** Los saldos reales, traídos de cartera por el BFF. Es el número que se pinta. */
export interface CaseAccount {
  contractNumber: string | null;
  productType: string | null;
  status: string | null;
  principalBalance: number | null;
  totalDebt: number | null;
  daysDelinquent: number | null;
  nominalRate: number | null;
}

/**
 * Quién originó el contacto.
 *
 * Decide algo más que una etiqueta: el tope diario CONDUSEF cuenta sólo los `MANUAL`. Si la
 * cadencia automática consumiera el cupo, un gestor llegaría al caso sin intentos disponibles por
 * mensajes que él no mandó.
 */
export type ContactOrigin = 'MANUAL' | 'AUTOMATIC';

export interface ContactAttempt {
  attemptId: string;
  caseId: string;
  channel: string;
  result: ContactResult;
  origin: ContactOrigin;
  /** Nulo en los automáticos: no hay persona a quien atribuirle el acto. */
  agentId: string | null;
  /** El mensaje concreto que salió, para poder ir del caso al texto exacto. */
  notificationId?: string | null;
  /** El escalón de tono con que salió, 1 a 5. */
  dunningStep?: number | null;
  attemptedAt: string;
}

export type HoldReason =
  | 'ACTIVE_PROMISE' | 'PROMISE_KEPT' | 'AGREEMENT_IN_FLIGHT' | 'AGENCY_ASSIGNED' | 'MANUAL';

/**
 * Un periodo en que la cobranza automática está callada.
 *
 * `active` lo resuelve el servidor: depende de comparar contra «ahora», y el ahora del navegador no
 * es el mismo. Un reloj adelantado mostraría vencido un freno que el job sigue respetando.
 */
export interface CommunicationHold {
  holdId: string;
  caseId: string;
  reason: HoldReason;
  heldUntil: string;
  sourceId: string | null;
  active: boolean;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseNote: string | null;
  createdAt: string;
}

export interface PaymentPromise {
  promiseId: string;
  caseId: string;
  amount: number;
  promisedDate: string;
  status: PromiseStatus;
  recordedBy: string | null;
  createdAt: string;
}

export interface RestructureTerms {
  newNominalRate: number | null;
  newTermMonths: number | null;
  newAmortizationType: string | null;
}

export interface CollectionAgreement {
  agreementId: string;
  caseId: string;
  creditAccountId: string;
  type: AgreementType;
  status: AgreementStatus;
  originalDebt: number | null;
  forgivenAmount: number | null;
  newTerms: RestructureTerms | null;
  authorizedBy: string | null;
  authorizationRef: string | null;
  proposedAt: string;
  respondedAt: string | null;
  executedAt: string | null;
}

export interface WriteOffRecord {
  writeOffId: string;
  caseId: string;
  creditAccountId: string;
  principalWrittenOff: number;
  interestWrittenOff: number;
  penaltyWrittenOff: number;
  totalWrittenOff: number;
  authorizedBy: string | null;
  authorizationRef: string | null;
  reason: WriteOffReason;
  bureauReported: boolean;
  writeOffDate: string;
}

export interface BureauReport {
  reportId: string;
  creditAccountId: string;
  eventType: 'WRITE_OFF' | 'QUITA_PARCIAL';
  amountReported: number | null;
  status: 'PENDING' | 'SUBMITTED' | 'FAILED';
  bureauReference: string | null;
  createdAt: string;
}

/** El caso con todo lo que la ficha necesita, ya hidratado por el BFF. */
export interface CaseDetail extends CollectionCase {
  account?: CaseAccount | null;
  contactAttempts?: ContactAttempt[];
  /** Intentos de hoy y tope, contados por el servidor con su propio corte de día. */
  contactAttemptsToday?: number;
  maxContactAttemptsPerDay?: number;
  paymentPromises?: PaymentPromise[];
  agreements?: CollectionAgreement[];
  writeOff?: WriteOffRecord | null;
  /** Por qué está callada la cobranza automática. Historial completo, no sólo lo vigente. */
  communicationHolds?: CommunicationHold[];
}

/**
 * Los límites con los que valida el dominio.
 *
 * Se piden en vez de codificarlos porque viven en `application.yml`: en cuanto ops mueva una
 * variable de entorno, una copia en el cliente empieza a mentir y el usuario descubre el límite
 * real cuando recibe un 422 que la pantalla le dijo que no iba a pasar.
 */
export interface CollectionsConfig {
  contactAllowedHoursStart: number;
  contactAllowedHoursEnd: number;
  maxContactAttemptsPerDay: number;
  maxForgivenessPct: number;
  maxTermExtensionMonths: number;
  writeOffThresholdDays: number;
  agreementResponseDays: number;
}

export interface CasesPage {
  content: CollectionCase[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface CasesQuery {
  status?: CaseStatus;
  bucket?: DelinquencyBucket;
  productType?: string;
  assignedAgentId?: string;
  minDaysDelinquent?: number;
  page?: number;
  size?: number;
  sort?: string;
}

export const collectionsApi = {
  async cases(query: CasesQuery = {}): Promise<CasesPage> {
    if (!isMock()) return request<CasesPage>('/collections/cases', { query: { ...query } });
    return MOCK_PAGE;
  },

  async caseById(caseId: string): Promise<CaseDetail> {
    if (!isMock()) return request<CaseDetail>(`/collections/cases/${caseId}`);
    return MOCK_DETAIL;
  },

  async caseByAccount(creditAccountId: string): Promise<CaseDetail> {
    if (!isMock()) return request<CaseDetail>(`/collections/accounts/${creditAccountId}/case`);
    return MOCK_DETAIL;
  },

  async config(): Promise<CollectionsConfig> {
    if (!isMock()) return request<CollectionsConfig>('/collections/config');
    return MOCK_CONFIG;
  },

  async recordContact(caseId: string, body: { channel: ContactChannel; result: ContactResult }) {
    return request<ContactAttempt>(`/collections/cases/${caseId}/contact-attempts`, {
      method: 'POST', body,
    });
  },

  async createPromise(caseId: string, body: { amount: number; promisedDate: string }) {
    return request<PaymentPromise>(`/collections/cases/${caseId}/payment-promises`, {
      method: 'POST', body,
    });
  },

  async proposeAgreement(
    caseId: string,
    body: { type: AgreementType; forgivenAmount?: number; newTerms?: RestructureTerms },
  ) {
    return request<CollectionAgreement>(`/collections/cases/${caseId}/agreements`, {
      method: 'POST', body,
    });
  },

  async acceptAgreement(agreementId: string) {
    return request<CollectionAgreement>(`/collections/agreements/${agreementId}/accept`, { method: 'PUT' });
  },

  async rejectAgreement(agreementId: string) {
    return request<CollectionAgreement>(`/collections/agreements/${agreementId}/reject`, { method: 'PUT' });
  },

  async authorizeAgreement(agreementId: string, body: { authorizedBy: string; authorizationRef: string }) {
    return request<CollectionAgreement>(`/collections/agreements/${agreementId}/authorize`, {
      method: 'PUT', body,
    });
  },

  async awaitingAuthorization(): Promise<CollectionAgreement[]> {
    if (!isMock()) return request<CollectionAgreement[]>('/collections/agreements/awaiting-authorization');
    return [];
  },

  async requestWriteOff(caseId: string, body: { reason: WriteOffReason }) {
    return request<void>(`/collections/cases/${caseId}/request-write-off`, { method: 'POST', body });
  },

  async approveWriteOff(
    caseId: string,
    body: { reason: WriteOffReason; authorizedBy: string; authorizationRef: string },
  ) {
    return request<WriteOffRecord>(`/collections/cases/${caseId}/write-offs`, { method: 'POST', body });
  },

  async bureauReports(): Promise<BureauReport[]> {
    if (!isMock()) return request<BureauReport[]>('/collections/bureau-reports');
    return [];
  },
};

const MOCK_CONFIG: CollectionsConfig = {
  contactAllowedHoursStart: 8, contactAllowedHoursEnd: 20, maxContactAttemptsPerDay: 3,
  maxForgivenessPct: 0.3, maxTermExtensionMonths: 12,
  writeOffThresholdDays: 181, agreementResponseDays: 5,
};

const MOCK_CASE: CollectionCase = {
  caseId: 'c-1', creditAccountId: 'a-1', obligorPartyId: 'p-1', obligorName: 'Julieta Tejeda Rojas',
  productType: 'SIMPLE', status: 'MANAGED', currentBucket: 'B31_60', daysDelinquent: 45,
  totalDebt: 18400, assignedAgentId: null, externalAgencyId: null,
  strategy: 'AGENT_ASSIGNED_RESTRUCTURE_OFFER', openedAt: '2026-07-01T10:00:00Z', closedAt: null,
};

const MOCK_PAGE: CasesPage = {
  content: [MOCK_CASE], page: 0, size: 25, totalElements: 1, totalPages: 1,
};

const MOCK_DETAIL: CaseDetail = {
  ...MOCK_CASE,
  account: {
    contractNumber: 'CTR-202607-0001', productType: 'SIMPLE', status: 'ACTIVE',
    principalBalance: 16000, totalDebt: 18400, daysDelinquent: 45, nominalRate: 0.32,
  },
  contactAttempts: [], contactAttemptsToday: 0, maxContactAttemptsPerDay: 3,
  paymentPromises: [], agreements: [], writeOff: null, communicationHolds: [],
};

/* ============================ Bandejas transversales ============================
 *
 * Promesas y contactos **cruzando casos**, no dentro de uno.
 *
 * La consola sólo podía verlos abriendo un caso, así que «qué promesas vencen hoy» o «a quién no
 * hemos podido contactar» exigía abrir los casos uno por uno. Lo resuelve `collections` con una
 * consulta indexada y el BFF lo publica tal cual: es el patrón B —la lista la contesta el dueño—,
 * no un recorrido por filas.
 *
 * Las dos respuestas traen `contactWindow`: la ventana en que se puede llamar y el tope de
 * intentos. Viene del servidor y no de la pantalla porque es una **regla**, no una sugerencia
 * visual — es lo que permite deshabilitar con la razón a la vista en vez de traducir un 422.
 */

export interface VentanaContacto {
  startHour: number;
  endHour: number;
  maxAttemptsPerDay: number;
  withinWindowNow: boolean;
}

/** Una promesa con el contexto de su caso ya resuelto: sin esto la fila no dice a quién llamar. */
export interface PromesaEnCola {
  promiseId: string;
  caseId: string;
  amount: number;
  promisedDate: string | null;
  status: PromiseStatus;
  recordedBy: string | null;
  createdAt: string | null;
  creditAccountId: string | null;
  obligorPartyId: string | null;
  obligorName: string | null;
  productType: string | null;
  currentBucket: DelinquencyBucket;
  daysDelinquent: number;
  assignedAgentId: string | null;
  dueToday: boolean;
  /** Se pasó de la fecha prometida y sigue viva. */
  overdue: boolean;
  attemptsToday: number;
  lastContactResult: ContactResult | null;
  /** Ya se agotaron los intentos de hoy. */
  contactCapReached: boolean;
  /** Se puede llamar ahora mismo: dentro de ventana y sin agotar intentos. */
  contactable: boolean;
}

export interface GestionEnCola {
  attemptId: string;
  caseId: string;
  channel: ContactChannel;
  result: ContactResult;
  origin: string | null;
  agentId: string | null;
  dunningStep: number | null;
  attemptedAt: string | null;
  creditAccountId: string | null;
  obligorPartyId: string | null;
  obligorName: string | null;
  productType: string | null;
  currentBucket: DelinquencyBucket;
  daysDelinquent: number;
  assignedAgentId: string | null;
}

export interface ColaPage<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  contactWindow: VentanaContacto;
}

export interface PromesasQuery {
  status?: PromiseStatus[];
  bucket?: DelinquencyBucket[];
  agentId?: string[];
  dueFrom?: string;
  dueTo?: string;
  dueToday?: boolean;
  page?: number;
  size?: number;
}

export interface GestionesQuery {
  result?: ContactResult[];
  channel?: ContactChannel[];
  bucket?: DelinquencyBucket[];
  agentId?: string[];
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

/** Los filtros de lista van repetidos (`status=A&status=B`), que es como los declara el controlador. */
function query(pares: Array<[string, unknown]>): string {
  const p = new URLSearchParams();
  pares.forEach(([k, v]) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  });
  return p.toString();
}

const colaVacia = <T,>(size: number): ColaPage<T> => ({
  content: [], page: 0, size, totalElements: 0, totalPages: 0,
  contactWindow: { startHour: 8, endHour: 20, maxAttemptsPerDay: 3, withinWindowNow: true },
});

export const collectionsQueueApi = {
  async promises(q: PromesasQuery = {}): Promise<ColaPage<PromesaEnCola>> {
    if (isMock()) return colaVacia(q.size ?? 50);
    const qs = query([
      ['status', q.status], ['bucket', q.bucket], ['agentId', q.agentId],
      ['dueFrom', q.dueFrom], ['dueTo', q.dueTo],
      ['dueToday', q.dueToday ? 'true' : ''],
      ['page', q.page ?? 0], ['size', q.size ?? 50],
    ]);
    return request<ColaPage<PromesaEnCola>>(`/collections/payment-promises?${qs}`);
  },

  async contactAttempts(q: GestionesQuery = {}): Promise<ColaPage<GestionEnCola>> {
    if (isMock()) return colaVacia(q.size ?? 50);
    const qs = query([
      ['result', q.result], ['channel', q.channel], ['bucket', q.bucket], ['agentId', q.agentId],
      ['from', q.from], ['to', q.to],
      ['page', q.page ?? 0], ['size', q.size ?? 50],
    ]);
    return request<ColaPage<GestionEnCola>>(`/collections/contact-attempts?${qs}`);
  },
};
