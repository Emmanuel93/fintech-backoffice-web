import type {
  Client, CreditAccount, CreditApplication, ProductDefinition,
  Ifrs9Stage, AccountStatus, ProductType, ProductBehavior,
  Distributor, OriginatedCredit,
} from '@bo/shared-types';

export interface Executive { id: string; name: string }

export const EXECUTIVES: Executive[] = [
  { id: 'EXE-1', name: 'Ana Torres' },
  { id: 'EXE-2', name: 'Luis Marín' },
  { id: 'EXE-3', name: 'María Fuentes' },
  { id: 'EXE-4', name: 'Diego Salas' },
];

export function stageOf(daysDelinquent: number, status: AccountStatus): Ifrs9Stage {
  if (status === 'WRITTEN_OFF') return 'STAGE_3';
  if (daysDelinquent >= 90) return 'STAGE_3';
  if (daysDelinquent >= 1) return 'STAGE_2';
  return 'STAGE_1';
}

export function provisionRate(stage: Ifrs9Stage): number {
  return stage === 'STAGE_3' ? 0.55 : stage === 'STAGE_2' ? 0.15 : 0.01;
}

export const PRODUCTS: ProductDefinition[] = [
  mkProduct('PL-IND-STD', 'PERSONAL_LOAN', 'INSTALLMENT', 'Préstamo Personal', 'ACTIVE', 'B2C', 0.36, { minTerm: 6, maxTerm: 36, defaultTerm: 24, minAmount: 5000, maxAmount: 150000 }),
  mkProduct('RL-IND-STD', 'REVOLVING_LINE', 'REVOLVING', 'Línea Revolvente', 'ACTIVE', 'B2C', 0.45, { minCreditLine: 5000, maxCreditLine: 50000, defaultCreditLine: 20000 }),
  mkProduct('PY-IND-STD', 'PAYROLL_LOAN', 'INSTALLMENT', 'Crédito de Nómina', 'ACTIVE', 'B2C', 0.28, { minTerm: 6, maxTerm: 48, defaultTerm: 24, minAmount: 3000, maxAmount: 200000 }),
  mkProduct('SME-LOAN-STD', 'SME_LOAN', 'INSTALLMENT', 'Crédito PyME', 'ACTIVE', 'B2B', 0.32, { minTerm: 12, maxTerm: 60, defaultTerm: 36, minAmount: 50000, maxAmount: 2000000 }),
  mkProduct('DL-DIST-STD', 'DISTRIBUTOR_LINE', 'REVOLVING', 'Línea Distribuidor', 'ACTIVE', 'B2B2C', 0.30, { minCreditLine: 100000, maxCreditLine: 1000000, defaultCreditLine: 300000 }),
  mkProduct('MICRO-LOAN-STD', 'MICRO_LOAN', 'INSTALLMENT', 'Microcrédito', 'DRAFT', 'B2C', 0.60, { minTerm: 3, maxTerm: 12, defaultTerm: 6, minAmount: 1000, maxAmount: 15000 }),
];

interface ClientSeed { name: string; type: 'INDIVIDUAL' | 'BUSINESS'; exe: number; score: number; risk: string }
const CLIENT_SEEDS: ClientSeed[] = [
  { name: 'Teresa Méndez Robles', type: 'INDIVIDUAL', exe: 0, score: 742, risk: 'BAJO' },
  { name: 'Roberto Gil Sandoval', type: 'INDIVIDUAL', exe: 0, score: 688, risk: 'MEDIO' },
  { name: 'Comercial La Huasteca SA', type: 'BUSINESS', exe: 0, score: 705, risk: 'MEDIO' },
  { name: 'Lucía Ramírez Paz', type: 'INDIVIDUAL', exe: 1, score: 771, risk: 'BAJO' },
  { name: 'Ferretería El Tornillo SA', type: 'BUSINESS', exe: 1, score: 640, risk: 'MEDIO' },
  { name: 'Jorge Nava Cruz', type: 'INDIVIDUAL', exe: 1, score: 512, risk: 'ALTO' },
  { name: 'Distribuidora Norte SA', type: 'BUSINESS', exe: 1, score: 690, risk: 'MEDIO' },
  { name: 'Patricia Osorio Vega', type: 'INDIVIDUAL', exe: 2, score: 799, risk: 'BAJO' },
  { name: 'Miguel Ángel Ruiz', type: 'INDIVIDUAL', exe: 2, score: 655, risk: 'MEDIO' },
  { name: 'Textiles del Bajío SA', type: 'BUSINESS', exe: 2, score: 612, risk: 'ALTO' },
  { name: 'Sofía Herrera León', type: 'INDIVIDUAL', exe: 2, score: 720, risk: 'BAJO' },
  { name: 'Carlos Peña Miranda', type: 'INDIVIDUAL', exe: 3, score: 470, risk: 'ALTO' },
  { name: 'AgroInsumos del Valle SA', type: 'BUSINESS', exe: 3, score: 733, risk: 'BAJO' },
  { name: 'Verónica Salas Ortiz', type: 'INDIVIDUAL', exe: 3, score: 701, risk: 'MEDIO' },
];

