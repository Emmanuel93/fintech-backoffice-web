import { isMock } from './config.js';
import { request } from './http.js';

/**
 * Contabilidad: pólizas, balanza y facturas, con la sucursal y el préstamo como ejes.
 *
 * <p>Tres cosas condicionan cómo se lee todo lo demás.
 *
 * <p>**La póliza es la unidad, no el asiento.** Un hecho económico produce una póliza con folio
 * consecutivo por tipo, sucursal y período, y dentro de ella N renglones que suman cargo = abono.
 * Un pago que liquida capital e intereses son tres renglones en una póliza, no tres asientos
 * sueltos: separarlos hace imposible responder «qué movió este pago».
 *
 * <p>**La sucursal de un préstamo se sella al activarlo y no cambia.** Reasignar la cartera mueve
 * al cliente de ejecutivo, no mueve la contabilidad de los meses anteriores. Si cambiara, la
 * balanza de marzo daría un número distinto en agosto y los estados financieros dejarían de ser
 * reproducibles.
 *
 * <p>**Lo que no tiene sucursal se cuenta aparte, no se reparte.** Los asientos anteriores al
 * sellado quedan bajo «Sin sucursal», visibles y sumados. Repartirlos proporcionalmente haría
 * cuadrar la pantalla mintiendo.
 *
 * <p>El modo mock conserva un dataset coherente para desarrollar sin backend: la balanza y el
 * resumen se **derivan** de las mismas pólizas, así que lo que cuadra ahí cuadra por construcción.
 * En vivo todo esto lo contesta el BFF (`/accounting/**`, `/invoices/**`).
 */

/* ============================ Catálogo ============================ */

/**
 * La naturaleza de la cuenta, que decide cómo se presenta su saldo.
 *
 * `CONTRA_ASSET` existe porque la estimación preventiva (1290) es un activo de naturaleza
 * acreedora: con `saldo = cargos − abonos` sale en negativo, que es aritméticamente correcto y
 * contablemente ilegible. `ORDER` son las cuentas de orden —líneas autorizadas— que cuadran entre
 * sí y **no forman parte del balance**: sumarlas a la balanza patrimonial infla el activo con
 * dinero que nunca salió.
 */
export type AccountNature =
  | 'ASSET' | 'CONTRA_ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'EQUITY' | 'ORDER';

export interface LedgerAccount {
  code: string;
  name: string;
  type: AccountNature;
}

/* ============================ Pólizas ============================ */

/** Diario para el devengo y los ajustes, ingreso para lo que entra a caja, egreso para lo que sale. */
export type VoucherType = 'DIARIO' | 'INGRESO' | 'EGRESO';

/**
 * Una póliza no se borra ni se edita.
 *
 * `CANCELLED` significa que existe otra póliza de reversa que la deja en cero, y **las dos siguen
 * visibles**. Borrarla dejaría un hueco en el folio consecutivo, que es justo lo que un auditor
 * busca primero.
 */
export type VoucherStatus = 'POSTED' | 'CANCELLED';

export interface VoucherLine {
  accountCode: string;
  accountName: string;
  accountType: AccountNature;
  /**
   * Uno de los dos es 0.
   *
   * El backend guarda pares (una fila = un cargo y su abono) y agrega por cuenta al devolverlos: un
   * pago que liquida capital e intereses son dos pares y salen como tres renglones —caja, capital,
   * intereses—, que es como se lee una póliza.
   */
  debit: number;
  credit: number;
  description: string | null;
}

export interface Voucher {
  voucherId: string;
  voucherType: VoucherType;
  /** Consecutivo por (tipo, sucursal, período). Sin huecos dentro de una sucursal. */
  folio: number;
  period: string;              // YYYYMM
  /** La fecha del **hecho**, no la del posteo. De aquí sale el período. */
  voucherDate: string;
  orgUnitCode: string | null;
  orgUnitName: string | null;
  /**
   * Quién responde por la unidad que colocó el crédito, o `null` si la unidad sellada ya era la
   * sucursal.
   *
   * Lo que un préstamo sella es la unidad del **ejecutivo**, cuyo nombre es el de una persona.
   * Presentado como «Sucursal» hacía parecer que hay tantas plazas como ejecutivos, e impedía
   * agrupar por sucursal. El BFF sube al nivel Sucursal y deja aquí a la persona.
   */
  orgUnitManager: string | null;
  concept: string;
  triggerEvent: string;
  sourceEventId: string;
  creditAccountId: string | null;
  contractNumber: string | null;
  obligorPartyId: string | null;
  /** Lo resuelve el BFF en lote contra party; el dominio sólo guarda el id. */
  obligorName: string | null;
  totalDebit: number;
  totalCredit: number;
  status: VoucherStatus;
  /**
   * El hecho ocurrió en un período ya cerrado y se asentó en el primero abierto.
   *
   * No es un error: es lo que hace una contabilidad real con una partida extemporánea. `originalPeriod`
   * dice a cuál pertenecía, para que la diferencia entre los dos meses tenga explicación.
   */
  isLatePosting: boolean;
  originalPeriod: string | null;
  /** La póliza que ésta reversa, si es una cancelación. */
  reversalRef: string | null;
  /**
   * The product the voucher belongs to: the loan's, the lot's, or the one its bank side moved for. `null` is the
   * institution's own fact (its funding, its capital): it belongs to no product.
   */
  productType?: string | null;
}

export interface VoucherDetail extends Voucher {
  lines: VoucherLine[];
}

