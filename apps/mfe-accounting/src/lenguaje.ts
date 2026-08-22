import type {
  AccountNature, InvoiceStatus, PeriodStatus, VoucherType,
} from '@bo/api-client';
import type { Tone } from '@bo/design-system';

/**
 * El vocabulario contable en español, en un solo sitio.
 *
 * El backend habla en códigos de evento (`CHARGE_ORDINARY_INTEREST`) porque es lo correcto para una
 * regla de posteo configurable. La pantalla no puede hablar así: quien concilia una sucursal busca
 * «devengo de interés», y un código en mayúsculas y guiones bajos lo obliga a traducir mentalmente
 * cada renglón de una tabla de cien.
 *
 * Cuando llega un evento que no está en el mapa se muestra el código tal cual en vez de un genérico
 * tipo «Otro»: una regla de posteo nueva que nadie tradujo se tiene que notar, no confundirse con
 * un movimiento sin clasificar.
 */

export const TIPO_POLIZA: Record<VoucherType, string> = {
  DIARIO: 'Diario',
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
};

/** Ingreso entra a caja, egreso sale; el diario es todo lo demás y es la mayoría. */
export function tonoTipo(t: VoucherType): Tone {
  switch (t) {
    case 'INGRESO': return 'ok';
    case 'EGRESO': return 'warn';
    default: return 'muted';
  }
}

/**
 * Qué hecho económico produjo la póliza.
 *
 * El orden de esta lista no es alfabético: es el del ciclo de vida del préstamo, de la autorización
 * a la recuperación. Se lee de arriba abajo como se lee un crédito.
 */
export const HECHO: Record<string, string> = {
  ACCOUNT_ACTIVATED: 'Alta del préstamo',
  DISPOSITION_AT_ORIGINATION: 'Disposición al activar',
  DISPOSITION_SELF_USE: 'Disposición a wallet',
  DISPOSITION_THIRD_PARTY_CREDIT: 'Disposición por SPEI',
  DISPOSITION_PAYROLL: 'Disposición de nómina',
  CHARGE_OPENING_FEE: 'Comisión de apertura',
  CHARGE_ADMIN_FEE: 'Comisión de administración',
  CHARGE_PREPAYMENT_FEE: 'Comisión por prepago',
  CHARGE_INSURANCE_PREMIUM: 'Prima de seguro',
  CHARGE_IVA: 'IVA trasladado',
  CHARGE_ORDINARY_INTEREST: 'Devengo de interés',
  CHARGE_MORATORIUM_INTEREST: 'Devengo moratorio',
  CHARGE_REVERSED: 'Reversa de cargo',
  CHARGE_WAIVED: 'Condonación',
  PAYMENT_APPLIED: 'Pago recibido',
  PAYMENT_RETURNED: 'Devolución de pago',
  PROVISION_EPR: 'Estimación preventiva',
  OPENING_BALANCE: 'Incorporación de saldo previo',
  WRITE_OFF: 'Quebranto',
  // El otro lado del quebranto: el activo sale del balance y lo castigado se sigue en cuentas de
  // orden. Sin esta entrada la pantalla enseñaba el identificador crudo del evento junto a hechos
  // con nombre en español, que es lo que hace pensar que la pantalla está a medio hacer.
  WRITE_OFF_CONTROL: 'Cartera castigada en cuentas de orden',
  AGREEMENT_QUITA_PARCIAL: 'Quita parcial',
  RECOVERY_PAYMENT: 'Recuperación de cartera castigada',
  WALLET_WITHDRAWAL: 'Retiro de wallet',
  // Comisiones del canal: lo que la institución le debe al distribuidor o promotor por colocar.
  // Es gasto propio, no un cargo al acreditado, y por eso no aparece en su factura.
  COMMISSION_ACCRUED: 'Comisión devengada al canal',
  COMMISSION_LIQUIDATED: 'Comisión liquidada al canal',
  COMMISSION_REVERSED: 'Reversa de comisión al canal',
};

export function hechoLabel(trigger: string): string {
  return HECHO[trigger] ?? trigger;
}

/** Los conceptos que viajan en las líneas de un CFDI. */
export const CONCEPTO: Record<string, string> = {
  ORDINARY_INTEREST: 'Interés ordinario',
  MORATORIUM_INTEREST: 'Interés moratorio',
  OPENING_FEE: 'Comisión de apertura',
  ADMIN_FEE: 'Comisión de administración',
  PREPAYMENT_FEE: 'Comisión por prepago',
  INSURANCE_PREMIUM: 'Prima de seguro',
  IVA: 'IVA trasladado',
};