export const CLIENTS: Client[] = CLIENT_SEEDS.map((s, i) => {
  const exe = EXECUTIVES[s.exe];
  return {
    partyId: `PTY-${String(i + 1).padStart(3, '0')}`,
    partyType: s.type,
    status: 'ACTIVE',
    fullName: s.name,
    curp: s.type === 'INDIVIDUAL' ? `CURP${1000 + i}MDF` : null,
    rfc: s.type === 'BUSINESS' ? `RFC${700000 + i}XX1` : `RFC${800000 + i}MX2`,
    riskLevel: s.risk,
    totalScore: s.score,
    assignedExecutiveId: exe.id,
    assignedExecutiveName: exe.name,
    createdAt: `2026-0${(i % 6) + 1}-1${i % 9}T10:00:00Z`,
  };
});

interface AcctSeed { client: number; product: number; principal: number; dpd: number; status: AccountStatus }
const ACCT_SEEDS: AcctSeed[] = [
  { client: 0, product: 0, principal: 84000, dpd: 0, status: 'ACTIVE' },
  { client: 0, product: 1, principal: 12500, dpd: 0, status: 'ACTIVE' },
  { client: 1, product: 0, principal: 41000, dpd: 18, status: 'ACTIVE' },
  { client: 2, product: 3, principal: 640000, dpd: 0, status: 'ACTIVE' },
  { client: 3, product: 2, principal: 96000, dpd: 0, status: 'ACTIVE' },
  { client: 3, product: 1, principal: 8000, dpd: 0, status: 'ACTIVE' },
  { client: 4, product: 3, principal: 380000, dpd: 47, status: 'ACTIVE' },
  { client: 5, product: 0, principal: 22000, dpd: 118, status: 'ACTIVE' },
  { client: 6, product: 4, principal: 520000, dpd: 0, status: 'ACTIVE' },
  { client: 7, product: 0, principal: 130000, dpd: 0, status: 'ACTIVE' },
  { client: 8, product: 2, principal: 54000, dpd: 8, status: 'ACTIVE' },
  { client: 9, product: 3, principal: 210000, dpd: 96, status: 'ACTIVE' },
  { client: 10, product: 1, principal: 19500, dpd: 0, status: 'ACTIVE' },
  { client: 11, product: 0, principal: 15000, dpd: 152, status: 'WRITTEN_OFF' },
  { client: 12, product: 3, principal: 890000, dpd: 0, status: 'ACTIVE' },
  { client: 13, product: 0, principal: 60000, dpd: 0, status: 'PENDING_ACTIVATION' },
  { client: 13, product: 1, principal: 0, dpd: 0, status: 'SETTLED' },
  { client: 7, product: 4, principal: 340000, dpd: 23, status: 'ACTIVE' },
];