export interface VouchersPage {
  content: Voucher[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface VouchersQuery {
  period?: string;
  /**
   * Una sucursal concreta, por código. `SIN_SUCURSAL` trae los créditos anteriores al sellado.
   *
   * Para una rama entera —una región y lo que cuelga— va `unitId`, que el BFF resuelve contra el
   * árbol comercial en una sola llamada.
   */
  unitCode?: string;
  unitId?: string;
  type?: VoucherType;
  creditAccountId?: string;
  partyId?: string;
  page?: number;
  size?: number;
}

/* ============================ Resumen ============================ */

/** Un renglón por sucursal del período. Lo agrega el servidor en SQL, no el navegador. */
export interface UnitAccounting {
  /** Nulo en «Sin sucursal» y en las unidades que ya no están en el árbol. */
  orgUnitId: string | null;
  orgUnitCode: string | null;
  orgUnitName: string;
  /** Quién responde por la sucursal; `null` si está vacante o la unidad no es una plaza. */
  orgUnitManager: string | null;
  vouchers: number;
  totalDebit: number;
  totalCredit: number;
  /** Interés ordinario devengado en el período — lo que esta sucursal ganó. */
  accruedInterest: number;
  moratoriumInterest: number;
  fees: number;
  /** Movimiento neto de la estimación preventiva: positivo es deterioro. */
  provision: number;
  /** Préstamos con al menos un movimiento contable en el período. */
  loans: number;
}

export interface AccountingSummary {
  period: string;
  periodStatus: PeriodStatus;
  vouchers: number;
  /** Sólo cuentas patrimoniales. Las de orden van aparte y no entran al cuadre del balance. */
  totalDebit: number;
  totalCredit: number;
  /** `totalDebit === totalCredit`. Lo calcula el servidor: es la pregunta, no un adorno. */
  balanced: boolean;
  orderAccounts: number;
  accruedInterest: number;
  moratoriumInterest: number;
  fees: number;
  provision: number;
  writeOff: number;
  recovery: number;
  /** IVA trasladado del período. No es ingreso: es dinero del SAT que se cobra y se retiene. */
  ivaAccrued: number;
  /**
   * What has to end up in a CFDI: what the month charged the clients — interest, moratorium, fees — **with IVA**
   * (a CFDI's total includes it). The fiscal base, not the revenue recognized: see `billingBridge`.
   */
  billable: number;
  /** Total facturado del período, sin las canceladas. */
  invoiced: number;
  invoiceCount: number;
  /** `billable − invoiced`, **con signo**: negativo es facturado de más. */
  billingDifference: number;
  /** El período concilia: lo facturable y lo facturado coinciden al centavo. */
  billingReconciled: boolean;
  /** Devengado que todavía no entró en ninguna factura. Es la diferencia, recortada a cero. */
  pendingToBill: number;
  /** Altas de préstamo asentadas en el período — cuántos créditos nacieron. */
  loansRegistered: number;
  byUnit: UnitAccounting[];
  /** From recognized revenue (IFRS) to what was charged and invoiced; absent in older summaries. */
  billingBridge?: BillingBridge | null;
}

/**
 * Why the revenue the books recognize (IFRS 9) and what was charged to the clients (and invoiced) are not the same
 * figure: charged = revenue + IVA + Stage 3 interest not recognized + fees charged and deferred − fees of earlier
 * months recognized now + origination costs amortized (+ unexplained, zero when the bridge holds).
 */
export interface BillingBridge {
  charged: number;
  revenue: number;
  iva: number;
  stage3NotRecognized: number;
  deferredFeesCharged: number;
  deferredFeesRecognized: number;
  originationCostsAmortized: number;
  unexplained: number;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: AccountNature;
  totalDebit: number;
  totalCredit: number;
  /**
   * Net movement of the period (debits − credits), not the account's balance: a month that collected more than it
   * lent shows the portfolio negative here.
   */
  balance: number;
  /** What the account held when the period opened (debit balances positive). */
  openingBalance: number;
  /** What it holds at the close: opening + debits − credits. This is what reconciles with each subledger. */
  closingBalance: number;
}

/** The institution's own facts in the trial balance by product: funding, capital, what belongs to no product. */
export const INSTITUCION = 'INSTITUCION';

/** A product's movement in the period: the row the product selector lists. */
export interface ProductMovement {
  /** `INSTITUCION` for what belongs to no product. */
  productType: string;
  productName: string;
  vouchers: number;
  loans: number;
  totalDebit: number;
  totalCredit: number;
  accruedInterest: number;
  moratoriumInterest: number;
  fees: number;
  provision: number;
}

/** One pair of accounts a concept moved: debit one, credit the other. */
export interface ProductSchemePair {
  debitAccount: string;
  debitName: string;
  creditAccount: string;
  creditName: string;
  entries: number;
  amount: number;
  description: string | null;
}

/** A concept of the product (one business fact) and the pairs of accounts it moved. */
export interface ProductSchemeConcept {
  triggerEvent: string;
  concept: string | null;
  vouchers: number;
  amount: number;
  pairs: ProductSchemePair[];
}

/** A product's accounting scheme as the ledger booked it: each concept and the accounts it moves. */
export interface ProductScheme {
  productType: string;
  productName: string;
  from: string | null;
  to: string | null;
  concepts: ProductSchemeConcept[];
}

export type PeriodStatus = 'OPEN' | 'CLOSED';

/** One check of the month-end close. A failed blocking one keeps the month open; a non-blocking one only reports. */
export interface CloseCheck {
  code: string;
  title: string;
  ok: boolean;
  blocking: boolean;
  /** How many accounts, vouchers or entries are off (or reported). */
  items: number | null;
  /** How much is off, in pesos, when it is a matter of amounts. */
  amount: number | null;
  /** What was compared, in words, with the figures. */
  detail: string;
  /** Measured on the month's last day, which has not come: not in order yet, and not a difference. */
  pending?: boolean;
}

/**
 * The reconciliation of a month: the one its close ran (closed month) or a dry run (open month: nothing booked, the
 * month's deferred fees reported as what the close will book). The close answers with the same shape: 200 when it
 * closed, 409 when it does not reconcile and the month stays open.
 */
export interface PeriodReconciliation {
  period: string;
  status: PeriodStatus;
  /** IN_PROGRESS: the month has not ended; what can be checked today is in order and the rest waits for its last day. */
  outcome: 'RECONCILED' | 'DIFFERENCES' | 'IN_PROGRESS';
  message: string;
  runAt: string;
  closedAt: string | null;
  preview: boolean;
  checks: CloseCheck[];
}

/**
 * What a service says of itself: the checks it ran on its own data, in the close's contract. In order when every check
 * that must hold holds; the informative ones point at something to review. UNREACHABLE: the service did not answer,
 * which is never «in order».
 */
export interface SelfCheckReport {
  service: string;
  scope: string;
  outcome: 'IN_ORDER' | 'DIFFERENCES' | 'UNREACHABLE';
  runAt?: string;
  error?: string;
  checks: CloseCheck[];
}

export interface AccountingPeriod {
  period: string;
  status: PeriodStatus;
  closedAt: string | null;
  vouchers: number;
}

/* ============================ Ficha del préstamo ============================ */

export interface LedgerBalance {
  accountCode: string;
  accountName: string;
  accountType: AccountNature;
  debit: number;
  credit: number;
  balance: number;
}

/**
 * Todo lo contable de un préstamo, ya compuesto por el BFF.
 *
 * Es la vista que contesta el pedido «tracking total»: desde el crédito se llega a sus pólizas y a
 * sus facturas sin pasar por el cliente. Sin ella hay que saber el party primero, y el party de un
 * crédito no es lo que se tiene a la mano cuando se está conciliando un contrato.
 */
export interface LoanLedger {
  creditAccountId: string;
  contractNumber: string;
  obligorPartyId: string;
  obligorName: string;
  productType: string;
  orgUnitCode: string | null;
  orgUnitName: string | null;
  /**
   * Quién responde por la unidad que colocó el crédito, o `null` si la unidad sellada ya era la
   * sucursal.
   *
   * Lo que un préstamo sella es la unidad del **ejecutivo**, cuyo nombre es el de una persona.
   * Presentado como «Sucursal» hacía parecer que hay tantas plazas como ejecutivos, e impedía
   * agrupar por sucursal. El BFF sube al nivel Sucursal y deja aquí a la persona.
   */
  orgUnitManager: string | null;
  authorizedAmount: number;
  disbursedAmount: number;
  originatedAt: string;
  vouchers: Voucher[];
  balances: LedgerBalance[];
  invoices: Invoice[];
}

/* ============================ Préstamos del período ============================ */

/**
 * El movimiento de un préstamo en el período: la fila que agrupa a sus pólizas.
 *
 * <p>Lo agrega el servidor en SQL. Con devengo diario, un mes de una cartera mediana son miles de
 * pólizas: agruparlas en el navegador obligaría a traérselas todas para pintar cien filas, y a
 * truncar en cuanto la cartera crezca — presentando una suma parcial como si fuera el total, en la
 * única pantalla cuyo trabajo es no mentir.
 *
 * <p>El nivel de **cliente** se arma sobre estas filas, que ya vienen sumadas: los préstamos de un
 * período son cientos, no miles.
 */
export interface LoanMovement {
  creditAccountId: string;
  contractNumber: string | null;
  obligorPartyId: string | null;
  obligorName: string | null;
  orgUnitCode: string | null;
  orgUnitName: string | null;
  /**
   * Quién responde por la unidad que colocó el crédito, o `null` si la unidad sellada ya era la
   * sucursal.
   *
   * Lo que un préstamo sella es la unidad del **ejecutivo**, cuyo nombre es el de una persona.
   * Presentado como «Sucursal» hacía parecer que hay tantas plazas como ejecutivos, e impedía
   * agrupar por sucursal. El BFF sube al nivel Sucursal y deja aquí a la persona.
   */
  orgUnitManager: string | null;
  vouchers: number;
  firstVoucherDate: string | null;
  lastVoucherDate: string | null;
  /** Cargos patrimoniales. Las cuentas de orden van aparte por no ser del balance. */
  totalDebit: number;
  orderAccounts: number;
  accruedInterest: number;
  moratoriumInterest: number;
  fees: number;
  provision: number;
  writeOff: number;
  /** Capital colocado en el período: lo que de verdad salió de caja. */
  disbursed: number;
}

export interface LoanMovementsPage {
  content: LoanMovement[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface LoanMovementsQuery {
  period?: string;
  unitCode?: string;
  unitId?: string;
  page?: number;
  size?: number;
}

/* ============================ Facturas ============================ */

export type InvoiceStatus = 'DRAFT' | 'STAMPED' | 'CANCELLED';

export interface InvoiceLine {
  concept: string;
  creditAccountId: string | null;
  contractNumber: string | null;
  amount: number;
  isIva: boolean;
}

export interface Invoice {
  invoiceId: string;
  period: string;
  obligorPartyId: string;
  receptorName: string;
  receptorRfc: string;
  subtotal: number;
  iva: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  /** UUID del timbre. Con PAC simulado **no es un folio fiscal válido**; la pantalla lo dice. */
  folioFiscal: string | null;
  serie: string | null;
  folio: number | null;
  stampedAt: string | null;
  createdAt: string;
  /**
   * Cuántos préstamos distintos componen la factura.
   *
   * La factura **no tiene sucursal** y no se le puede poner una: consolida los conceptos de un
   * cliente, que puede tener créditos colocados por sucursales distintas. La sucursal es del
   * préstamo, y se ve entrando por su ficha.
   */
  loanCount: number;
}

export interface InvoiceDetail extends Invoice {
  receptorRegime: string | null;
  cfdiUse: string | null;
  lines: InvoiceLine[];
}

export interface InvoicesPage {
  content: Invoice[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface InvoicesQuery {
  period?: string;
  status?: InvoiceStatus;
  partyId?: string;
  creditAccountId?: string;
  page?: number;
  size?: number;
}

/* ============================ Cliente ============================ */

export const accountingApi = {
  async periods(): Promise<AccountingPeriod[]> {
    if (!isMock()) return request<AccountingPeriod[]>('/accounting/periods');
    return MOCK_PERIODS;
  },

  async summary(period: string, unitCode?: string): Promise<AccountingSummary> {
    if (!isMock()) {
      return request<AccountingSummary>('/accounting/summary', { query: { period, unitCode } });
    }
    return mockSummary(period, unitCode);
  },

  async units(period: string): Promise<UnitAccounting[]> {
    if (!isMock()) return request<UnitAccounting[]>('/accounting/units', { query: { period } });
    return mockUnits(period);
  },

  async vouchers(query: VouchersQuery = {}): Promise<VouchersPage> {
    if (!isMock()) return request<VouchersPage>('/accounting/vouchers', { query: { ...query } });
    return mockVouchers(query);
  },

  async loans(query: LoanMovementsQuery = {}): Promise<LoanMovementsPage> {
    if (!isMock()) return request<LoanMovementsPage>('/accounting/loans', { query: { ...query } });
    return mockLoans(query);
  },

  /**
   * Todos los préstamos con movimiento en el período, paginando hasta agotarlos.
   *
   * <p>Es lo que permite agrupar por **cliente** sin mentir: cada fila ya viene sumada por el
   * servidor sobre el período completo, así que juntarlas por su party da totales exactos. Agrupar
   * una página de 25 daría cifras por cliente que cambian al pasar de página.
   *
   * <p>El universo aquí son préstamos —cientos—, no pólizas —miles—, y por eso sí cabe traerlo
   * entero. El tope existe igualmente para que una cartera inesperadamente grande no deje la
   * pantalla cargando sin fin; al alcanzarlo se avisa con `truncated` en vez de presentar una suma
   * incompleta como si fuera el total.
   */
  async allLoans(
    query: Omit<LoanMovementsQuery, 'page' | 'size'> = {},
    maxRows = 1500,
  ): Promise<{ content: LoanMovement[]; truncated: boolean }> {
    const size = 200;   // el tope que acepta el dominio por página
    const content: LoanMovement[] = [];
    let page = 0;
    let totalPages = 1;

    do {
      const p = await this.loans({ ...query, page, size });
      content.push(...p.content);
      totalPages = p.totalPages;
      page += 1;
    } while (page < totalPages && content.length < maxRows);

    return { content, truncated: page < totalPages };
  },

  async voucherById(voucherId: string): Promise<VoucherDetail> {
    if (!isMock()) return request<VoucherDetail>(`/accounting/vouchers/${voucherId}`);
    const found = MOCK_VOUCHERS.find((v) => v.voucherId === voucherId);
    if (!found) throw new Error('Póliza no encontrada');
    return found;
  },

  async loanLedger(creditAccountId: string): Promise<LoanLedger> {
    if (!isMock()) return request<LoanLedger>(`/accounting/accounts/${creditAccountId}/ledger`);
    return mockLoanLedger(creditAccountId);
  },

  /** The trial balance of the institution, of a branch, or of a product (`INSTITUCION`: what is no product's). */
  async trialBalance(period: string, unitCode?: string, productType?: string): Promise<TrialBalanceRow[]> {
    if (!isMock()) {
      return request<TrialBalanceRow[]>('/accounting/trial-balance',
        { query: { period, unitCode, productTypes: productType } });
    }
    return mockTrialBalance(period, unitCode, productType);
  },

  /** Each product's movement in the period, the institution's own facts apart. */
  async products(period: string, unitCode?: string): Promise<ProductMovement[]> {
    if (!isMock()) return request<ProductMovement[]>('/accounting/products', { query: { period, unitCode } });
    return mockProducts(period, unitCode);
  },

  /** A product's accounting scheme between two periods (both inclusive; none = its whole history). */
  async productScheme(productType: string, from?: string, to?: string): Promise<ProductScheme> {
    if (!isMock()) {
      return request<ProductScheme>(`/accounting/products/${encodeURIComponent(productType)}/scheme`,
        { query: { from, to } });
    }
    return mockProductScheme(productType, from, to);
  },

  async invoices(query: InvoicesQuery = {}): Promise<InvoicesPage> {
    if (!isMock()) return request<InvoicesPage>('/invoices', { query: { ...query } });
    return mockInvoices(query);
  },

  async invoiceById(invoiceId: string): Promise<InvoiceDetail> {
    if (!isMock()) return request<InvoiceDetail>(`/invoices/${invoiceId}`);
    const found = MOCK_INVOICES.find((i) => i.invoiceId === invoiceId);
    if (!found) throw new Error('Factura no encontrada');
    return found;
  },

  /**
   * Cierre contable. Exige `accounting.close`; el BFF es quien lo comprueba.
   *
   * Cerrar no rechaza lo que llegue después: un hecho de un mes cerrado se asienta en el primero
   * abierto marcado como extemporáneo. Es decir «estos números ya se publicaron», no levantar un
   * muro que haga desaparecer hechos.
   */
  async closePeriod(period: string): Promise<PeriodReconciliation> {
    return request(`/accounting/periods/${period}/close`, { method: 'POST' });
  },

  /** What commissions, treasury, the portfolio and the statements say of themselves. */
  async selfChecks(): Promise<SelfCheckReport[]> {
    if (!isMock()) return request<SelfCheckReport[]>('/accounting/self-checks');
    return mockSelfChecks();
  },

  /** The month's reconciliation: the close's, or a dry run while it is open. */
  async reconciliation(period: string): Promise<PeriodReconciliation> {
    if (!isMock()) return request<PeriodReconciliation>(`/accounting/periods/${period}/reconciliation`);
    return mockReconciliation(period);
  },

  async reopenPeriod(period: string): Promise<{ period: string; status: PeriodStatus }> {
    return request(`/accounting/periods/${period}/reopen`, { method: 'POST' });
  },

  async runBilling(period: string): Promise<{ period: string; invoicesRequested: number }> {
    return request('/accounting/billing-runs', { method: 'POST', query: { period } });
  },

  /**
   * Sella la sucursal de origen de la cartera anterior al sellado.
   *
   * Es una **reconciliación, no una operación del día a día**: se corre una vez tras desplegar y
   * queda disponible por si entra cartera migrada. Hasta que se corre, esos créditos aparecen bajo
   * «Sin sucursal» en el resumen y sus sucursales se ven con menos colocación de la que hicieron.
   *
   * Resuelve, no adivina: cliente → ejecutivo asignado → nodo del ejecutivo → su sucursal. Lo que
   * no se resuelve se queda sin sucursal y se reporta contado. Repartirlo con una heurística haría
   * que las sumas cerraran a costa de atribuirle ingreso a quien no lo colocó, y eso ya no se
   * puede auditar después.
   *
   * Es idempotente, así que correrla dos veces no duplica nada.
   */
  async backfillOriginUnits(opts: { dryRun: boolean; max?: number }): Promise<BackfillResult> {
    return request<BackfillResult>('/accounting/backfill-origin-units', {
      method: 'POST',
      query: { dryRun: String(opts.dryRun), max: opts.max },
    });
  },
};

/** Lo que devuelve la reconciliación de sucursal. Cuenta lo que no pudo resolver, no lo esconde. */
export interface BackfillResult {
  dryRun: boolean;
  revisados: number;
  sellados: number;
  polizasAtribuidas: number;
  polizasBarridas: number;
  yaSellados: number;
  /** Créditos cuyo cliente no tiene ejecutivo: no hay de quién colgar la sucursal. */
  sinEjecutivoAsignado: number;
  /** El ejecutivo existe pero no está adscrito a ninguna unidad del árbol. */
  ejecutivoFueraDelArbol: number;
  muestra: string[];
}

/* ============================================================================
 * Dataset mock
 *
 * Coherente por construcción, no por transcripción: la balanza, el resumen y los totales por
 * sucursal se **derivan** de las pólizas con las mismas sumas que haría el servidor. Escribir los
 * agregados a mano deja una pantalla que cuadra hasta que alguien toca una cifra, y entonces miente
 * en la única pantalla cuyo trabajo es no mentir.
 * ========================================================================== */

export const LEDGER_ACCOUNTS: LedgerAccount[] = [
  { code: '1101', name: 'Bancos / SPEI', type: 'ASSET' },
  // SPEI money between the portfolio's date and the bank's: a payment received at 19:00 waits here for the bank's
  // credit of the next business day.
  { code: '1103', name: 'Remesas en camino: cobranza SPEI por acreditar', type: 'ASSET' },
  { code: '1201', name: 'Cartera de crédito vigente', type: 'ASSET' },
  { code: '1203', name: 'Intereses y comisiones por cobrar', type: 'ASSET' },
  // Transaction costs of origination (the promoter's commission), amortized against interest revenue (IFRS 9 B5.4.8).
  { code: '1205', name: 'Costos de originación por amortizar', type: 'ASSET' },
  // Cartera castigada y su control van en cuentas de ORDEN, no en el activo: el quebranto da de
  // baja el activo del balance y lo castigado se sigue fuera de él (IFRS 9 §5.4.4). Aquí estaba
  // declarada como ASSET mientras el catálogo real la tiene como ORDER, así que en cuanto el mock
  // asentara un quebranto completo su balanza saldría descuadrada por el importe castigado —
  // contra un dominio que cuadra—. Se alinea antes de que eso pase.
  { code: '1210', name: 'Cartera de crédito castigada', type: 'ORDER' },
  { code: '7301', name: 'Control de cartera castigada', type: 'ORDER' },
  { code: '1290', name: 'Estimación preventiva para riesgos crediticios', type: 'CONTRA_ASSET' },
  { code: '2101', name: 'Fondos de clientes por disponer', type: 'LIABILITY' },
  // What a received credit left over after paying what was owed: it is the payer's, applied to the next installment.
  { code: '2102', name: 'Saldos a favor de clientes', type: 'LIABILITY' },
  // A disposition waits here until the bank reports its SPEI order out on the operation date.
  { code: '2103', name: 'Acreedores por liquidación de operaciones: SPEI por liquidar', type: 'LIABILITY' },
  { code: '2110', name: 'IVA trasladado por pagar', type: 'LIABILITY' },
  // Funding: the lines drawn (IFRS 9 liability at amortised cost), their interest and their transaction costs.
  { code: '2201', name: 'Préstamos bancarios y de otros organismos', type: 'LIABILITY' },
  { code: '2202', name: 'Intereses devengados por pagar de préstamos', type: 'LIABILITY' },
  { code: '2209', name: 'Costos de transacción por amortizar de préstamos', type: 'LIABILITY' },
  { code: '3101', name: 'Capital social pagado', type: 'EQUITY' },
  // The year-end close (period 13) takes the year's result here.
  { code: '3201', name: 'Resultado de ejercicios anteriores', type: 'EQUITY' },
  { code: '4101', name: 'Ingresos por intereses', type: 'INCOME' },
  { code: '4102', name: 'Ingresos por intereses moratorios', type: 'INCOME' },
  { code: '4103', name: 'Ingresos por comisiones', type: 'INCOME' },
  { code: '4104', name: 'Recuperación de cartera castigada', type: 'INCOME' },
  // The opening fee and the origination costs inside the effective interest rate: interest revenue, not fee income.
  { code: '4106', name: 'Ingresos por intereses: comisiones y costos de originación (tasa efectiva)', type: 'INCOME' },
  { code: '5101', name: 'Gasto por estimación preventiva', type: 'EXPENSE' },
  { code: '5102', name: 'Gasto por quebranto / quita', type: 'EXPENSE' },
  { code: '5103', name: 'Gasto por condonación', type: 'EXPENSE' },
  { code: '5201', name: 'Gastos por intereses de préstamos bancarios y de otros organismos', type: 'EXPENSE' },
  { code: '7101', name: 'Líneas de crédito autorizadas', type: 'ORDER' },
  { code: '7201', name: 'Líneas autorizadas por disponer', type: 'ORDER' },
];

const ACCOUNT_BY_CODE = new Map(LEDGER_ACCOUNTS.map((a) => [a.code, a]));

/**
 * La sucursal y quién responde por ella.
 *
 * `manager` es nulo a propósito en una: una sucursal sin ejecutivo asignado es un caso real —queda
 * vacante entre una baja y la siguiente alta— y la pantalla tiene que decirlo en vez de dejar el
 * renglón mudo, que se lee como un dato que no cargó.
 */
interface MockUnit { id: string; code: string; name: string; path: string; manager: string | null }

const UNITS: MockUnit[] = [
  { id: 'u-suc-001', code: 'SUC001', name: 'Sucursal Culiacán',         path: 'MX.NORTE.NOROESTE.SUC001',
    manager: 'Diego Lozano Fuentes' },
  { id: 'u-suc-002', code: 'SUC002', name: 'Sucursal Mazatlán',         path: 'MX.NORTE.NOROESTE.SUC002',
    manager: 'Marisol Cuevas Ibarra' },
  { id: 'u-suc-003', code: 'SUC003', name: 'Sucursal Monterrey Centro', path: 'MX.NORTE.MTY.SUC003',
    manager: null },
  { id: 'u-suc-004', code: 'SUC004', name: 'Sucursal Guadalajara',      path: 'MX.OCCIDENTE.GDL.SUC004',
    manager: 'Emilio Ávalos Pineda' },
];

const UNIT_BY_ID = new Map(UNITS.map((u) => [u.id, u]));

interface MockLoan {
  id: string; contract: string; partyId: string; party: string;
  product: string; unit: string | null; authorized: number; disbursed: number; originatedAt: string;
}

const LOANS: MockLoan[] = [
  { id: 'ca-0187', contract: 'CTR-202606-0187', partyId: 'p-julieta',   party: 'Julieta Tejeda Rojas',
    product: 'PERSONAL_LOAN', unit: 'u-suc-001', authorized: 180000, disbursed: 180000, originatedAt: '2026-06-11T16:20:00Z' },
  { id: 'ca-0501', contract: 'CTR-202608-0501', partyId: 'p-adriana',   party: 'Adriana Peralta Fonseca',
    product: 'PERSONAL_LOAN', unit: 'u-suc-001', authorized: 250000, disbursed: 250000, originatedAt: '2026-08-04T15:10:00Z' },
  { id: 'ca-0244', contract: 'CTR-202607-0244', partyId: 'p-ferretero', party: 'Grupo Ferretero del Pacífico, S.A. de C.V.',
    product: 'DISTRIBUTOR_LINE', unit: 'u-suc-002', authorized: 450000, disbursed: 300000, originatedAt: '2026-07-02T17:00:00Z' },
  { id: 'ca-0245', contract: 'CTR-202607-0245', partyId: 'p-ferretero', party: 'Grupo Ferretero del Pacífico, S.A. de C.V.',
    product: 'REVOLVING_LINE', unit: 'u-suc-002', authorized: 150000, disbursed: 150000, originatedAt: '2026-07-19T18:30:00Z' },
  { id: 'ca-0091', contract: 'CTR-202605-0091', partyId: 'p-ramiro',    party: 'Ramiro Escalante Vidal',
    product: 'PAYROLL_LOAN', unit: 'u-suc-003', authorized: 90000, disbursed: 90000, originatedAt: '2026-05-08T14:45:00Z' },
  { id: 'ca-0012', contract: 'CTR-202601-0012', partyId: 'p-marisol',   party: 'Marisol Ibarra Quintero',
    product: 'PERSONAL_LOAN', unit: 'u-suc-004', authorized: 60000, disbursed: 60000, originatedAt: '2026-01-22T15:00:00Z' },
  // Anterior al sellado de unidad: existe, contabiliza, y no se sabe de qué sucursal es.
  { id: 'ca-0333', contract: 'CTR-202512-0333', partyId: 'p-heriberto', party: 'Heriberto Nájera Solís',
    product: 'PERSONAL_LOAN', unit: null, authorized: 45000, disbursed: 45000, originatedAt: '2025-12-15T16:00:00Z' },
];

const LOAN_BY_ID = new Map(LOANS.map((l) => [l.id, l]));

/** Renglón compacto: `[cuenta, cargo, abono]`. El detalle largo lo pone el concepto de la póliza. */
type LineSpec = [string, number, number];

interface VoucherSpec {
  type: VoucherType;
  period: string;
  date: string;
  loan: string;
  concept: string;
  trigger: string;
  lines: LineSpec[];
  status?: VoucherStatus;
  latePosting?: { originalPeriod: string };
  reversalOf?: string;
}

/**
 * El ciclo de vida completo, en el orden en que ocurre.
 *
 * `ca-0501` lo recorre entero dentro del período abierto —alta en cuentas de orden, disposición,
 * comisión, IVA y devengo—, que es exactamente lo que se pidió poder ver: el préstamo registrado
 * primero y después devengamiento a devengamiento.
 */
const VOUCHER_SPECS: VoucherSpec[] = [
  // ── Nacimiento de los créditos más antiguos ─────────────────────────────
  // Están aquí para que la ficha contable de un préstamo arranque en su alta y no a media vida:
  // un auxiliar que empieza con un abono a cartera parece un error de captura.
  { type: 'DIARIO', period: '202601', date: '2026-01-22T15:05:00Z', loan: 'ca-0012',
    concept: 'Alta de línea de crédito autorizada', trigger: 'ACCOUNT_ACTIVATED',
    lines: [['7101', 60000, 0], ['7201', 0, 60000]] },
  { type: 'EGRESO', period: '202601', date: '2026-01-22T16:30:00Z', loan: 'ca-0012',
    concept: 'Disposición íntegra por SPEI', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 60000, 0], ['1101', 0, 60000]] },
  { type: 'DIARIO', period: '202602', date: '2026-02-28T06:00:00Z', loan: 'ca-0012',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 1620, 0], ['4101', 0, 1620]] },
  { type: 'INGRESO', period: '202603', date: '2026-03-14T18:20:00Z', loan: 'ca-0012',
    concept: 'Pago recibido — último antes de caer en mora', trigger: 'PAYMENT_APPLIED',
    lines: [['1101', 14200, 0], ['1203', 0, 1620], ['1201', 0, 12580]] },

  { type: 'DIARIO', period: '202605', date: '2026-05-08T14:50:00Z', loan: 'ca-0091',
    concept: 'Alta de línea de crédito autorizada', trigger: 'ACCOUNT_ACTIVATED',
    lines: [['7101', 90000, 0], ['7201', 0, 90000]] },
  { type: 'EGRESO', period: '202605', date: '2026-05-08T16:10:00Z', loan: 'ca-0091',
    concept: 'Disposición íntegra por SPEI', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 90000, 0], ['1101', 0, 90000]] },
  { type: 'DIARIO', period: '202605', date: '2026-05-08T16:12:00Z', loan: 'ca-0091',
    concept: 'Comisión de apertura 3% sobre monto dispuesto', trigger: 'CHARGE_OPENING_FEE',
    lines: [['1203', 2700, 0], ['4103', 0, 2700]] },
  { type: 'DIARIO', period: '202605', date: '2026-05-08T16:12:00Z', loan: 'ca-0091',
    concept: 'IVA trasladado sobre comisión de apertura', trigger: 'CHARGE_IVA',
    lines: [['1203', 432, 0], ['2110', 0, 432]] },

