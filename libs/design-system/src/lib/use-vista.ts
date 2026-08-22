import { useEffect, useState } from 'react';

/**
 * La pantalla abierta dentro de un módulo, gobernada por la ruta pero también por sus pestañas.
 *
 * El shell manda `vista` desde la ruta (`/contabilidad/balanza` → `balanza`) y el módulo la usa
 * para abrir donde toca. Las pestañas de dentro siguen funcionando: cambiarlas es estado local y no
 * navega, que es lo correcto para moverse entre cuatro cortes del mismo período sin ensuciar el
 * historial del navegador con cada vistazo.
 *
 * El valor que llega se **valida** contra la lista del módulo en vez de confiar en él: la ruta la
 * escribe una persona en `nav.ts` y una errata ahí dejaría el módulo con una vista que no existe —
 * es decir, con la pantalla en blanco y sin error que lo diga.
 */
export function useVista<T extends string>(
  propuesta: string | undefined,
  validas: readonly T[],
  porDefecto: T,
): [T, (v: T) => void] {
  const normaliza = (v: string | undefined): T =>
    (validas as readonly string[]).includes(v ?? '') ? (v as T) : porDefecto;

  const [vista, setVista] = useState<T>(() => normaliza(propuesta));

  // Navegar de una pantalla del módulo a otra no lo remonta —el shell lo mantiene vivo a
  // propósito—, así que el cambio de ruta hay que recogerlo aquí.
  useEffect(() => { setVista(normaliza(propuesta)); }, [propuesta]);

  return [vista, setVista];
}
