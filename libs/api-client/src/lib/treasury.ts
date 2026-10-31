import type { Page } from '@bo/shared-types';
import { isMock } from './config.js';
import { request } from './http.js';
import { accountingApi, type Voucher } from './accounting.js';

/**
 * Bancos y tesorería: por dónde sale el dinero y qué pasó con cada SPEI.
 *
 * <p>Contabilidad dice que se dispusieron $45,000 —cargo a cartera, abono a bancos—; esto dice si
 * esos $45,000 **de verdad salieron**, por qué cuenta, con qué clave de rastreo, y si el banco ya
 * lo reporta. Son preguntas distintas y viven en servicios distintos (banking, disbursement, stp):
 * el BFF las junta en `/treasury/**` para que contestar «¿ya le llegó?» no exija abrir cinco.
 *
 * <p>Tres reglas que la pantalla no deja confundir:
 *
 * <p>**Aceptada no es liquidada.** STP acepta la orden en segundos; que el banco receptor la abone
 * es otro hecho, y sólo `SETTLED` lo afirma. Pintar `ACCEPTED` como «depositado» es exactamente
 * la respuesta equivocada que llega por teléfono.
 *
 * <p>**La CLABE viaja enmascarada.** Es dato de alguien que muchas veces ni siquiera es cliente de
 * la casa —la beneficiaria de una distribuidora—, y la consola no debe poder recomponerla.
 *
 * <p>**Cada bloque del detalle puede faltar.** La orden de STP, la traza del dinero o el recorrido
 * vienen de servicios distintos; si uno no contesta, el resto se sigue leyendo.
 */

/* ============================ Cuentas y rutas ============================ */

/**
 * `SUSPENDED` saca una cuenta del ruteo **sin borrar su historia**: con una cuenta por la que ya
 * salió dinero quedan meses de movimientos por conciliar.
 */
export type BankAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface BankAccount {
  bankAccountId: string;
  bankName: string;
  bankCode: string | null;
  clabeMasked: string | null;
  holderName: string | null;
  /** La cuenta del mayor que la refleja. Es el puente entre tesorería y contabilidad. */
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
  status: BankAccountStatus | string;
  /** Quién ejecuta los pagos que salen por aquí. Nulo en una cuenta que sólo recibe. */
  provider: string | null;
}

/** SPEI interbancario, CoDi de Banxico o un movimiento dentro de la plataforma. */
export type PayoutRail = 'SPEI' | 'CODI' | 'INTERNAL';

/** Qué vía y qué proveedor toma un pago según su monto. La de menor prioridad gana. */
export interface PayoutRoute {
  routeId: string;
  rail: PayoutRail | string;
  provider: string;
  minAmount: number | null;
  /** Nulo es sin tope. */
  maxAmount: number | null;
  priority: number;
  active: boolean;
}

/* ============================ Dispersiones ============================ */

/**
 * <pre>
 *   REQUESTED → DISPATCHED → ACCEPTED → SETTLED     (éxito: el banco receptor abonó)
 *                    │            └────→ RETURNED    (el banco receptor lo devolvió)
 *                    └─────────────────→ REJECTED    (el proveedor no aceptó la orden)
 *   REQUESTED → FAILED · CANCELLED
 * </pre>
 */
export type DisbursementStatus =
  | 'REQUESTED' | 'DISPATCHED' | 'ACCEPTED' | 'SETTLED'
  | 'REJECTED' | 'RETURNED' | 'FAILED' | 'CANCELLED';

export interface Disbursement {
  disbursementId: string;
  createdAt: string;
  amount: number;
  currency: string;
  rail: PayoutRail | string;
  provider: string | null;
  status: DisbursementStatus | string;
  /** La asigna el proveedor al despachar. Antes de eso no existe, y no se inventa. */
  trackingKey: string | null;
  beneficiaryName: string | null;
  beneficiaryClabeMasked: string | null;
  creditAccountId: string | null;
  dispositionId: string | null;
  settledAt: string | null;
  /** El comprobante electrónico de pago de Banxico. Sólo existe una vez liquidada. */
  cepUrl: string | null;
}

/** Un salto de estado de la dispersión, con lo que dijo quien lo provocó. */
export interface DisbursementEvent {
  status: DisbursementStatus | string;
  occurredAt: string | null;
  detail: string | null;
}

/** La orden tal como la ve STP: es lo que se cita al reclamarle un pago. */
export interface StpOrder {
  stpOrderId: string;
  trackingKey: string | null;
  orderingClabeMasked: string | null;
  orderingName: string | null;
  beneficiaryName: string | null;
  beneficiaryClabeMasked: string | null;
  amount: number;
  status: string;
  cepUrl: string | null;
  settledAt: string | null;
}