  { type: 'DIARIO', period: '202606', date: '2026-06-11T16:25:00Z', loan: 'ca-0187',
    concept: 'Alta de línea de crédito autorizada', trigger: 'ACCOUNT_ACTIVATED',
    lines: [['7101', 180000, 0], ['7201', 0, 180000]] },
  { type: 'EGRESO', period: '202606', date: '2026-06-11T17:40:00Z', loan: 'ca-0187',
    concept: 'Disposición íntegra por SPEI', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 180000, 0], ['1101', 0, 180000]] },
  { type: 'DIARIO', period: '202606', date: '2026-06-11T17:42:00Z', loan: 'ca-0187',
    concept: 'Comisión de apertura 3% sobre monto dispuesto', trigger: 'CHARGE_OPENING_FEE',
    lines: [['1203', 5400, 0], ['4103', 0, 5400]] },
  { type: 'DIARIO', period: '202606', date: '2026-06-11T17:42:00Z', loan: 'ca-0187',
    concept: 'IVA trasladado sobre comisión de apertura', trigger: 'CHARGE_IVA',
    lines: [['1203', 864, 0], ['2110', 0, 864]] },
  { type: 'DIARIO', period: '202606', date: '2026-06-30T06:00:00Z', loan: 'ca-0187',
    concept: 'Devengamiento de interés ordinario — 19 días desde disposición', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 3040, 0], ['4101', 0, 3040]] },
  { type: 'DIARIO', period: '202606', date: '2026-06-30T06:00:00Z', loan: 'ca-0091',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 1508, 0], ['4101', 0, 1508]] },

  // ── 202607 · cerrado ────────────────────────────────────────────────────
  // La estimación de ca-0012 se constituye aquí; en agosto el quebranto la consume. Sin este
  // asiento, el consumo de agosto saldría de una reserva que nunca se creó.
  { type: 'DIARIO', period: '202607', date: '2026-07-10T03:00:00Z', loan: 'ca-0012',
    concept: 'Estimación preventiva — deterioro a pérdida esperada total', trigger: 'PROVISION_EPR',
    lines: [['5101', 38000, 0], ['1290', 0, 38000]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-19T18:32:00Z', loan: 'ca-0245',
    concept: 'Alta de línea de crédito revolvente autorizada', trigger: 'ACCOUNT_ACTIVATED',
    lines: [['7101', 150000, 0], ['7201', 0, 150000]] },
  { type: 'EGRESO', period: '202607', date: '2026-07-19T18:34:00Z', loan: 'ca-0245',
    concept: 'Disposición de la línea revolvente', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 150000, 0], ['1101', 0, 150000]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-02T17:05:00Z', loan: 'ca-0244',
    concept: 'Alta de línea de crédito autorizada', trigger: 'ACCOUNT_ACTIVATED',
    lines: [['7101', 450000, 0], ['7201', 0, 450000]] },
  { type: 'EGRESO', period: '202607', date: '2026-07-02T18:40:00Z', loan: 'ca-0244',
    concept: 'Disposición inicial a cuenta CLABE del acreditado', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 300000, 0], ['1101', 0, 300000]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-02T18:45:00Z', loan: 'ca-0244',
    concept: 'Comisión de apertura 3% sobre monto dispuesto', trigger: 'CHARGE_OPENING_FEE',
    lines: [['1203', 9000, 0], ['4103', 0, 9000]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-02T18:45:00Z', loan: 'ca-0244',
    concept: 'IVA trasladado sobre comisión de apertura', trigger: 'CHARGE_IVA',
    lines: [['1203', 1440, 0], ['2110', 0, 1440]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-31T06:00:00Z', loan: 'ca-0244',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 7000, 0], ['4101', 0, 7000]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-19T18:35:00Z', loan: 'ca-0245',
    concept: 'Comisión de apertura de línea revolvente', trigger: 'CHARGE_OPENING_FEE',
    lines: [['1203', 4500, 0], ['4103', 0, 4500]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-19T18:35:00Z', loan: 'ca-0245',
    concept: 'IVA trasladado sobre comisión de apertura', trigger: 'CHARGE_IVA',
    lines: [['1203', 720, 0], ['2110', 0, 720]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-31T06:00:00Z', loan: 'ca-0187',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 4800, 0], ['4101', 0, 4800]] },
  { type: 'DIARIO', period: '202607', date: '2026-07-31T06:00:00Z', loan: 'ca-0091',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 1508, 0], ['4101', 0, 1508]] },

  // ── 202608 · abierto ────────────────────────────────────────────────────
  // Sucursal Culiacán — un préstamo que nace y otro que devenga y paga.
  { type: 'DIARIO', period: '202608', date: '2026-08-04T15:12:00Z', loan: 'ca-0501',
    concept: 'Alta de línea de crédito autorizada', trigger: 'ACCOUNT_ACTIVATED',
    lines: [['7101', 250000, 0], ['7201', 0, 250000]] },
  { type: 'EGRESO', period: '202608', date: '2026-08-04T16:02:00Z', loan: 'ca-0501',
    concept: 'Disposición íntegra por SPEI', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 250000, 0], ['1101', 0, 250000]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-04T16:05:00Z', loan: 'ca-0501',
    concept: 'Comisión de apertura 3% sobre monto dispuesto', trigger: 'CHARGE_OPENING_FEE',
    lines: [['1203', 7500, 0], ['4103', 0, 7500]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-04T16:05:00Z', loan: 'ca-0501',
    concept: 'IVA trasladado sobre comisión de apertura', trigger: 'CHARGE_IVA',
    lines: [['1203', 1200, 0], ['2110', 0, 1200]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-13T06:00:00Z', loan: 'ca-0501',
    concept: 'Devengamiento de interés ordinario — 9 días desde disposición', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 2125, 0], ['4101', 0, 2125]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-12T06:00:00Z', loan: 'ca-0187',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 4800, 0], ['4101', 0, 4800]] },
  // El pago de tres renglones: es el hecho que no cabe en el modelo de un par débito/crédito.
  { type: 'INGRESO', period: '202608', date: '2026-08-12T19:30:00Z', loan: 'ca-0187',
    concept: 'Pago recibido — aplica a interés devengado y capital', trigger: 'PAYMENT_APPLIED',
    lines: [['1101', 9800, 0], ['1203', 0, 4800], ['1201', 0, 5000]] },

  // Sucursal Mazatlán — devengo, deterioro y pago del acreditado empresarial.
  { type: 'DIARIO', period: '202608', date: '2026-08-12T06:00:00Z', loan: 'ca-0244',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 7000, 0], ['4101', 0, 7000]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-12T06:00:00Z', loan: 'ca-0245',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 3500, 0], ['4101', 0, 3500]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-10T03:00:00Z', loan: 'ca-0244',
    concept: 'Estimación preventiva — deterioro por recalificación', trigger: 'PROVISION_EPR',
    lines: [['5101', 1850, 0], ['1290', 0, 1850]] },
  { type: 'INGRESO', period: '202608', date: '2026-08-11T18:05:00Z', loan: 'ca-0244',
    concept: 'Pago recibido — aplica a interés devengado y capital', trigger: 'PAYMENT_APPLIED',
    lines: [['1101', 12000, 0], ['1203', 0, 7000], ['1201', 0, 5000]] },
  // Una colocación con la línea de distribuidor: el crédito le llega a una tercera y la deuda se
  // queda con el distribuidor. Contablemente es la misma póliza que cualquier disposición —cargo a
  // cartera, abono a bancos—; a quién le llegó el SPEI lo cuenta tesorería, que lo deriva de aquí.
  { type: 'EGRESO', period: '202608', date: '2026-08-13T16:20:00Z', loan: 'ca-0244',
    concept: 'Crédito a tercero — SPEI a Rosa Elena Ibarra Salgado', trigger: 'DISPOSITION_THIRD_PARTY_CREDIT',
    lines: [['1201', 45000, 0], ['1101', 0, 45000]] },

  // Sucursal Monterrey Centro — el crédito en mora: ordinario, moratorio y deterioro.
  { type: 'DIARIO', period: '202608', date: '2026-08-12T06:00:00Z', loan: 'ca-0091',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 1508, 0], ['4101', 0, 1508]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-12T06:00:00Z', loan: 'ca-0091',
    concept: 'Devengamiento de interés moratorio — 47 días de atraso', trigger: 'CHARGE_MORATORIUM_INTEREST',
    lines: [['1203', 486.2, 0], ['4102', 0, 486.2]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-10T03:00:00Z', loan: 'ca-0091',
    concept: 'Estimación preventiva — deterioro por paso a etapa 3', trigger: 'PROVISION_EPR',
    lines: [['5101', 9360, 0], ['1290', 0, 9360]] },
  // Extemporánea: el hecho es del 31 de julio, el período ya estaba cerrado.
  { type: 'DIARIO', period: '202608', date: '2026-07-31T23:58:00Z', loan: 'ca-0091',
    concept: 'Devengamiento de interés moratorio del cierre de julio', trigger: 'CHARGE_MORATORIUM_INTEREST',
    lines: [['1203', 470.15, 0], ['4102', 0, 470.15]], latePosting: { originalPeriod: '202607' } },

  // Sucursal Guadalajara — quebranto y recuperación posterior.
  //
  // Una sola póliza con los dos renglones, como la produce el dominio: consumir la reserva
  // constituida y llevar el resto a resultados son el mismo hecho, y separarlos deja dos asientos
  // que nada relaciona. El capital de ca-0012 son 47,420 y su reserva 38,000.
  { type: 'DIARIO', period: '202608', date: '2026-08-06T03:00:00Z', loan: 'ca-0012',
    concept: 'Quebranto de cartera', trigger: 'WRITE_OFF',
    lines: [['1290', 38000, 0], ['1201', 0, 38000], ['5102', 9420, 0], ['1201', 0, 9420]] },
  // Y su registro en cuentas de orden: dar de baja el activo no extingue el derecho de cobro, así
  // que lo castigado se sigue fuera del balance. Sin esta póliza, una recuperación posterior no
  // tendría contra qué cotejarse.
  { type: 'DIARIO', period: '202608', date: '2026-08-06T03:00:00Z', loan: 'ca-0012',
    concept: 'Registro en cuentas de orden de la cartera castigada', trigger: 'WRITE_OFF_CONTROL',
    lines: [['1210', 47420, 0], ['7301', 0, 47420]] },
  { type: 'INGRESO', period: '202608', date: '2026-08-13T17:40:00Z', loan: 'ca-0012',
    concept: 'Recuperación de cartera castigada — convenio extrajudicial', trigger: 'RECOVERY_PAYMENT',
    lines: [['1101', 3500, 0], ['4104', 0, 3500]] },

  // Sin sucursal — asientos anteriores al sellado, más una cancelación con su reversa.
  { type: 'DIARIO', period: '202608', date: '2026-08-12T06:00:00Z', loan: 'ca-0333',
    concept: 'Devengamiento de interés ordinario del período', trigger: 'CHARGE_ORDINARY_INTEREST',
    lines: [['1203', 1140, 0], ['4101', 0, 1140]] },
  { type: 'DIARIO', period: '202608', date: '2026-08-05T06:00:00Z', loan: 'ca-0333',
    concept: 'Comisión de administración mensual', trigger: 'CHARGE_ADMIN_FEE',
    lines: [['1203', 890, 0], ['4103', 0, 890]], status: 'CANCELLED' },
  { type: 'DIARIO', period: '202608', date: '2026-08-07T11:20:00Z', loan: 'ca-0333',
    concept: 'Reversa de comisión de administración cobrada por error', trigger: 'CHARGE_REVERSED',
    lines: [['4103', 890, 0], ['1203', 0, 890]], reversalOf: 'CHARGE_ADMIN_FEE' },
];

function buildVouchers(): VoucherDetail[] {
  // El folio es consecutivo por (tipo, sucursal, período): es lo que hace que la serie de una
  // sucursal no tenga huecos causados por el movimiento de otra.
  const folios = new Map<string, number>();
  const built: VoucherDetail[] = [];

  VOUCHER_SPECS.forEach((spec, i) => {
    const loan = LOAN_BY_ID.get(spec.loan);
    if (!loan) throw new Error(`Mock inconsistente: préstamo ${spec.loan} no existe`);
    const unit = loan.unit ? UNIT_BY_ID.get(loan.unit) ?? null : null;

    const folioKey = `${spec.type}|${unit?.id ?? 'SIN'}|${spec.period}`;
    const folio = (folios.get(folioKey) ?? 0) + 1;
    folios.set(folioKey, folio);

    // El backend agrega los pares por cuenta al devolverlos; aquí las especificaciones ya vienen
    // como renglones de un solo lado, así que se emiten tal cual.
    const lines: VoucherLine[] = spec.lines.map(([code, debit, credit]) => ({
      accountCode: code,
      accountName: ACCOUNT_BY_CODE.get(code)?.name ?? code,
      accountType: ACCOUNT_BY_CODE.get(code)?.type ?? 'ASSET',
      debit,
      credit,
      description: null,
    }));

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (totalDebit !== totalCredit) {
      // Una póliza descuadrada en el dataset produciría una pantalla que dice que la contabilidad
      // no cuadra por culpa del mock. Mejor que reviente aquí, en el arranque del módulo.
      throw new Error(`Póliza descuadrada en el mock: ${spec.concept} (${totalDebit} ≠ ${totalCredit})`);
    }

    built.push({
      voucherId: `pol-${String(i + 1).padStart(3, '0')}`,
      voucherType: spec.type,
      folio,
      period: spec.period,
      voucherDate: spec.date,
      orgUnitCode: unit?.code ?? null,
      orgUnitName: unit?.name ?? null,
      orgUnitManager: unit?.manager ?? null,
      concept: spec.concept,
      triggerEvent: spec.trigger,
      sourceEventId: `${spec.trigger}:${loan.id}:${spec.date}`,
      creditAccountId: loan.id,
      contractNumber: loan.contract,
      obligorPartyId: loan.partyId,
      obligorName: loan.party,
      productType: loan.product,
      totalDebit,
      totalCredit,
      status: spec.status ?? 'POSTED',
      isLatePosting: spec.latePosting != null,
      originalPeriod: spec.latePosting?.originalPeriod ?? null,
      reversalRef: null,
      lines,
    });
  });

  // Enlaza la reversa con la póliza que cancela, ya que las dos existen.
  built.forEach((v, i) => {
    const spec = VOUCHER_SPECS[i];
    if (!spec.reversalOf) return;
    const target = built.find(
      (c) => c.creditAccountId === v.creditAccountId && c.triggerEvent === spec.reversalOf,
    );
    if (target) v.reversalRef = target.voucherId;
  });

  return built;
}

const MOCK_VOUCHERS: VoucherDetail[] = buildVouchers();

/**
 * Los períodos salen de las pólizas que existen, no de una lista escrita aparte.
 *
 * Con dos listas, un mes con movimiento que faltara en el selector sería invisible: la pantalla
 * diría que no hay nada donde sí lo hay, y no habría forma de notarlo desde la interfaz. Los meses
 * sin movimiento simplemente no aparecen, que es lo correcto.
 */
const CURRENT_PERIOD = '202608';

const MOCK_PERIODS: AccountingPeriod[] = [...new Set(MOCK_VOUCHERS.map((v) => v.period))]
  .sort((a, b) => b.localeCompare(a))
  .map((period) => ({
    period,
    status: period === CURRENT_PERIOD ? 'OPEN' : 'CLOSED',
    closedAt: period === CURRENT_PERIOD ? null : `${period.slice(0, 4)}-${period.slice(4, 6)}-28T18:00:00Z`,
    vouchers: MOCK_VOUCHERS.filter((v) => v.period === period).length,
  }));

const MOCK_INVOICES: InvoiceDetail[] = [
  {
    invoiceId: 'inv-1041', period: '202607', obligorPartyId: 'p-julieta',
    receptorName: 'JULIETA TEJEDA ROJAS', receptorRfc: 'TERJ890412K21',
    receptorRegime: '605', cfdiUse: 'G03',
    // Sin IVA: el interés de un crédito a persona física sin actividad empresarial va exento.
    subtotal: 4800, iva: 0, total: 4800, currency: 'MXN',
    status: 'STAMPED', folioFiscal: 'a1c8e0f2-7b64-4e19-9d33-2f5c8b7a1e40', serie: 'A', folio: 1041,
    stampedAt: '2026-08-01T09:12:00Z', createdAt: '2026-08-01T09:10:00Z',
    loanCount: 1,
    lines: [
      { concept: 'ORDINARY_INTEREST', creditAccountId: 'ca-0187', contractNumber: 'CTR-202606-0187', amount: 4800, isIva: false },
    ],
  },
  {
    invoiceId: 'inv-1042', period: '202607', obligorPartyId: 'p-ferretero',
    receptorName: 'GRUPO FERRETERO DEL PACIFICO SA DE CV', receptorRfc: 'GFP190815HM2',
    receptorRegime: '601', cfdiUse: 'G03',
    subtotal: 20500, iva: 3280, total: 23780, currency: 'MXN',
    status: 'STAMPED', folioFiscal: 'd4f70b19-3a52-4c8e-8b71-9e0a6d2c4f88', serie: 'A', folio: 1042,
    stampedAt: '2026-08-01T09:12:00Z', createdAt: '2026-08-01T09:10:00Z',
    loanCount: 2,
    // Dos préstamos en un solo CFDI: es el caso que justifica agrupar por contrato al presentarla.
    lines: [
      { concept: 'OPENING_FEE',       creditAccountId: 'ca-0244', contractNumber: 'CTR-202607-0244', amount: 9000, isIva: false },
      { concept: 'IVA',               creditAccountId: 'ca-0244', contractNumber: 'CTR-202607-0244', amount: 1440, isIva: true },
      { concept: 'ORDINARY_INTEREST', creditAccountId: 'ca-0244', contractNumber: 'CTR-202607-0244', amount: 7000, isIva: false },
      { concept: 'IVA',               creditAccountId: 'ca-0244', contractNumber: 'CTR-202607-0244', amount: 1120, isIva: true },
      { concept: 'OPENING_FEE',       creditAccountId: 'ca-0245', contractNumber: 'CTR-202607-0245', amount: 4500, isIva: false },
      { concept: 'IVA',               creditAccountId: 'ca-0245', contractNumber: 'CTR-202607-0245', amount: 720, isIva: true },
    ],
  },
  {
    invoiceId: 'inv-1043', period: '202607', obligorPartyId: 'p-ramiro',
    receptorName: 'RAMIRO ESCALANTE VIDAL', receptorRfc: 'EAVR760930J45',
    receptorRegime: '605', cfdiUse: 'G03',
    subtotal: 1508, iva: 0, total: 1508, currency: 'MXN',
    status: 'STAMPED', folioFiscal: '6b2e91c4-58af-4d70-a1e6-3c9f0b8d5721', serie: 'A', folio: 1043,
    stampedAt: '2026-08-01T09:12:00Z', createdAt: '2026-08-01T09:10:00Z',
    loanCount: 1,
    lines: [
      { concept: 'ORDINARY_INTEREST', creditAccountId: 'ca-0091', contractNumber: 'CTR-202605-0091', amount: 1508, isIva: false },
    ],
  },
  {
    invoiceId: 'inv-1044', period: '202607', obligorPartyId: 'p-heriberto',
    receptorName: 'HERIBERTO NAJERA SOLIS', receptorRfc: 'NASH810227B18',
    receptorRegime: '605', cfdiUse: 'G03',
    subtotal: 890, iva: 142.4, total: 1032.4, currency: 'MXN',
    status: 'CANCELLED', folioFiscal: '0e93a7d5-1c46-4b82-9f30-7a5e2d8c6b14', serie: 'A', folio: 1044,
    stampedAt: '2026-08-01T09:12:00Z', createdAt: '2026-08-01T09:10:00Z',
    loanCount: 1,
    lines: [
      { concept: 'ADMIN_FEE', creditAccountId: 'ca-0333', contractNumber: 'CTR-202512-0333', amount: 890, isIva: false },
      { concept: 'IVA',       creditAccountId: 'ca-0333', contractNumber: 'CTR-202512-0333', amount: 142.4, isIva: true },
    ],
  },
  {
    invoiceId: 'inv-1051', period: '202608', obligorPartyId: 'p-adriana',
    receptorName: 'ADRIANA PERALTA FONSECA', receptorRfc: 'PEFA930718D09',
    receptorRegime: '612', cfdiUse: 'G03',
    subtotal: 9625, iva: 1200, total: 10825, currency: 'MXN',
    // Generada por la corrida y todavía sin timbrar: el PAC de este entorno es simulado.
    status: 'DRAFT', folioFiscal: null, serie: null, folio: null,
    stampedAt: null, createdAt: '2026-08-13T07:00:00Z',
    loanCount: 1,
    lines: [
      { concept: 'OPENING_FEE',       creditAccountId: 'ca-0501', contractNumber: 'CTR-202608-0501', amount: 7500, isIva: false },
      { concept: 'IVA',               creditAccountId: 'ca-0501', contractNumber: 'CTR-202608-0501', amount: 1200, isIva: true },
      { concept: 'ORDINARY_INTEREST', creditAccountId: 'ca-0501', contractNumber: 'CTR-202608-0501', amount: 2125, isIva: false },
    ],
  },
];

/* ── Derivaciones ───────────────────────────────────────────────────────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function natureOf(code: string): AccountNature {
  return ACCOUNT_BY_CODE.get(code)?.type ?? 'ASSET';
}

/** Las de orden cuadran entre sí y no forman parte del balance. */
function isOrder(code: string): boolean {
  return natureOf(code) === 'ORDER';
}

function inScope(v: Voucher, unitCode?: string): boolean {
  if (!unitCode) return true;
  if (unitCode === 'SIN_SUCURSAL') return v.orgUnitCode == null;
  return v.orgUnitCode === unitCode;
}

function periodVouchers(period: string, unitCode?: string): VoucherDetail[] {
  return MOCK_VOUCHERS.filter((v) => v.period === period && inScope(v, unitCode));
}

/** Movimiento acreedor neto de una cuenta: lo que ganó (ingresos) o lo que se constituyó (reserva). */
function creditMovement(vouchers: VoucherDetail[], code: string): number {
  let net = 0;
  vouchers.forEach((v) => v.lines.forEach((l) => {
    if (l.accountCode === code) net += l.credit - l.debit;
  }));
  return round2(net);
}

function debitMovement(vouchers: VoucherDetail[], code: string): number {
  let net = 0;
  vouchers.forEach((v) => v.lines.forEach((l) => {
    if (l.accountCode === code) net += l.debit - l.credit;
  }));
  return round2(net);
}

function mockUnits(period: string): UnitAccounting[] {
  const rows: UnitAccounting[] = [];
  const groups: Array<{ unit: MockUnit | null }> = [
    ...UNITS.map((u) => ({ unit: u as MockUnit | null })),
    { unit: null },
  ];

  groups.forEach(({ unit }) => {
    const vs = periodVouchers(period, unit?.code ?? 'SIN_SUCURSAL');
    if (vs.length === 0) return;

    let debit = 0;
    let credit = 0;
    vs.forEach((v) => v.lines.forEach((l) => {
      if (isOrder(l.accountCode)) return;
      debit += l.debit;
      credit += l.credit;
    }));

    rows.push({
      orgUnitId: unit?.id ?? null,
      orgUnitCode: unit?.code ?? null,
      orgUnitName: unit?.name ?? 'Sin sucursal',
      orgUnitManager: unit?.manager ?? null,
      vouchers: vs.length,
      totalDebit: round2(debit),
      totalCredit: round2(credit),
      accruedInterest: creditMovement(vs, '4101'),
      moratoriumInterest: creditMovement(vs, '4102'),
      fees: creditMovement(vs, '4103'),
      provision: creditMovement(vs, '1290'),
      loans: new Set(vs.map((v) => v.creditAccountId)).size,
    });
  });

  return rows.sort((a, b) => b.totalDebit - a.totalDebit);
}

function mockSummary(period: string, unitCode?: string): AccountingSummary {
  const vs = periodVouchers(period, unitCode);

  let debit = 0;
  let credit = 0;
  let order = 0;
  vs.forEach((v) => v.lines.forEach((l) => {
    if (isOrder(l.accountCode)) { order += l.debit; return; }
    debit += l.debit;
    credit += l.credit;
  }));

  const invoices = MOCK_INVOICES.filter((i) => i.period === period && i.status !== 'CANCELLED');
  const accrued = creditMovement(vs, '4101');
  const moratorium = creditMovement(vs, '4102');
  const fees = creditMovement(vs, '4103');
  const iva = creditMovement(vs, '2110');
  const invoiced = round2(invoices.reduce((s, i) => s + i.total, 0));

  return {
    period,
    periodStatus: MOCK_PERIODS.find((p) => p.period === period)?.status ?? 'OPEN',
    vouchers: vs.length,
    totalDebit: round2(debit),
    totalCredit: round2(credit),
    balanced: round2(debit) === round2(credit),
    orderAccounts: round2(order),
    accruedInterest: accrued,
    moratoriumInterest: moratorium,
    fees,
    provision: creditMovement(vs, '1290'),
    writeOff: debitMovement(vs, '5102'),
    recovery: creditMovement(vs, '4104'),
    ivaAccrued: iva,
    billable: round2(accrued + moratorium + fees + iva),
    invoiced,
    invoiceCount: invoices.length,
    billingDifference: round2(accrued + moratorium + fees + iva - invoiced),
    billingReconciled: Math.abs(accrued + moratorium + fees + iva - invoiced) < 0.01,
    pendingToBill: round2(Math.max(0, accrued + moratorium + fees + iva - invoiced)),
    loansRegistered: vs.filter((v) => v.triggerEvent === 'ACCOUNT_ACTIVATED').length,
    byUnit: unitCode ? [] : mockUnits(period),
  };
}

function mockVouchers(q: VouchersQuery): VouchersPage {
  const size = q.size ?? 25;
  const page = q.page ?? 0;

  const all = MOCK_VOUCHERS
    .filter((v) => (q.period ? v.period === q.period : true))
    .filter((v) => inScope(v, q.unitCode))
    .filter((v) => (q.type ? v.voucherType === q.type : true))
    .filter((v) => (q.creditAccountId ? v.creditAccountId === q.creditAccountId : true))
    .filter((v) => (q.partyId ? v.obligorPartyId === q.partyId : true))
    .sort((a, b) => b.voucherDate.localeCompare(a.voucherDate));

  return {
    content: all.slice(page * size, page * size + size),
    page,
    size,
    totalElements: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/**
 * Los préstamos con movimiento en el período, derivados de las mismas pólizas.
 *
 * Se agrupa aquí igual que lo agrega el servidor en SQL, para que la pantalla se comporte igual
 * contra el mock que contra el BFF: si el agrupado sólo existiera en vivo, la vista por crédito
 * quedaría vacía en modo demostración y parecería rota.
 */
function mockLoans(q: LoanMovementsQuery): LoanMovementsPage {
  const size = q.size ?? 25;
  const page = q.page ?? 0;
  const vs = MOCK_VOUCHERS
    .filter((v) => (q.period ? v.period === q.period : true))
    .filter((v) => inScope(v, q.unitCode));

  const porCredito = new Map<string, VoucherDetail[]>();
  vs.forEach((v) => {
    if (!v.creditAccountId) return;
    const lista = porCredito.get(v.creditAccountId) ?? [];
    lista.push(v);
    porCredito.set(v.creditAccountId, lista);
  });

  const all: LoanMovement[] = [...porCredito.entries()].map(([id, pols]) => {
    const loan = LOAN_BY_ID.get(id);
    const unit = loan?.unit ? UNIT_BY_ID.get(loan.unit) ?? null : null;
    const fechas = pols.map((p) => p.voucherDate).sort();

    let patrimonial = 0;
    let orden = 0;
    let dispuesto = 0;
    pols.forEach((p) => p.lines.forEach((l) => {
      if (isOrder(l.accountCode)) { orden += l.debit; return; }
      patrimonial += l.debit;
      if (l.accountCode === '1201' && l.debit > 0
          && p.lines.some((o) => o.accountCode === '1101' && o.credit > 0)) {
        dispuesto += l.debit;
      }
    }));

    return {
      creditAccountId: id,
      contractNumber: loan?.contract ?? null,
      obligorPartyId: loan?.partyId ?? null,
      obligorName: loan?.party ?? null,
      orgUnitCode: unit?.code ?? null,
      orgUnitName: unit?.name ?? null,
      orgUnitManager: unit?.manager ?? null,
      vouchers: pols.length,
      firstVoucherDate: fechas[0] ?? null,
      lastVoucherDate: fechas[fechas.length - 1] ?? null,
      totalDebit: round2(patrimonial),
      orderAccounts: round2(orden),
      accruedInterest: creditMovement(pols, '4101'),
      moratoriumInterest: creditMovement(pols, '4102'),
      fees: creditMovement(pols, '4103'),
      provision: creditMovement(pols, '1290'),
      writeOff: debitMovement(pols, '5102'),
      disbursed: round2(dispuesto),
    };
  }).sort((a, b) => b.totalDebit - a.totalDebit);

  return {
    content: all.slice(page * size, page * size + size),
    page,
    size,
    totalElements: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/** A voucher of the product; `INSTITUCION` takes what belongs to no product. */
function ofProduct(v: Voucher, productType?: string): boolean {
  if (!productType) return true;
  if (productType === INSTITUCION) return v.productType == null;
  return v.productType === productType;
}

const PRODUCT_NAMES: Record<string, string> = {
  PERSONAL_LOAN: 'Préstamo personal',
  PAYROLL_LOAN: 'Crédito de nómina',
  DISTRIBUTOR_LINE: 'Línea de distribuidora',
  REVOLVING_LINE: 'Línea revolvente',
  [INSTITUCION]: 'Institución',
};

function mockProducts(period: string, unitCode?: string): ProductMovement[] {
  const byProduct = new Map<string, VoucherDetail[]>();
  periodVouchers(period, unitCode).forEach((v) => {
    const key = v.productType ?? INSTITUCION;
    byProduct.set(key, [...(byProduct.get(key) ?? []), v]);
  });
  return [...byProduct.entries()].map(([productType, vs]) => {
    let debit = 0;
    let credit = 0;
    vs.forEach((v) => v.lines.forEach((l) => {
      if (isOrder(l.accountCode)) return;
      debit += l.debit;
      credit += l.credit;
    }));
    return {
      productType,
      productName: PRODUCT_NAMES[productType] ?? productType,
      vouchers: vs.length,
      loans: new Set(vs.map((v) => v.creditAccountId).filter((id) => id != null)).size,
      totalDebit: round2(debit),
      totalCredit: round2(credit),
      accruedInterest: creditMovement(vs, '4101'),
      moratoriumInterest: creditMovement(vs, '4102'),
      fees: creditMovement(vs, '4103'),
      provision: creditMovement(vs, '1290'),
    };
  }).sort((a, b) => b.totalDebit - a.totalDebit);
}

/**
 * A product's scheme from the mock vouchers. The mock keeps one-sided lines, not entries, so each voucher's debits are
 * paired with its credits in order: the pairs add up to the voucher, as the real entries do.
 */
function mockProductScheme(productType: string, from?: string, to?: string): ProductScheme {
  const concepts = new Map<string, { concept: ProductSchemeConcept; pairs: Map<string, ProductSchemePair> }>();
  MOCK_VOUCHERS
    .filter((v) => v.status === 'POSTED' && ofProduct(v, productType))
    .filter((v) => (!from || v.period >= from) && (!to || v.period <= to))
    .forEach((v) => {
      const key = v.triggerEvent;
      const entry = concepts.get(key) ?? {
        concept: { triggerEvent: v.triggerEvent, concept: v.concept, vouchers: 0, amount: 0, pairs: [] },
        pairs: new Map<string, ProductSchemePair>(),
      };
      entry.concept.vouchers += 1;
      entry.concept.amount = round2(entry.concept.amount + v.totalDebit);
      const debits = v.lines.filter((l) => l.debit > 0).map((l) => ({ code: l.accountCode, left: l.debit }));
      const credits = v.lines.filter((l) => l.credit > 0).map((l) => ({ code: l.accountCode, left: l.credit }));
      let d = 0;
      let c = 0;
      while (d < debits.length && c < credits.length) {
        const amount = Math.min(debits[d].left, credits[c].left);
        const pk = `${debits[d].code}|${credits[c].code}`;
        const pair = entry.pairs.get(pk) ?? {
          debitAccount: debits[d].code, debitName: ACCOUNT_BY_CODE.get(debits[d].code)?.name ?? debits[d].code,
          creditAccount: credits[c].code, creditName: ACCOUNT_BY_CODE.get(credits[c].code)?.name ?? credits[c].code,
          entries: 0, amount: 0, description: null,
        };
        pair.entries += 1;
        pair.amount = round2(pair.amount + amount);
        entry.pairs.set(pk, pair);
        debits[d].left = round2(debits[d].left - amount);
        credits[c].left = round2(credits[c].left - amount);
        if (debits[d].left <= 0) d++;
        if (credits[c].left <= 0) c++;
      }
      concepts.set(key, entry);
    });
  return {
    productType,
    productName: PRODUCT_NAMES[productType] ?? productType,
    from: from ?? null,
    to: to ?? null,
    concepts: [...concepts.values()]
      .map(({ concept, pairs }) => ({ ...concept, pairs: [...pairs.values()] }))
      .sort((a, b) => b.amount - a.amount),
  };
}

function mockTrialBalance(period: string, unitCode?: string, productType?: string): TrialBalanceRow[] {
  const vs = periodVouchers(period, unitCode).filter((v) => ofProduct(v, productType));
  const debits = new Map<string, number>();
  const credits = new Map<string, number>();
  const opening = new Map<string, number>();

  vs.forEach((v) => v.lines.forEach((l) => {
    debits.set(l.accountCode, (debits.get(l.accountCode) ?? 0) + l.debit);
    credits.set(l.accountCode, (credits.get(l.accountCode) ?? 0) + l.credit);
  }));
  // What the earlier periods left in each account is this period's opening balance.
  MOCK_VOUCHERS.filter((v) => v.period < period && inScope(v, unitCode) && ofProduct(v, productType)).forEach((v) => v.lines.forEach((l) => {
    opening.set(l.accountCode, (opening.get(l.accountCode) ?? 0) + l.debit - l.credit);
  }));

  return LEDGER_ACCOUNTS
    .filter((a) => (debits.get(a.code) ?? 0) !== 0 || (credits.get(a.code) ?? 0) !== 0 || (opening.get(a.code) ?? 0) !== 0)
    .map((a) => {
      const d = round2(debits.get(a.code) ?? 0);
      const c = round2(credits.get(a.code) ?? 0);
      const o = round2(opening.get(a.code) ?? 0);
      return {
        accountCode: a.code,
        accountName: a.name,
        accountType: a.type,
        totalDebit: d,
        totalCredit: c,
        balance: round2(d - c),
        openingBalance: o,
        closingBalance: round2(o + d - c),
      };
    });
}

function mockLoanLedger(creditAccountId: string): LoanLedger {
  const loan = LOAN_BY_ID.get(creditAccountId);
  if (!loan) throw new Error('Ese crédito no tiene movimientos contables registrados');
  const unit = loan.unit ? UNIT_BY_ID.get(loan.unit) ?? null : null;

  const vs = MOCK_VOUCHERS
    .filter((v) => v.creditAccountId === creditAccountId)
    .sort((a, b) => b.voucherDate.localeCompare(a.voucherDate));

  const debits = new Map<string, number>();
  const credits = new Map<string, number>();
  vs.forEach((v) => v.lines.forEach((l) => {
    debits.set(l.accountCode, (debits.get(l.accountCode) ?? 0) + l.debit);
    credits.set(l.accountCode, (credits.get(l.accountCode) ?? 0) + l.credit);
  }));

  const balances: LedgerBalance[] = LEDGER_ACCOUNTS
    .filter((a) => (debits.get(a.code) ?? 0) !== 0 || (credits.get(a.code) ?? 0) !== 0)
    .map((a) => {
      const d = round2(debits.get(a.code) ?? 0);
      const c = round2(credits.get(a.code) ?? 0);
      return {
        accountCode: a.code, accountName: a.name, accountType: a.type,
        debit: d, credit: c, balance: round2(d - c),
      };
    });

  return {
    creditAccountId: loan.id,
    contractNumber: loan.contract,
    obligorPartyId: loan.partyId,
    obligorName: loan.party,
    productType: loan.product,
    orgUnitCode: unit?.code ?? null,
    orgUnitName: unit?.name ?? null,
    orgUnitManager: unit?.manager ?? null,
    authorizedAmount: loan.authorized,
    disbursedAmount: loan.disbursed,
    originatedAt: loan.originatedAt,
    vouchers: vs,
    balances,
    invoices: MOCK_INVOICES.filter((i) => i.lines.some((l) => l.creditAccountId === creditAccountId)),
  };
}

function mockInvoices(q: InvoicesQuery): InvoicesPage {
  const size = q.size ?? 25;
  const page = q.page ?? 0;

  const all = MOCK_INVOICES
    .filter((i) => (q.period ? i.period === q.period : true))
    .filter((i) => (q.status ? i.status === q.status : true))
    .filter((i) => (q.partyId ? i.obligorPartyId === q.partyId : true))
    .filter((i) => (q.creditAccountId
      ? i.lines.some((l) => l.creditAccountId === q.creditAccountId)
      : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    content: all.slice(page * size, page * size + size),
    page,
    size,
    totalElements: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/** A month of the mock that reconciles, with the checks the real close runs. */
function mockSelfChecks(): SelfCheckReport[] {
  const check = (code: string, title: string, detail: string, blocking = true, ok = true,
                 items = 0, amount = 0): CloseCheck => ({ code, title, ok, blocking, items, amount, detail });
  const at = '2026-11-04T18:00:00Z';
  return [
    { service: 'commission-service', scope: '*', outcome: 'IN_ORDER', runAt: at, checks: [
      check('LOTES_SUMAN_SUS_REGISTROS', 'Cada lote suma sus registros de comisión', '5 lotes: cada uno suma sus registros'),
      check('NETO_DE_CADA_LOTE', 'Neto de cada lote: comisión + IVA − retenciones', '5 lotes con su neto en orden'),
      check('ARRASTRE_EXPLICADO', 'Lo que la corrida dejó sin lote tiene razón', 'Corrida de 202610: 4 grupos bajo el mínimo'),
      check('LOTES_SIN_DESENLACE', 'Lotes enviados hace más de dos días sin desenlace',
        '1 lote enviado sin liquidar ni rechazar: revisar su orden en tesorería', false, false, 1, 541.06),
    ] },
    { service: 'banking-service', scope: '*', outcome: 'IN_ORDER', runAt: at, checks: [
      check('FONDEO_CUADRA', 'Cada fuente de fondeo es la suma de sus movimientos', '2 fuentes en orden'),
      check('PAGOS_EN_CAJA_Y_TRAZA', 'Cada orden liquidada está en el libro de caja y en su traza', '60 órdenes en orden'),
      check('CAJA_NO_NEGATIVA', 'La caja nunca cierra un día en negativo', '185 días, ninguno en negativo'),
    ] },
    { service: 'credit-portfolio-service', scope: '*', outcome: 'IN_ORDER', runAt: at, checks: [
      check('SALDO_IGUAL_A_SU_LIBRO', 'La deuda de cada cuenta es la suma de sus movimientos', '40 cuentas en orden'),
      check('FOTO_SIN_BRECHA', 'Cada foto del día coincidió con el libro de la cuenta', '5,298 fotos sin brecha'),
    ] },
    { service: 'statement-service', scope: '*', outcome: 'IN_ORDER', runAt: at, checks: [
      check('UN_ESTADO_POR_CUENTA_CERRADA', 'Cada corte sellado tiene un estado por cuenta que cerró', '146 corridas en orden'),
      check('DOCUMENTO_DE_CADA_ESTADO', 'Cada estado generado tiene su documento íntegro', '292 estados con su PDF'),
    ] },
  ];
}

function mockReconciliation(period: string): PeriodReconciliation {
  const closed = MOCK_PERIODS.find((p) => p.period === period)?.status === 'CLOSED';
  const check = (code: string, title: string, detail: string, blocking = true, ok = true): CloseCheck =>
    ({ code, title, ok, blocking, items: 0, amount: 0, detail });
  const checks = [
    check('CARTERA_CERRADA', 'Cartera cerró el último día del mes', 'cartera cerró el último día con todas sus cuentas'),
    check('RESERVA_MEDIDA', 'Reserva IFRS 9 medida a la fecha del cierre', '72 créditos con saldo, todos con su reserva medida'),
    check('POLIZAS_CUADRAN', 'Pólizas del mes cuadradas', 'todas las pólizas cuadradas'),
    check('CAPITAL_1201', 'Capital: cartera contra el mayor 1201', '72 créditos; cartera = mayor'),
    check('POR_COBRAR_1203', 'Intereses, comisiones e IVA por cobrar: cartera contra el mayor 1203', '72 créditos; cartera = mayor'),
    check('RESERVA_1290', 'Estimación preventiva: reservas medidas contra el mayor 1290', 'reservas = mayor'),
    check('DIFERIDAS_2150', 'Comisiones de apertura por devengar: calendarios contra el mayor 2150', 'calendarios = mayor'),
    check('COSTOS_1205', 'Costos de originación por amortizar: calendarios contra el mayor 1205', 'calendarios = mayor'),
    check('DEVENGO_COMISIONES', 'Devengo del mes de comisiones y costos de originación (tasa efectiva)',
      closed ? 'todas las comisiones devengadas hasta el mes' : 'al cerrar se devengan las del mes', closed),
    check('CUENTAS_DE_ORDEN', 'Cuentas de orden en pares', 'cuadran entre sí'),
    check('SIN_INCORPORACIONES', 'Sin incorporaciones contra capital (3901)', 'ningún crédito incorporado'),
    check('CENTAVOS', 'Asientos en centavos', 'todos los asientos del mes en centavos'),
    check('EXTEMPORANEAS', 'Pólizas extemporáneas recibidas en el mes', 'ninguna', false),
    check('BANCOS_1101', 'Bancos 1101 contra el estado de cuenta bancario',
      'la conciliación bancaria espera el registro del fondeo y el estado de cuenta de STP', false, false),
  ];
  return {
    period, status: closed ? 'CLOSED' : 'OPEN', outcome: 'RECONCILED',
    message: `El período ${period} concilia: ${checks.length} comprobaciones en orden.`,
    runAt: new Date().toISOString(), closedAt: closed ? new Date().toISOString() : null, preview: !closed, checks,
  };
}