export const ACCOUNTS: CreditAccount[] = ACCT_SEEDS.map((s, i) => {
  const client = CLIENTS[s.client];
  const product = PRODUCTS[s.product];
  const revolving = product.behavior === 'REVOLVING';
  const stage = stageOf(s.dpd, s.status);
  const accrued = Math.round(s.principal * 0.03);
  const penalty = s.dpd > 0 ? Math.round(s.principal * 0.01 * Math.min(s.dpd / 30, 4)) : 0;
  return {
    creditAccountId: `ACC-${String(i + 1).padStart(3, '0')}`,
    contractNumber: `KRD-2026-${String(4200 + i)}`,
    obligorPartyId: client.partyId,
    obligorName: client.fullName,
    productCode: `${product.productCode}-V1`,
    productType: product.productType,
    productBehavior: product.behavior,
    status: s.status,
    nominalRate: product.nominalRateAnnual,
    assignedTerm: revolving ? null : (product.defaultTerm ?? 24),
    principalBalance: s.principal,
    accruedInterestBalance: s.status === 'SETTLED' ? 0 : accrued,
    penaltyBalance: penalty,
    // El IVA se traslada sobre el interés devengado. Una cuenta liquidada no debe nada.
    ivaBalance: s.status === 'SETTLED' ? 0 : Math.round(accrued * 0.16),
    creditLimit: revolving ? (product.defaultCreditLine ?? 20000) : null,
    availableCredit: revolving ? Math.max((product.defaultCreditLine ?? 20000) - s.principal, 0) : null,
    // La deuda incluye el IVA por cobrar: se le cobra al cliente aunque no sea ingreso propio.
    totalDebt: s.principal + (s.status === 'SETTLED' ? 0 : accrued + Math.round(accrued * 0.16)) + penalty,
    daysDelinquent: s.dpd,
    riskTier: client.riskLevel,
    ifrs9Stage: stage,
    clabeAccount: `6461800000000${String(1000 + i)}`,
    activatedAt: s.status === 'PENDING_ACTIVATION' ? null : `2026-0${(i % 6) + 1}-15T12:00:00Z`,
    assignedExecutiveId: client.assignedExecutiveId,
    assignedExecutiveName: client.assignedExecutiveName,
  };
});

export const APPLICATIONS: CreditApplication[] = [
  mkApp('APP-001', 0, 'PERSONAL_LOAN', 85000, 24, 'DISBURSED', 'AUTOMATIC', 'BAJO'),
  mkApp('APP-002', 4, 'SME_LOAN', 450000, 36, 'COMMITTEE_REVIEW', 'COMMITTEE', 'MEDIO'),
  mkApp('APP-003', 6, 'DISTRIBUTOR_LINE', 600000, null, 'COMMITTEE_REVIEW', 'COMMITTEE', 'MEDIO'),
  mkApp('APP-004', 9, 'SME_LOAN', 250000, 24, 'UNDER_MANUAL_REVIEW', 'MANUAL', 'ALTO'),
  mkApp('APP-005', 3, 'PAYROLL_LOAN', 100000, 24, 'OFFER_PRESENTED', 'AUTOMATIC', 'BAJO'),
  mkApp('APP-006', 11, 'PERSONAL_LOAN', 30000, 18, 'REJECTED', 'AUTOMATIC', 'ALTO'),
  mkApp('APP-007', 12, 'SME_LOAN', 900000, 48, 'CONTRACT_SIGNED', 'COMMITTEE', 'BAJO'),
];

/* ---------------- distribuidores ---------------- */

// Un distribuidor es una party existente con un rol adicional (invariante I-03), no un tipo
// aparte: por eso se referencian por índice sobre CLIENTS en vez de duplicar el registro.
// `promoterCode` es el identificador que se teclea al originar y por el que se busca.
interface DistSeed { client: number; code: string; credits: number[]; line: number | null }
const DIST_SEEDS: DistSeed[] = [
  { client: 6,  code: 'DIST-0042', credits: [0, 1, 7, 10], line: 4 },
  { client: 12, code: 'DIST-0117', credits: [4, 5, 12],    line: 4 },
  { client: 2,  code: 'DIST-0203', credits: [9],           line: null },
];

