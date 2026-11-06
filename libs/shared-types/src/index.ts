// Shared contracts between the backoffice web apps and channel-backoffice-service (BFF).
// Field names mirror the backend DTOs discovered in fintech-services.

/* ============================ Auth / RBAC ============================ */

export const ROLES = [
  'ADMIN',
  'OPS_SUPERVISOR',
  'CREDIT_ANALYST',
  'UNDERWRITER',
  'COMMITTEE',
  'EXECUTIVE',
  'COLLECTIONS_AGENT',
  'RISK_ANALYST',
  'PRODUCT_MANAGER',
  'FINANCE',
  'MARKETING',
  'AUDITOR',
  'SUPPORT',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  OPS_SUPERVISOR: 'Supervisor de operación',
  CREDIT_ANALYST: 'Analista de crédito',
  UNDERWRITER: 'Underwriter',
  COMMITTEE: 'Comité',
  EXECUTIVE: 'Ejecutivo de cartera',
  COLLECTIONS_AGENT: 'Gestor de cobranza',
  RISK_ANALYST: 'Analista de riesgo',
  PRODUCT_MANAGER: 'Product manager',
  FINANCE: 'Finanzas',
  MARKETING: 'Marketing',
  AUDITOR: 'Auditor',
  SUPPORT: 'Soporte',
};

export type EmployeeType = 'INTERNO' | 'COLABORADOR_EMPRESARIAL';

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  employeeType: EmployeeType;
  roles: Role[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  channel: 'BACKOFFICE';
  user: StaffUser;
}

/* ============================ Common ============================ */

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export type ProductType =
  | 'PERSONAL_LOAN' | 'PAYROLL_LOAN' | 'GROUP_LOAN' | 'MICRO_LOAN' | 'SME_LOAN'
  | 'CREDIT_CARD' | 'REVOLVING_LINE' | 'DISTRIBUTOR_LINE' | 'BUSINESS_REVOLVING_LINE';

export type ProductBehavior = 'INSTALLMENT' | 'REVOLVING';

/**
 * Lo que un usuario puede hacer, tal como lo publica `GET /permissions/me`.
 *
 * La consola se arma con esto, no con roles: los roles son el cómo, las
 * capacidades el qué. El backend es la autoridad — aquí sólo se nombran para
 * que TypeScript atrape un `capability` mal escrito.
 */
export type Capability =
  | 'applications.view'
  | 'applications.analyze'
  | 'applications.decide'
  | 'applications.request-documents'
  // Contabilidad se separa en dos porque leer el mayor y cerrar un período son actos distintos:
  // AUDITOR necesita lo primero y no debe poder lo segundo. Con una sola capacidad, auditar
  // implicaría poder mover el corte contable.
  | 'accounting.view'
  | 'accounting.close'
  | 'audit.view'
  // Colocaciones a beneficiarios (B2B2C). La publica el BFF desde que existe
  // `BeneficiariesController`; sin declararla aquí, TypeScript rechazaba gatear la pantalla con
  // ella y la entrada del menú se quedaba sin permiso que comprobar.
  | 'beneficiaries.view'
  // Dictaminar la identidad de una beneficiaria. Va aparte de `.view` porque vigilar la bandeja y
  // firmar que la persona es quien dice ser son actos distintos: el segundo habilita un depósito.
  | 'beneficiaries.review-identity'
  // La mesa de cumplimiento: KYC y listas por persona, para cualquier producto. Mirar, dictaminar
  // la identidad y resolver una coincidencia en listas son tres firmas distintas — confirmar una
  // homonimia bloquea a alguien, y eso no debe venir incluido con poder leer la cola.
  | 'compliance.view'
  | 'compliance.review-identity'
  | 'compliance.adjudicate'
  // Bancos y tesorería: por dónde sale el dinero y cada SPEI con su rastro. Va aparte de
  // `accounting.view` porque operación necesita contestar «¿ya le llegó?» sin leer el mayor, y
  // quien lee el mayor necesita ver la cuenta ordenante sin poder mover nada en ella.
  | 'treasury.view'
  // Registrar el fondeo: aportaciones de capital, líneas de fondeo, sus disposiciones, intereses y pagos. Tesorería y
  // el administrador; quien sólo mira tesorería lo lee con `treasury.view`.
  | 'treasury.funding'
  | 'clients.view'
  | 'clients.assign-executive'
  | 'dashboard.view'
  | 'dashboard.commercial'
  | 'permissions.view'
  | 'permissions.manage'
  | 'portfolio.view'
  | 'products.manage'
  | 'salesorg.view'
  | 'salesorg.manage'
  // Gestión de cobranza: entre otras cosas, marcar a un cliente de distribuidora en lista roja o levantar la marca.
  | 'collections.manage';

