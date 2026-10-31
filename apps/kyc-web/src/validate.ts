/**
 * Validaciones de la captura. Son las mismas que aplica el servidor y se repiten aquí sólo para
 * avisar antes: una CLABE con un dígito cambiado es un depósito que rebota días después, y eso se
 * puede atajar mientras ella todavía tiene la tarjeta en la mano.
 */

/** Pesos 3, 7, 1 repetidos sobre los primeros 17 dígitos (Banxico). */
export function clabeCheckDigit(first17: string): number {
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(first17[i]) * weights[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

export function clabeError(raw: string): string | null {
  const clabe = raw.replace(/\s/g, '');
  if (!/^\d{18}$/.test(clabe)) return 'Son 18 dígitos, sin espacios. Viene en tu app del banco o en tu estado de cuenta.';
  if (clabeCheckDigit(clabe.slice(0, 17)) !== Number(clabe[17])) {
    return 'Esta CLABE no es válida: revisa que no falte ni sobre un dígito.';
  }
  return null;
}

const CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/;
// Persona física: 4 letras, fecha y homoclave de 3.
const RFC = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;

export function curpError(v: string): string | null {
  return CURP.test(v.trim().toUpperCase()) ? null : 'La CURP tiene 18 caracteres: 4 letras, 6 números, H o M, y 7 más.';
}

export function rfcError(v: string): string | null {
  return RFC.test(v.trim().toUpperCase()) ? null : 'El RFC tiene 13 caracteres, con homoclave.';
}

export function postalCodeError(v: string): string | null {
  return /^\d{5}$/.test(v.trim()) ? null : 'Son 5 números.';
}

/** «$14,000», «14000» y «14 000» son lo mismo para quien lo escribe. */
export function parseIncome(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dateOfBirthError(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Elige tu fecha de nacimiento.';
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'Elige tu fecha de nacimiento.';
  const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age >= 18 ? null : 'Tienes que ser mayor de edad para recibir el crédito.';
}