export function conceptoLabel(c: string): string {
  return CONCEPTO[c] ?? c;
}

export const ESTADO_FACTURA: Record<InvoiceStatus, string> = {
  DRAFT: 'Sin timbrar',
  STAMPED: 'Timbrada',
  CANCELLED: 'Cancelada',
};

export function tonoFactura(s: InvoiceStatus): Tone {
  switch (s) {
    case 'STAMPED': return 'ok';
    case 'CANCELLED': return 'bad';
    default: return 'warn';
  }
}

export const ESTADO_PERIODO: Record<PeriodStatus, string> = {
  OPEN: 'Abierto',
  CLOSED: 'Cerrado',
};

export const NATURALEZA: Record<AccountNature, string> = {
  ASSET: 'Activo',
  CONTRA_ASSET: 'Activo (contra)',
  LIABILITY: 'Pasivo',
  INCOME: 'Ingreso',
  EXPENSE: 'Gasto',
  EQUITY: 'Capital',
  ORDER: 'Orden',
};

/**
 * `202608` → `agosto 2026`.
 *
 * El período viaja como `YYYYMM` porque es lo que ordena y lo que agrupa. Mostrarlo así obliga a
 * descifrar seis dígitos en cada encabezado, y el mes es justo el dato que se compara entre dos
 * pantallas.
 */
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function periodoLabel(period: string): string {
  if (!/^\d{6}$/.test(period)) return period;
  const mes = Number(period.slice(4, 6));
  if (mes < 1 || mes > 12) return period;
  return `${MESES[mes - 1]} ${period.slice(0, 4)}`;
}

/**
 * El folio con la serie a la que pertenece: `D-LEO-0072`.
 *
 * El consecutivo es por (tipo, sucursal, período), que es lo correcto —la serie de una sucursal no
 * tiene huecos causados por otra— y hace que en una lista que mezcla sucursales aparezcan dos
 * «D-0072» seguidos que parecen duplicados. No lo son: son el 72 de León y el 72 de otra serie.
 * Enseñar la serie es lo que los distingue, y es además cómo se cita un folio ante un auditor.
 */
export function folioCompleto(tipo: VoucherType, folio: number, orgUnitCode: string | null): string {
  const serie = orgUnitCode ? orgUnitCode.replace(/^S_/, '') : 'S/S';
  return `${tipo.charAt(0)}-${serie}-${String(folio).padStart(4, '0')}`;
}

/** «1 crédito» / «2 créditos». Un «1 créditos» en una pantalla contable se lee como descuido. */
export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * El saldo con el signo que espera un contador.
 *
 * `balance` viene siempre como cargos − abonos, que es correcto y se lee al revés en la mitad del
 * catálogo: la estimación preventiva y todo el pasivo e ingreso tienen naturaleza acreedora, así que
 * un saldo sano les sale negativo. Aquí se invierte para presentar, sin tocar el dato.
 */
export function saldoPresentado(balance: number, nature: AccountNature): number {
  const acreedora = nature === 'LIABILITY' || nature === 'INCOME'
    || nature === 'EQUITY' || nature === 'CONTRA_ASSET';
  return acreedora ? -balance : balance;
}

/**
 * Cómo se nombra la atribución comercial de un crédito: la plaza arriba, quién responde abajo.
 *
 * <p>Lo que un préstamo sella es la unidad del **ejecutivo**, cuyo nombre es el de una persona.
 * Mostrado bajo el encabezado «Sucursal» daba «Néstor Fuentes Escobar»: no es un dato equivocado,
 * es el de otro nivel del árbol, y leerlo como plaza hace parecer que hay tantas sucursales como
 * ejecutivos. La sucursal identifica el lugar; el responsable, a quién preguntarle.
 *
 * <p>Una sucursal sin responsable se dice explícitamente. Dejar el renglón vacío se lee como un
 * dato que no cargó, y una plaza vacante —entre una baja y la siguiente alta— es un caso real que
 * conviene ver.
 */
export function sucursalLabel(nombre: string | null | undefined): string {
  return nombre ?? 'Sin sucursal';
}

export function responsableLabel(nombre: string | null | undefined): string {
  return nombre ?? 'Sin responsable';
}