/* ============================ Dashboard ============================ */

export interface DashboardSummary {
  capitalColocado: number;        // Σ principalBalance de cuentas activas
  totalDebt: number;
  carteraSana: number;            // Σ principal en STAGE_1 (≤30 días)
  /**
   * Cartera vencida **oficial** CNBV/IFRS-9: sólo STAGE_3 (90+ días).
   *
   * Antes era STAGE_2 + STAGE_3, y ése era el origen de que el panorama y la vista de red
   * dieran dos moras distintas de la misma cartera. El tramo 31-90 es atraso —deterioro
   * significativo, SICR— y todavía no cartera vencida; va en `carteraAtrasoTemprano`.
   */
  carteraVencida: number;
  /** STAGE_2: 31-90 días. Atraso temprano, no cartera vencida. */
  carteraAtrasoTemprano?: number;
  provisionTotal: number;         // Σ provisionAmount (IFRS-9)
  ead: number;
  activeAccounts: number;
  activeClients: number;
  activeBusinesses: number;
  /** IMOR: cartera vencida oficial / capital colocado, 0-100. */
  delinquencyRate: number;
  /** Parcialidades con vencimiento en el periodo que entra. */
  aCobrarProximoPeriodo?: number;
  /** Lo esperado del periodo actual y lo que ya entró de eso. */
  aCobrarPeriodoActual?: number;
  cobradoPeriodoActual?: number;
  /** Cobrado sobre esperado del periodo actual, 0-100. */
  porcentajePagoPeriodo?: number;
  disbursedThisMonth: number;
  byProduct: ProductMix[];
  health: HealthBreakdown;
  /**
   * El reparto por ejecutivo **ya no vive aquí**: es alcance, y lo resuelve
   * `/dashboard/commercial` sobre el subárbol de sales-org. El BFF lo retiró
   * del resumen por eso. Se deja opcional para no romper a quien todavía lo
   * lea, pero la consola debe pedirlo donde corresponde.
   */
  byExecutive?: ExecutivePortfolio[];
  /** Sale vacío hasta que exista el endpoint del embudo (spike S-4). */
  pipeline?: PipelineStage[];     // solicitudes por estatus
}

export interface ProductMix {
  productType: ProductType;
  behavior: ProductBehavior;
  accounts: number;
  capital: number;
  vencida: number;
}

export interface HealthBreakdown {
  stage1: number; // sana (performing)
  stage2: number; // SICR
  stage3: number; // impaired / vencida
}

export interface ExecutivePortfolio {
  executiveId: string;
  executiveName: string;
  clients: number;
  accounts: number;
  capital: number;
  sana: number;
  vencida: number;
  provision: number;
}

export interface PipelineStage {
  status: string;
  count: number;
}

/* ============================ Portfolio / cuentas ============================ */

export type AccountStatus =
  | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'RESTRUCTURED'
  | 'SETTLED' | 'WRITTEN_OFF' | 'CLOSED';

export type Ifrs9Stage = 'STAGE_1' | 'STAGE_2' | 'STAGE_3';

export interface CreditAccount {
  creditAccountId: string;
  contractNumber: string;
  obligorPartyId: string;
  obligorName?: string;
  productCode: string;
  productType: ProductType;
  productBehavior: ProductBehavior;
  status: AccountStatus;
  nominalRate: number;
  assignedTerm: number | null;
  principalBalance: number;
  accruedInterestBalance: number;
  penaltyBalance: number;
  /**
   * IVA trasladado pendiente de cobro.
   *
   * Aparte de `penaltyBalance` porque no es mora del cliente ni ingreso de la institución: es
   * dinero del SAT que se cobra y se retiene. Mezclado con la penalización, un crédito al corriente
   * mostraba «Penalización $4,200» que en realidad eran impuestos.
   */
  ivaBalance: number;
  creditLimit: number | null;
  availableCredit: number | null;
  totalDebt: number;
  daysDelinquent: number;
  riskTier: string | null;
  ifrs9Stage?: Ifrs9Stage;
  clabeAccount: string | null;
  activatedAt: string | null;
  assignedExecutiveId?: string | null;
  assignedExecutiveName?: string | null;

