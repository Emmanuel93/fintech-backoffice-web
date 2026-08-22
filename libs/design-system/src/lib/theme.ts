// Selector de tema (claro / oscuro / el del sistema).
//
// La fuente de verdad es el DOM —`data-theme` en <html>— y no una variable de módulo, porque
// con Module Federation cada remote puede cargar su propia copia de esta librería: dos copias,
// dos estados, y el botón dejaría de reflejar lo que se ve. El atributo es uno solo para toda
// la página, así que da igual cuántas instancias existan.
//
// El CSS define los tres estados en styles.ts: `:root` (claro), la media query para quien no ha
// elegido nada, y `:root[data-theme=...]` para cuando sí eligió. Aquí solo se pone el sello.

const STORAGE_KEY = 'bo.theme';
const EVENT = 'bo:themechange';

/** Lo que el usuario eligió. `system` = sin sello, manda el sistema operativo. */
export type ThemeChoice = 'light' | 'dark' | 'system';
/** Lo que finalmente se ve, ya resuelto el caso `system`. */
export type ResolvedTheme = 'light' | 'dark';

function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getThemeChoice(): ThemeChoice {
  const stamped = root()?.dataset.theme;
  return stamped === 'light' || stamped === 'dark' ? stamped : 'system';
}

export function resolveTheme(choice: ThemeChoice = getThemeChoice()): ResolvedTheme {
  if (choice !== 'system') return choice;
  return prefersDark() ? 'dark' : 'light';
}

export function setThemeChoice(choice: ThemeChoice): void {
  const el = root();
  if (!el) return;
  if (choice === 'system') delete el.dataset.theme;
  else el.dataset.theme = choice;

  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Modo privado o storage bloqueado: el tema vive lo que dure la pestaña. No es motivo de error.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: choice }));
}

/**
 * Alterna entre claro y oscuro partiendo de lo que se ve ahora.
 *
 * Deliberadamente no incluye `system` en el ciclo: quien pulsa un botón de tema quiere el otro
 * tema, no un tercer estado que parece no hacer nada cuando coincide con el del sistema.
 * Para volver a `system` está `setThemeChoice('system')`.
 */
export function toggleTheme(): ResolvedTheme {
  const next: ResolvedTheme = resolveTheme() === 'dark' ? 'light' : 'dark';
  setThemeChoice(next);
  return next;
}

/** Restaura la elección guardada. Idempotente: se puede llamar desde cada app sin coordinar. */
export function initTheme(): void {
  const el = root();
  if (!el || el.dataset.theme) return;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') el.dataset.theme = saved;
  } catch {
    // Sin storage se arranca en `system`, que es el default correcto.
  }
}

/** Notifica tanto el cambio manual como el del sistema, para que `system` no se quede congelado. */
export function subscribeTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  window.addEventListener(EVENT, cb);
  mq?.addEventListener?.('change', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    mq?.removeEventListener?.('change', cb);
  };
}