export interface MovementTraceStep {
  step: string;
  status: string | null;
  occurredAt: string | null;
  reference: string | null;
}

/**
 * La cadena del dinero: origen → cuenta ordenante → clave de rastreo → estado de cuenta → póliza.
 *
 * `missingLink` es lo que la hace útil: saber que está incompleta no ayuda; saber que le falta
 * `SIN_CONCILIAR` dice exactamente a quién preguntarle.
 */
export interface MovementTrace {
  complete: boolean;
  missingLink: string | null;
  steps: MovementTraceStep[];
}

export interface DisbursementDetail {
  disbursement: Disbursement;
  timeline: DisbursementEvent[] | null;
  stpOrder: StpOrder | null;
  movementTrace: MovementTrace | null;
}

export interface DisbursementsQuery {
  creditAccountId?: string;
  /** Beneficiario o clave de rastreo: lo que se tiene a la mano cuando alguien llama. */
  q?: string;
  page?: number;
  size?: number;
}

/* ============================ Cliente ============================ */

export const treasuryApi = {
  async bankAccounts(): Promise<BankAccount[]> {
    if (!isMock()) return request<BankAccount[]>('/treasury/bank-accounts');
    return MOCK_BANK_ACCOUNTS;
  },

  async payoutRoutes(): Promise<PayoutRoute[]> {
    if (!isMock()) return request<PayoutRoute[]>('/treasury/payout-routes');
    return MOCK_ROUTES;
  },

  async disbursements(query: DisbursementsQuery = {}): Promise<Page<Disbursement>> {
    if (!isMock()) {
      return request<Page<Disbursement>>('/treasury/disbursements', {
        query: {
          creditAccountId: query.creditAccountId,
          q: query.q?.trim() || undefined,
          page: query.page ?? 0,
          size: query.size ?? 20,
        },
      });
    }
    const size = query.size ?? 20;
    const page = query.page ?? 0;
    const q = normaliza(query.q ?? '');
    const all = (await mockDetails())
      .map((d) => d.disbursement)
      .filter((d) => (query.creditAccountId ? d.creditAccountId === query.creditAccountId : true))
      .filter((d) => !q
        || normaliza(d.beneficiaryName ?? '').includes(q)
        || normaliza(d.trackingKey ?? '').includes(q));
    return {
      content: all.slice(page * size, page * size + size),
      page,
      size,
      totalElements: all.length,
      totalPages: Math.max(1, Math.ceil(all.length / size)),
    };
  },

  async disbursement(disbursementId: string): Promise<DisbursementDetail> {
    if (!isMock()) {
      return request<DisbursementDetail>(`/treasury/disbursements/${encodeURIComponent(disbursementId)}`);
    }
    const found = (await mockDetails()).find((d) => d.disbursement.disbursementId === disbursementId);
    if (!found) throw new Error('Dispersión no encontrada');
    return found;
  },
};