  // Avance del plan de pagos — lo que convierte una fila en un seguimiento.
  // Los deriva credit-portfolio del calendario; el BFF los pasa tal cual.
  paidInstallments?: number | null;
  totalInstallments?: number | null;
  nextInstallmentNumber?: number | null;
  paymentDueDate?: string | null;
  minimumPayment?: number | null;
  principalPaid?: number | null;
  overdueAmount?: number | null;
  overdueInstallments?: number | null;
}

export interface Installment {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  /** IVA sobre el interés de esta cuota. Cero cuando el interés va exento. */
  taxAmount: number;
  totalAmount: number;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'PARTIAL';
}

export interface Disposition {
  dispositionId: string;
  amount: number;
  type: 'SELF_USE' | 'THIRD_PARTY_CREDIT' | 'PAYROLL';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  createdAt: string;
}

/**
 * Un pago tal como lo registró payments-service.
 *
 * No es lo mismo que una mensualidad marcada PAID: el calendario dice qué periodos figuran
 * cubiertos, esto dice con qué dinero. Un pago CONFIRMED que aún no movió el calendario es
 * justo el caso que se investiga desde la consola, y sin esta lista sería invisible.
 */
export type PaymentStatus =
  | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'PRE_REJECTED' | 'REVERSED' | 'FAILED';

export interface PaymentOrder {
  paymentOrderId: string;
  amount: number;
  paymentMethod: string;
  status: PaymentStatus | string;
  externalRef: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  appliedAt: string | null;
}

export interface AccountDetail extends CreditAccount {
  schedule: Installment[];
  dispositions: Disposition[];
  payments?: PaymentOrder[];
  expectedLossRate?: number;
  provisionAmount?: number;
}

export function paymentStatusTone(s: string): StatusTone {
  switch (s) {
    case 'CONFIRMED': return 'ok';
    case 'PENDING': return 'info';
    case 'REVERSED': return 'warn';
    case 'REJECTED': case 'PRE_REJECTED': case 'FAILED': return 'bad';
    default: return 'muted';
  }
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En proceso',
  CONFIRMED: 'Aplicado',
  REJECTED: 'Rechazado',
  PRE_REJECTED: 'Pre-rechazado',
  REVERSED: 'Reversado',
  FAILED: 'Fallido',
};

export function paymentStatusLabel(s: string): string {
  return PAYMENT_STATUS_LABELS[s] ?? s;
}

/* ============================ Clientes / partes ============================ */

export type PartyType = 'INDIVIDUAL' | 'BUSINESS';
export type PartyStatus = 'PROSPECT' | 'ACTIVE' | 'SUSPENDED' | 'BLACKLISTED' | 'CLOSED';

export interface Client {
  partyId: string;
  partyType: PartyType;
  status: PartyStatus;
  fullName: string;
  curp: string | null;
  rfc: string | null;
  riskLevel: string | null;
  totalScore: number | null;
  assignedExecutiveId: string | null;
  assignedExecutiveName: string | null;
  createdAt: string;
}

export type ApplicationStatus =
  | 'DRAFT' | 'PENDING_SCORING' | 'SCORING' | 'UNDER_MANUAL_REVIEW' | 'COMMITTEE_REVIEW'
  | 'PENDING_DOCUMENTS' | 'APPROVED' | 'OFFER_PRESENTED' | 'OFFER_ACCEPTED'
  | 'OFFER_EXPIRED' | 'OFFER_REJECTED' | 'PENDING_SIGNATURE' | 'CONTRACT_SIGNED'
  | 'DISBURSED' | 'REJECTED' | 'FAILED' | 'CANCELLED';

export interface CreditApplication {
  applicationId: string;
  prospectId: string;
  productType: ProductType;
  requestedAmount: number;
  requestedTerm: number | null;
  status: ApplicationStatus;
  approvalFlow: 'AUTOMATIC' | 'MANUAL' | 'COMMITTEE' | null;
  riskLevel: string | null;
  decidedBy: string | null;
  rejectionReason: string | null;
  offeredAmount: number | null;
  offeredLine: number | null;
  offeredTerm: number | null;
  nominalRate: number | null;
  cat: number | null;
  createdAt: string;
}

