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
  | 'clients.view'
  | 'clients.assign-executive'
  | 'dashboard.view'
  | 'dashboard.commercial'
  | 'permissions.view'
  | 'permissions.manage'
  | 'portfolio.view'
  | 'products.manage'
  | 'salesorg.view'
  | 'salesorg.manage';

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