/** Sin acentos ni mayúsculas: «ibarra» tiene que encontrar a «IBARRA» y «Rosa Elena» a «Rosa Elena». */
function normaliza(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/* ============================================================================
 * Dataset mock
 *
 * Las dispersiones liquidadas **se derivan** de las pólizas de egreso del dataset contable, no se
 * escriben aparte: cada SPEI que sale aquí es una póliza que abona a 1101 allá, con el mismo monto
 * y la misma fecha, y su traza cierra en esa póliza. Con dos listas escritas a mano, tesorería y
 * contabilidad acabarían contando dineros distintos, que es justo lo que esta pantalla existe para
 * detectar.
 * ========================================================================== */

const TITULAR = 'Kredius Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.';

const MOCK_BANK_ACCOUNTS: BankAccount[] = [
  {
    bankAccountId: 'ba-stp-01', bankName: 'STP', bankCode: '90646',
    clabeMasked: '646180••••••••2049', holderName: TITULAR,
    ledgerAccountCode: '1101', ledgerAccountName: 'Bancos / SPEI',
    status: 'ACTIVE', provider: 'STP',
  },
  // Concentradora de cobranza: recibe los pagos referenciados y no dispersa. Va a la misma 1101
  // porque es el mismo dinero de la institución; lo que la distingue es que no tiene proveedor.
  {
    bankAccountId: 'ba-bnt-01', bankName: 'Banorte', bankCode: '40072',
    clabeMasked: '072180••••••••6613', holderName: TITULAR,
    ledgerAccountCode: '1101', ledgerAccountName: 'Bancos / SPEI',
    status: 'ACTIVE', provider: null,
  },
  // Suspendida y no cerrada: por ella salieron pagos que todavía se concilian.
  {
    bankAccountId: 'ba-stp-00', bankName: 'STP', bankCode: '90646',
    clabeMasked: '646180••••••••0187', holderName: TITULAR,
    ledgerAccountCode: '1101', ledgerAccountName: 'Bancos / SPEI',
    status: 'SUSPENDED', provider: 'STP',
  },
];

const MOCK_ROUTES: PayoutRoute[] = [
  { routeId: 'rt-spei', rail: 'SPEI', provider: 'STP', minAmount: 0.01, maxAmount: null, priority: 1, active: true },
  // CoDi tiene tope por operación; se deja apagada para que se vea que existir no es rutear.
  { routeId: 'rt-codi', rail: 'CODI', provider: 'STP', minAmount: 0.01, maxAmount: 8000, priority: 2, active: false },
];

/** Bancos receptores para las CLABE de muestra: los prefijos son los reales de cada uno. */
const BANCOS = ['012', '014', '021', '072', '127', '137', '044'];

function clabeDe(semilla: string): string {
  let h = 0;
  for (const c of semilla) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${BANCOS[h % BANCOS.length]}180••••••••${String(h % 10000).padStart(4, '0')}`;
}

function masSegundos(iso: string, s: number): string {
  return new Date(new Date(iso).getTime() + s * 1000).toISOString();
}

/** `KRD` + fecha + consecutivo: el formato que asigna el conector, sin espacios ni guiones. */
function claveDe(iso: string, n: number): string {
  return `KRD${iso.slice(0, 10).replace(/-/g, '')}${String(n).padStart(7, '0')}`;
}

/** La serie de la póliza tal como se cita: tipo, sucursal y folio. */
function folioDe(v: Voucher): string {
  return `${v.voucherType.charAt(0)}-${(v.orgUnitCode ?? 'S/S').replace(/^S_/, '')}-${String(v.folio).padStart(4, '0')}`;
}

/** Antes de esta fecha los SPEI salían por la ventanilla del banco: no hay orden de STP ni traza. */
const INICIO_STP = '2026-05-01';

function liquidada(v: Voucher, n: number): DisbursementDetail {
  // La póliza dice a quién le llegó cuando no es al propio acreditado («SPEI a …»); si no lo dice,
  // fue a su CLABE.
  const beneficiario = /SPEI a (.+)$/.exec(v.concept)?.[1] ?? v.obligorName ?? 'Acreditado';
  const pedida = v.voucherDate;
  const enviada = masSegundos(pedida, 4);
  const aceptada = masSegundos(pedida, 9);
  const abonada = masSegundos(pedida, 71);
  const clave = claveDe(pedida, n);
  const clabe = clabeDe(beneficiario);
  const conStp = pedida >= INICIO_STP;
  const cep = conStp ? `https://www.banxico.org.mx/cep/?clave=${clave}` : null;

  const disbursement: Disbursement = {
    disbursementId: `dsp-${v.voucherId}`,
    createdAt: pedida,
    amount: v.totalDebit,
    currency: 'MXN',
    rail: 'SPEI',
    provider: conStp ? 'STP' : null,
    status: 'SETTLED',
    trackingKey: conStp ? clave : null,
    beneficiaryName: beneficiario,
    beneficiaryClabeMasked: clabe,
    creditAccountId: v.creditAccountId,
    dispositionId: `disp-${v.voucherId}`,
    settledAt: abonada,
    cepUrl: cep,
  };

  if (!conStp) {
    // Lo que había antes de la integración: el pago y su recorrido, sin orden ni traza que leer.
    return {
      disbursement,
      timeline: [
        { status: 'REQUESTED', occurredAt: pedida, detail: 'Disposición por SPEI desde la cuenta del crédito' },
        { status: 'SETTLED', occurredAt: abonada, detail: 'Conciliado a mano contra el estado de cuenta' },
      ],
      stpOrder: null,
      movementTrace: null,
    };
  }

  return {
    disbursement,
    timeline: [
      { status: 'REQUESTED', occurredAt: pedida, detail: `Disposición ${v.contractNumber ?? ''}`.trim() },
      { status: 'DISPATCHED', occurredAt: enviada, detail: `Orden registrada en STP · clave ${clave}` },
      { status: 'ACCEPTED', occurredAt: aceptada, detail: 'STP aceptó la orden' },
      { status: 'SETTLED', occurredAt: abonada, detail: 'El banco receptor abonó la cuenta' },
    ],
    stpOrder: {
      stpOrderId: `stp-${String(70000 + n)}`,
      trackingKey: clave,
      orderingClabeMasked: MOCK_BANK_ACCOUNTS[0].clabeMasked,
      orderingName: TITULAR,
      beneficiaryName: beneficiario,
      beneficiaryClabeMasked: clabe,
      amount: v.totalDebit,
      status: 'SETTLED',
      cepUrl: cep,
      settledAt: abonada,
    },
    movementTrace: {
      complete: true,
      missingLink: null,
      steps: [
        { step: 'REQUESTED', status: 'DONE', occurredAt: pedida, reference: v.contractNumber },
        { step: 'ROUTED', status: 'DONE', occurredAt: enviada, reference: `STP · ${MOCK_BANK_ACCOUNTS[0].clabeMasked}` },
        { step: 'DISPATCHED', status: 'DONE', occurredAt: enviada, reference: clave },
        { step: 'RECONCILED', status: 'DONE', occurredAt: masSegundos(abonada, 3600), reference: 'Estado de cuenta STP' },
        { step: 'POSTED', status: 'DONE', occurredAt: v.voucherDate, reference: `Póliza ${folioDe(v)}` },
      ],
    },
  };
}

/**
 * Un SPEI todavía en vuelo: STP lo aceptó y el banco receptor no lo ha abonado.
 *
 * No tiene póliza, y es correcto: la traza la asienta al final, cuando el banco ya lo reporta. Es
 * el caso que hace falta ver en la pantalla —«aceptada» no es «depositada»— y el que mueve la cifra
 * de pendientes de liquidar.
 */
function enVuelo(): DisbursementDetail {
  const pedida = '2026-08-13T17:42:00Z';
  const enviada = masSegundos(pedida, 5);
  const aceptada = masSegundos(pedida, 11);
  const clave = claveDe(pedida, 9);
  const beneficiario = 'Martín Ochoa Leyva';
  const clabe = clabeDe(beneficiario);
  return {
    disbursement: {
      disbursementId: 'dsp-envuelo-01',
      createdAt: pedida,
      amount: 12000,
      currency: 'MXN',
      rail: 'SPEI',
      provider: 'STP',
      status: 'ACCEPTED',
      trackingKey: clave,
      beneficiaryName: beneficiario,
      beneficiaryClabeMasked: clabe,
      creditAccountId: 'ca-0244',
      dispositionId: 'disp-envuelo-01',
      settledAt: null,
      cepUrl: null,
    },
    timeline: [
      { status: 'REQUESTED', occurredAt: pedida, detail: 'Disposición CTR-202607-0244' },
      { status: 'DISPATCHED', occurredAt: enviada, detail: `Orden registrada en STP · clave ${clave}` },
      { status: 'ACCEPTED', occurredAt: aceptada, detail: 'STP aceptó la orden; falta que el banco receptor abone' },
    ],
    stpOrder: {
      stpOrderId: 'stp-70009',
      trackingKey: clave,
      orderingClabeMasked: MOCK_BANK_ACCOUNTS[0].clabeMasked,
      orderingName: TITULAR,
      beneficiaryName: beneficiario,
      beneficiaryClabeMasked: clabe,
      amount: 12000,
      status: 'ACCEPTED',
      cepUrl: null,
      settledAt: null,
    },
    movementTrace: {
      complete: false,
      missingLink: 'SIN_CONCILIAR',
      steps: [
        { step: 'REQUESTED', status: 'DONE', occurredAt: pedida, reference: 'CTR-202607-0244' },
        { step: 'ROUTED', status: 'DONE', occurredAt: enviada, reference: `STP · ${MOCK_BANK_ACCOUNTS[0].clabeMasked}` },
        { step: 'DISPATCHED', status: 'DONE', occurredAt: enviada, reference: clave },
        { step: 'RECONCILED', status: 'PENDING', occurredAt: null, reference: null },
        { step: 'POSTED', status: 'PENDING', occurredAt: null, reference: null },
      ],
    },
  };
}

let cache: Promise<DisbursementDetail[]> | null = null;

/** Se arma una vez, sobre las pólizas del dataset contable; lo más reciente primero. */
function mockDetails(): Promise<DisbursementDetail[]> {
  cache ??= accountingApi.vouchers({ type: 'EGRESO', size: 500 }).then((p) => {
    const egresos = p.content
      .filter((v) => v.triggerEvent.startsWith('DISPOSITION_') && v.status === 'POSTED')
      .sort((a, b) => a.voucherDate.localeCompare(b.voucherDate));
    return [...egresos.map((v, i) => liquidada(v, i + 1)), enVuelo()]
      .sort((a, b) => b.disbursement.createdAt.localeCompare(a.disbursement.createdAt));
  });
  return cache;
}