export interface ClientDetail extends Client {
  accounts: CreditAccount[];
  applications: CreditApplication[];
}

/* ============================ Estados de cuenta ============================ */

export type StatementStatus = 'PENDING' | 'GENERATING' | 'GENERATED' | 'FAILED';

/**
 * A statement that statement-service generated at a cutoff. The PDF is not here: it is requested
 * apart, from the file of its holder, and only when `downloadable` (generated).
 */
export interface AccountStatement {
  statementId: string;
  creditAccountId: string;
  contractNumber: string | null;
  productType: ProductType;
  cycleNumber: number;
  periodStart: string | null;
  cutoffDate: string;
  paymentDueDate: string | null;
  balanceAtCutoff: number;
  amountDue: number | null;
  minimumPayment: number | null;
  status: StatementStatus;
  documentBytes: number | null;
  generatedAt: string | null;
  downloadable: boolean;
}

/** The statements of a client or a distributor: those of every account of the party. */
export interface PartyStatements {
  accounts: Array<{ creditAccountId: string; contractNumber: string; productType: ProductType; status: AccountStatus }>;
  statements: AccountStatement[];
}

/* ============================ Recibos de pago y lista roja ============================ */

/**
 * NUEVO hasta que tiene un préstamo con alguna distribuidora totalmente pagado (quebranto y quita no cuentan);
 * desde entonces REVOLVENTE. Decide qué límites de su sucursal le aplican.
 */
export type ClientType = 'NUEVO' | 'REVOLVENTE';

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  NUEVO: 'Cliente nuevo',
  REVOLVENTE: 'Cliente revolvente',
};

/** El recibo de pago de un cliente de distribuidora por estado de cuenta: lo que paga sin el descuento de ella. */
export interface PaymentReceipt {
  receiptId: string;
  creditAccountId: string;
  cycleNumber: number;
  beneficiaryPartyId: string;
  distributorPartyId: string | null;
  periodStart: string | null;
  cutoffDate: string;
  paymentDueDate: string | null;
  status: StatementStatus;
  folio: string | null;
  clientName: string | null;
  clientType: ClientType | null;
  liveLoans: number | null;
  totalDue: number | null;
  paymentReference: number | null;
  clabe: string | null;
  documentBytes: number | null;
  generatedAt: string | null;
}

/** Los recibos de un expediente: los de sus clientes si es distribuidora, los suyos si es cliente. */
export interface PartyReceipts {
  asDistributor: boolean;
  receipts: PaymentReceipt[];
}

export type RedListReason = 'VOUCHER_IN_ARREARS' | 'DISTRIBUTOR_IN_ARREARS' | 'DISTRIBUTOR_REPORT';
export type RedListSource = 'SYSTEM' | 'DISTRIBUTOR' | 'BACKOFFICE';
/** El catálogo del reporte: lo que la distribuidora (o el backoffice) dice del cliente; los comentarios dicen el resto. */
export type ReportReason = 'VOUCHER_UNPAID' | 'REFUSES_TO_PAY' | 'NOT_LOCATABLE' | 'MISCONDUCT' | 'SUSPECTED_FRAUD' | 'OTHER';

export const RED_LIST_REASON_LABELS: Record<RedListReason, string> = {
  VOUCHER_IN_ARREARS: 'Vale en mora',
  DISTRIBUTOR_IN_ARREARS: 'Su distribuidora está en mora',
  DISTRIBUTOR_REPORT: 'Reporte',
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  VOUCHER_UNPAID: 'No ha pagado su vale',
  REFUSES_TO_PAY: 'Se niega a pagar',
  NOT_LOCATABLE: 'No se le localiza',
  MISCONDUCT: 'Mala conducta',
  SUSPECTED_FRAUD: 'Sospecha de fraude',
  OTHER: 'Otro motivo',
};

/** Una marca vigente: derivada de su mora o de la de su distribuidora (sin id), o un reporte (con id). */
export interface RedListMark {
  flagId: string | null;
  reason: RedListReason;
  source: RedListSource;
  since: string | null;
  distributorPartyId: string | null;
  creditAccountId: string | null;
  detail: string | null;
  comment: string | null;
}