export const DISTRIBUTORS: Distributor[] = DIST_SEEDS.map((s) => {
  const party = CLIENTS[s.client];
  const credits = s.credits.map((i) => ACCOUNTS[i]).filter(Boolean);
  const originatedAmount = credits.reduce((sum, a) => sum + a.principalBalance, 0);
  // La comisión se devenga contra el pago, no contra la colocación: se estima sobre lo cobrado.
  const accrued = Math.round(originatedAmount * 0.035);
  const line = s.line == null ? null : PRODUCTS[s.line];
  return {
    ...party,
    promoterCode: s.code,
    originatedCredits: credits.length,
    originatedAmount,
    commissionAccrued: accrued,
    commissionPaid: Math.round(accrued * 0.6),
    creditLineId: line ? `ACC-DL-${s.code}` : null,
    creditLineLimit: line?.defaultCreditLine ?? null,
    creditLineAvailable: line ? Math.round((line.defaultCreditLine ?? 0) * 0.42) : null,
    active: true,
  };
});

export function originatedCreditsOf(promoterCode: string): OriginatedCredit[] {
  const seed = DIST_SEEDS.find((d) => d.code === promoterCode);
  if (!seed) return [];
  return seed.credits.map((i) => ACCOUNTS[i]).filter(Boolean).map((a) => ({
    creditAccountId: a.creditAccountId,
    contractNumber: a.contractNumber,
    obligorPartyId: a.obligorPartyId,
    obligorName: a.obligorName ?? null,
    productType: a.productType,
    status: a.status,
    principalBalance: a.principalBalance,
    daysDelinquent: a.daysDelinquent,
    originatedAt: a.activatedAt,
    commissionAccrued: Math.round(a.principalBalance * 0.035),
  }));
}

/* ---------------- builders ---------------- */

function mkProduct(
  code: string, type: ProductType, behavior: ProductBehavior, name: string,
  status: ProductDefinition['status'], audience: ProductDefinition['targetAudience'],
  rate: number,
  bounds: Partial<Pick<ProductDefinition, 'minTerm' | 'maxTerm' | 'defaultTerm' | 'minAmount' | 'maxAmount' | 'minCreditLine' | 'maxCreditLine' | 'defaultCreditLine'>>,
): ProductDefinition {
  return {
    id: `PRD-${code}`,
    productCode: code,
    productVersion: 1,
    productType: type,
    behavior,
    name,
    description: `${name} — producto ${audience}`,
    status,
    targetAudience: audience,
    currency: 'MXN',
    nominalRateAnnual: rate,
    moratoriumRateAnnual: rate + 0.12,
    minTerm: bounds.minTerm ?? null,
    maxTerm: bounds.maxTerm ?? null,
    defaultTerm: bounds.defaultTerm ?? null,
    minAmount: bounds.minAmount ?? null,
    maxAmount: bounds.maxAmount ?? null,
    defaultCreditLine: bounds.defaultCreditLine ?? null,
    minCreditLine: bounds.minCreditLine ?? null,
    maxCreditLine: bounds.maxCreditLine ?? null,
    amortizationType: behavior === 'REVOLVING' ? 'BULLET' : 'FRENCH',
    minApprovalScore: 200,
    defaultApprovalFlow: audience === 'B2C' ? 'AUTOMATIC' : 'COMMITTEE',
    openingFeeRate: 0.02,
    prepaymentFeeRate: 0.0,
    activeInApp: status === 'ACTIVE',
  };
}

function mkApp(
  id: string, clientIdx: number, product: ProductType, amount: number, term: number | null,
  status: CreditApplication['status'], flow: CreditApplication['approvalFlow'], risk: string,
): CreditApplication {
  const presented = status === 'OFFER_PRESENTED' || status === 'DISBURSED' || status === 'CONTRACT_SIGNED';
  return {
    applicationId: id,
    prospectId: CLIENTS[clientIdx]?.partyId ?? 'PTY-000',
    productType: product,
    requestedAmount: amount,
    requestedTerm: term,
    status,
    approvalFlow: flow,
    riskLevel: risk,
    decidedBy: status === 'DISBURSED' || status === 'CONTRACT_SIGNED' ? 'EXE-1' : null,
    rejectionReason: status === 'REJECTED' ? 'Score insuficiente (bureau)' : null,
    offeredAmount: presented ? amount : null,
    offeredLine: null,
    offeredTerm: presented ? term : null,
    nominalRate: presented ? 0.36 : null,
    cat: presented ? 0.52 : null,
    createdAt: `2026-07-${String(10 + (clientIdx % 18)).padStart(2, '0')}T09:00:00Z`,
  };
}