/** Un reporte con su historia: quién lo puso, quién lo levantó y por qué. Nunca se borra. */
export interface RedListRecord {
  flagId: string;
  reason: RedListReason;
  source: RedListSource;
  distributorPartyId: string | null;
  detail: string | null;
  comment: string | null;
  raisedAt: string;
  raisedBy: string | null;
  clearedAt: string | null;
  clearedBy: string | null;
  clearComment: string | null;
  active: boolean;
}

export interface ClientCreditProfile {
  beneficiaryPartyId: string;
  type: ClientType;
  redListed: boolean;
  flags: RedListMark[];
  loansGranted: number;
  loansPaid: number;
  activeLoans: number;
  outstanding: number;
  history: RedListRecord[];
}

/** Lo que una distribuidora puede colocarle a un tipo de cliente; un límite nulo se hereda. */
export interface ClientLimits {
  maxLoanAmount: number | null;
  maxOutstanding: number | null;
  maxActiveLoans: number | null;
  maxTerm: number | null;
}

export interface PlacementLimitsByType {
  nuevo: ClientLimits | null;
  revolvente: ClientLimits | null;
}

/** La política de colocación de una unidad (sólo línea de distribuidora): lo que declara y lo que le aplica. */
export interface PlacementPolicy {
  unitId: string;
  code: string;
  levelCode: string | null;
  productType: 'DISTRIBUTOR_LINE';
  configured: boolean;
  /** La unidad más profunda que declaró algo en el camino; nulo si nada aplica. */
  inheritedFrom: string | null;
  declared: PlacementLimitsByType | null;
  effective: PlacementLimitsByType | null;
}

/* ============================ Distribuidores ============================ */

/**
 * Un distribuidor no es un tercer `partyType`: es una persona o un negocio **con un rol
 * adicional** (invariante I-03 del dominio de party). Por eso extiende `Client` en vez de
 * sustituirlo — el mismo registro puede ser cliente de su propio crédito y a la vez originar
 * créditos de terceros.
 *
 * La consulta se plantea desde el distribuidor hacia sus créditos, no al revés: quien pregunta
 * en la consola recuerda el nombre y el código del distribuidor, nunca el número de contrato.
 */
export interface Distributor extends Client {
  /** El código que se teclea al originar (`promoterCode`). Es lo que la gente sí recuerda. */
  promoterCode: string | null;
  /** Créditos colocados a terceros por este distribuidor. */
  originatedCredits: number;
  originatedAmount: number;
  /** Comisiones devengadas — se generan contra el pago, no contra la colocación. */
  commissionAccrued: number;
  commissionPaid: number;
  /** Línea propia del distribuidor (DISTRIBUTOR_LINE), si la tiene. */
  creditLineId: string | null;
  creditLineLimit: number | null;
  creditLineAvailable: number | null;
  active: boolean;
}

/** Un crédito originado por el distribuidor, visto desde su lado. */
export interface OriginatedCredit {
  creditAccountId: string;
  contractNumber: string;
  obligorPartyId: string;
  obligorName: string | null;
  productType: ProductType;
  status: AccountStatus;
  principalBalance: number;
  daysDelinquent: number;
  originatedAt: string | null;
  commissionAccrued: number;
}

export interface DistributorDetail extends Distributor {
  credits: OriginatedCredit[];
}

/* ============================ Productos / catálogo ============================ */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED' | 'DEPRECATED';
export type TargetAudience = 'B2C' | 'B2B' | 'B2B2C';
export type AmortizationType = 'FRENCH' | 'GERMAN' | 'BULLET';
export type ApprovalFlow = 'AUTOMATIC' | 'MANUAL' | 'COMMITTEE';

export interface ProductDefinition {
  id: string;
  productCode: string;
  productVersion: number;
  productType: ProductType;
  behavior: ProductBehavior;
  name: string;
  description: string;
  status: ProductStatus;
  targetAudience: TargetAudience;
  currency: string;
  nominalRateAnnual: number;
  moratoriumRateAnnual: number;
  minTerm: number | null;
  maxTerm: number | null;
  defaultTerm: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  defaultCreditLine: number | null;
  minCreditLine: number | null;
  maxCreditLine: number | null;
  amortizationType: AmortizationType;
  minApprovalScore: number;
  defaultApprovalFlow: ApprovalFlow;
  openingFeeRate: number;
  prepaymentFeeRate: number;
  activeInApp: boolean; // = status ACTIVE, lo que ve la app móvil
}

/* ============================ Labels & tones ============================ */

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  PERSONAL_LOAN: 'Préstamo personal',
  PAYROLL_LOAN: 'Crédito de nómina',
  GROUP_LOAN: 'Crédito grupal',
  MICRO_LOAN: 'Microcrédito',
  SME_LOAN: 'Crédito PyME',
  CREDIT_CARD: 'Tarjeta de crédito',
  REVOLVING_LINE: 'Línea revolvente',
  DISTRIBUTOR_LINE: 'Línea distribuidor',
  BUSINESS_REVOLVING_LINE: 'Línea revolvente PyME',
};

export function behaviorLabel(b: ProductBehavior): string {
  return b === 'REVOLVING' ? 'Revolvente' : 'Simple (amortizable)';
}

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING_ACTIVATION: 'Por activar',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  RESTRUCTURED: 'Reestructurado',
  SETTLED: 'Liquidado',
  WRITTEN_OFF: 'Castigado',
  CLOSED: 'Cerrado',
};

export function accountStatusTone(s: AccountStatus): StatusTone {
  switch (s) {
    case 'ACTIVE': return 'ok';
    case 'PENDING_ACTIVATION': return 'info';
    case 'SETTLED': return 'muted';
    case 'SUSPENDED': case 'RESTRUCTURED': return 'warn';
    case 'WRITTEN_OFF': return 'bad';
    default: return 'muted';
  }
}

export const STAGE_LABELS: Record<Ifrs9Stage, string> = {
  STAGE_1: 'Sana',
  STAGE_2: 'SICR',
  STAGE_3: 'Vencida',
};

export function stageTone(s: Ifrs9Stage): StatusTone {
  return s === 'STAGE_1' ? 'ok' : s === 'STAGE_2' ? 'warn' : 'bad';
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  RETIRED: 'Retirado',
  DEPRECATED: 'Obsoleto',
};

export function productStatusTone(s: ProductStatus): StatusTone {
  switch (s) {
    case 'ACTIVE': return 'ok';
    case 'DRAFT': return 'info';
    case 'INACTIVE': case 'DEPRECATED': return 'warn';
    case 'RETIRED': return 'muted';
    default: return 'muted';
  }
}

export const APPLICATION_STATUS_LABELS: Partial<Record<ApplicationStatus, string>> = {
  COMMITTEE_REVIEW: 'En comité',
  UNDER_MANUAL_REVIEW: 'Revisión manual',
  OFFER_PRESENTED: 'Oferta presentada',
  APPROVED: 'Aprobada',
  CONTRACT_SIGNED: 'Contrato firmado',
  DISBURSED: 'Desembolsada',
  REJECTED: 'Rechazada',
  PENDING_SIGNATURE: 'Por firmar',
};

export function applicationStatusLabel(s: ApplicationStatus): string {
  return APPLICATION_STATUS_LABELS[s] ?? s.replace(/_/g, ' ').toLowerCase();
}

export function applicationStatusTone(s: ApplicationStatus): StatusTone {
  if (s === 'DISBURSED' || s === 'CONTRACT_SIGNED' || s === 'APPROVED') return 'ok';
  if (s === 'REJECTED' || s === 'FAILED' || s === 'CANCELLED' || s === 'OFFER_REJECTED') return 'bad';
  if (s === 'COMMITTEE_REVIEW' || s === 'UNDER_MANUAL_REVIEW' || s === 'PENDING_SIGNATURE') return 'warn';
  return 'info';
}

export interface CreateProductVersionRequest {
  productCode: string;
  productType: ProductType;
  behavior: ProductBehavior;
  name: string;
  description: string;
  targetAudience: TargetAudience;
  nominalRateAnnual: number;
  moratoriumRateAnnual: number;
  minTerm: number | null;
  maxTerm: number | null;
  defaultTerm: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  defaultCreditLine: number | null;
  minCreditLine: number | null;
  maxCreditLine: number | null;
  amortizationType: AmortizationType;
  minApprovalScore: number;
  defaultApprovalFlow: ApprovalFlow;
  openingFeeRate: number;
  prepaymentFeeRate: number;
}
