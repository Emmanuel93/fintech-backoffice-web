import { expect, type Locator, type Page } from '@playwright/test';

/**
 * La misma matriz de permisos que declaran `apps/shell/src/nav.ts` (qué se ve) y el
 * `SecurityConfig` del BFF (qué se puede llamar), escrita una tercera vez a propósito.
 *
 * Si se importara de `nav.ts`, la prueba y el código bajo prueba compartirían el error: cambiar
 * la lista haría que la prueba cambiara con ella y siguiera en verde. Declararla aquí obliga a
 * que un cambio de permisos se haga en dos sitios conscientemente.
 */
export interface RoleFixture {
  key: string;
  email: string;
  password: string;
  displayName: string;
  /** Módulos del menú "Operación" que este rol debe ver. */
  visibleModules: string[];
  /** Módulos que NO debe ver — la mitad que de verdad se rompe. */
  hiddenModules: string[];
  /** Rutas que responden con datos. */
  allowedRoutes: string[];
  /** Rutas que el servidor debe negar aunque se pidan a mano. */
  deniedRoutes: string[];
}

const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

// Dashboard es visible para cualquier empleado autenticado; no se repite en cada fila.
export const ROLES: RoleFixture[] = [
  {
    key: 'admin',
    email: 'admin@kredius.mx',
    password: process.env.BO_ADMIN_PASSWORD ?? PASSWORD,
    displayName: 'Administrador',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores', 'Productos'],
    hiddenModules: [],
    allowedRoutes: ['/', '/cartera', '/clientes', '/productos'],
    deniedRoutes: [],
  },
  {
    key: 'ops',
    email: 'ops@kredius.mx',
    password: PASSWORD,
    displayName: 'Supervisor de operación',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores'],
    hiddenModules: ['Productos'],
    allowedRoutes: ['/', '/cartera', '/clientes'],
    deniedRoutes: [],
  },
  {
    key: 'analista',
    email: 'analista@kredius.mx',
    password: PASSWORD,
    displayName: 'Analista de crédito',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores'],
    hiddenModules: ['Productos'],
    allowedRoutes: ['/', '/cartera', '/clientes'],
    deniedRoutes: [],
  },
  {
    key: 'ejecutivo',
    email: 'ejecutivo@kredius.mx',
    password: PASSWORD,
    displayName: 'Ejecutivo de cartera',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores'],
    hiddenModules: ['Productos'],
    allowedRoutes: ['/', '/cartera', '/clientes'],
    deniedRoutes: [],
  },
  {
    key: 'producto',
    email: 'producto@kredius.mx',
    password: PASSWORD,
    displayName: 'Product manager',
    visibleModules: ['Dashboard', 'Productos'],
    hiddenModules: ['Cartera', 'Clientes y distribuidores'],
    allowedRoutes: ['/', '/productos'],
    deniedRoutes: ['/cartera', '/clientes'],
  },
  {
    key: 'soporte',
    email: 'soporte@kredius.mx',
    password: PASSWORD,
    displayName: 'Soporte',
    visibleModules: ['Dashboard', 'Clientes y distribuidores'],
    hiddenModules: ['Cartera', 'Productos'],
    allowedRoutes: ['/', '/clientes'],
    deniedRoutes: ['/cartera'],
  },
  {
    key: 'cobranza',
    email: 'cobranza@kredius.mx',
    password: PASSWORD,
    displayName: 'Gestor de cobranza',
    visibleModules: ['Dashboard'],
    hiddenModules: ['Cartera', 'Clientes y distribuidores', 'Productos'],
    allowedRoutes: ['/'],
    deniedRoutes: ['/cartera', '/clientes'],
  },
  {
    key: 'auditor',
    email: 'auditor@kredius.mx',
    password: PASSWORD,
    displayName: 'Auditor',
    visibleModules: ['Dashboard'],
    hiddenModules: ['Cartera', 'Clientes y distribuidores', 'Productos'],
    allowedRoutes: ['/'],
    deniedRoutes: ['/cartera'],
  },
];

/** Entra por la pantalla de login, como una persona. Nada de inyectar el token en localStorage. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /backoffice de crédito/i })).toBeVisible();

  await page.getByPlaceholder('usuario@kredius.mx').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();

  // El marco de la aplicación es la señal de que la sesión quedó establecida.
  await expect(page.locator('.bo-frame')).toBeVisible({ timeout: 20_000 });
}

export async function logout(page: Page): Promise<void> {
  const salir = page.getByRole('button', { name: 'Salir' });
  if (await salir.isVisible().catch(() => false)) {
    await salir.click();
    await expect(page.locator('.bo-login')).toBeVisible();
  }
  await page.evaluate(() => localStorage.clear());
}

/** Los módulos del menú lateral que este usuario tiene delante. */
export async function visibleNavModules(page: Page): Promise<string[]> {
  const items = page.locator('.bo-sidebar a.bo-nav-item');
  return (await items.allTextContents()).map((t) => t.replace(/^[^\wÁÉÍÓÚÑa-z]+/u, '').trim());
}

// ── Grabación: marcas de la historia y lo que se señala en pantalla ──────────────────────────
//
// Las regresiones también son la materia prima del video de demostración: el orquestador
// (`fintech-services/tools/regresion-e2e`) graba cada spec, lee de su salida en qué segundo empezó
// cada momento y monta encima el panel con el texto de ese momento. Nada de esto afirma algo; es
// para que quien mire el video entienda qué está pasando sin que nadie se lo narre.

/** Cero del reloj de la historia. Vive en el módulo porque cada spec corre un solo test. */
let t0 = Date.now();

/**
 * Pone el reloj de la historia en cero. Va en la **primera** línea del test: el video arranca
 * cuando se abre la página del fixture, un instante antes del cuerpo, y cualquier cosa que corra
 * antes de esta llamada desplazaría todos los subtítulos.
 */
export function iniciaHistoria(): void {
  t0 = Date.now();
}

/**
 * Marca que un momento de la historia **empieza** en pantalla.
 *
 * El orquestador busca `##HISTORIA## <segundos> <clave>` en stdout (`[a-z_]+`, nada más) y casa la
 * clave contra el guion de `video.py`; una clave que no está en el guion se ignora en silencio, así
 * que un error de dedo no rompe nada: deja el subtítulo anterior colgado. Por eso las claves se
 * escriben tal cual las pide el guion y en su orden.
 */
export function historia(clave: string): void {
  console.log(`##HISTORIA## ${((Date.now() - t0) / 1000).toFixed(2)} ${clave}`);
}

const ANILLO = 'data-enfoca-anillo';

/**
 * Lleva el elemento al centro de la pantalla y lo rodea un momento con un anillo.
 *
 * Playwright hace clic al instante y el video no graba cursor: sin esto, quien lo mira ve que la
 * pantalla cambió pero no qué se tocó. El anillo dice «esto» antes de que pase; por eso se llama
 * antes de cada clic o captura que importe para la historia.
 *
 * `mientras`, si se pasa, corre con el anillo todavía puesto —escribir en un campo, por ejemplo—,
 * para que se vea dónde cae lo que se teclea.
 */
export async function enfoca(
  page: Page,
  locator: Locator,
  ms = 1400,
  mientras?: () => Promise<unknown>,
): Promise<void> {
  // El primero espera a que sea visible y lo trae a la vista; el segundo lo centra. Sin centrar,
  // un botón queda pegado al borde inferior y en el video se lee a medias.
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await page.waitForTimeout(400);
  await anilla(page, locator, ms, mientras);
}

/** El anillo de `enfoca`, sin mover la pantalla: para cuando lo que se centra no es lo que se señala. */
async function anilla(
  page: Page,
  locator: Locator,
  ms: number,
  mientras?: () => Promise<unknown>,
): Promise<void> {
  await locator.evaluate((el, attr) => new Promise<void>((listo) => {
    // El desplazamiento suave puede seguir en curso: se espera a que el elemento deje de moverse
    // —tres cuadros quietos— para no pintar el anillo a medio camino. Con tope, por si nunca para.
    let previo = Number.NaN;
    let quietos = 0;
    const tope = setTimeout(listo, 1200);
    const espera = () => {
      const top = el.getBoundingClientRect().top;
      quietos = top === previo ? quietos + 1 : 0;
      previo = top;
      if (quietos >= 3) { clearTimeout(tope); listo(); return; }
      requestAnimationFrame(espera);
    };
    requestAnimationFrame(espera);
  }).then(() => {
    const anillo = document.createElement('div');
    anillo.setAttribute(attr, '');
    anillo.style.cssText = [
      'position:fixed', 'box-sizing:border-box', 'border:4px solid #00B894', 'border-radius:12px',
      'box-shadow:0 0 0 6px rgba(0,184,148,.25)', 'pointer-events:none', 'z-index:2147483647',
      'transition:opacity .3s', 'opacity:0',
    ].join(';');
    document.body.appendChild(anillo);
    // El anillo vive encima de todo, así que nada lo recorta: un bloque más alto que el cuerpo del
    // modal lo dibujaría encima de la cabecera. Se recorta a mano contra los contenedores que de
    // verdad esconden algo —los que desbordan, como `.bo-modal-body`— y al final contra la ventana.
    // Los que no desbordan no cuentan: el lienzo del visor tiene `overflow` y mide lo mismo que la
    // imagen, y recortar contra él pegaría el anillo encima de ella.
    const recortes: Element[] = [];
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const corta = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      const desborda = a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1;
      if (corta && desborda) recortes.push(a);
    }
    // El anillo sigue al elemento en cada cuadro: si la ficha se reacomoda mientras está puesto
    // —una imagen que termina de cargar arriba—, un anillo fijo quedaría señalando el vacío.
    const holgura = 6;
    const sigue = () => {
      if (!anillo.isConnected) return;
      // Si React desmontó el elemento, su rectángulo es 0×0 en la esquina: mejor no señalar nada.
      if (!el.isConnected) { anillo.style.opacity = '0'; return; }
      const r = el.getBoundingClientRect();
      let top = r.top - holgura;
      let left = r.left - holgura;
      let bottom = r.bottom + holgura;
      let right = r.right + holgura;
      for (const a of recortes) {
        const c = a.getBoundingClientRect();
        const cTop = c.top + a.clientTop;
        const cLeft = c.left + a.clientLeft;
        top = Math.max(top, cTop + 2);
        left = Math.max(left, cLeft + 2);
        bottom = Math.min(bottom, cTop + a.clientHeight - 2);
        right = Math.min(right, cLeft + a.clientWidth - 2);
      }
      top = Math.max(2, top);
      left = Math.max(2, left);
      bottom = Math.min(window.innerHeight - 2, bottom);
      right = Math.min(window.innerWidth - 2, right);
      anillo.style.top = `${top}px`;
      anillo.style.left = `${left}px`;
      anillo.style.width = `${Math.max(0, right - left)}px`;
      anillo.style.height = `${Math.max(0, bottom - top)}px`;
      requestAnimationFrame(sigue);
    };
    sigue();
    // Forzar el layout antes de subir la opacidad es lo que hace que la transición se vea.
    void anillo.offsetWidth;
    anillo.style.opacity = '1';
  }), ANILLO);

  try {
    await page.waitForTimeout(ms);
    if (mientras) await mientras();
  } finally {
    // Se quitan todos, no sólo el último: si una acción falló a medias, el siguiente anillo no
    // debe convivir con uno huérfano. El `catch` cubre que la página ya no exista (navegó o se
    // cerró): entonces el anillo se fue con ella.
    await page.evaluate((attr) => new Promise<void>((listo) => {
      const anillos = Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`));
      for (const a of anillos) a.style.opacity = '0';
      setTimeout(() => { for (const a of anillos) a.remove(); listo(); }, 300);
    }), ANILLO).catch(() => undefined);
  }
}

/**
 * Enseña un documento del visor completo, sin recortes, y lo enfoca.
 *
 * El lienzo del visor (`.bo-doc-canvas`) llena el ancho de la ficha y corta a 560 px de alto. A
 * 1280 de ancho una INE se pinta de ~690 px y una selfie vertical de más de 1400: en el video se
 * veía media credencial y la frente de la persona, que es justo lo que no sirve para enseñar que
 * alguien compara una contra la otra. Los botones de zoom no alcanzan —el mínimo es 50 % y la
 * selfie sigue sin caber—, así que aquí se le pone tope de alto a la propia imagen, con su
 * proporción intacta. Sólo cambia cómo se pinta para la grabación: lo que la prueba afirma —que
 * el archivo se abre dentro de la ficha— se afirma antes de llamar esto.
 */
export async function encuadraDocumento(page: Page, archivo: Locator, ms = 1400): Promise<void> {
  // Una imagen que todavía decodifica mide 0 de alto: ajustarla entonces sería ajustarla a nada.
  await expect.poll(
    () => archivo.evaluate((el) => !(el instanceof HTMLImageElement) || (el.complete && el.naturalWidth > 0)),
    { timeout: 15_000, message: 'el documento no terminó de cargar en el visor' },
  ).toBe(true);

  await archivo.evaluate((el) => {
    if (!(el instanceof HTMLImageElement)) return; // un PDF ya se pinta a la medida de su marco
    const lienzo = el.closest<HTMLElement>('.bo-doc-canvas');
    const topeLienzo = lienzo ? Number.parseFloat(getComputedStyle(lienzo).maxHeight) : Number.NaN;
    // Lo que de verdad se ve: el cuerpo del modal si lo hay, si no la ventana. Se deja aire para
    // la barra de zoom y la cabecera del documento, que dicen qué archivo es.
    const marco = el.closest<HTMLElement>('.bo-modal-body');
    const visible = (marco?.clientHeight ?? window.innerHeight) - 120;
    const tope = Math.floor(Math.min(Number.isFinite(topeLienzo) ? topeLienzo : Number.POSITIVE_INFINITY, visible));
    if (el.getBoundingClientRect().height <= tope) return;
    // El ancho se calcula, no se deja en `auto`: en `auto` la imagen se pinta a su tamaño natural,
    // y un archivo chico —o el relleno de 1×1 que sube la app cuando no hay muestra— quedaría
    // como un punto. Con el alto en `auto`, el tope de ancho del lienzo no deforma la proporción.
    const proporcion = el.naturalWidth / el.naturalHeight;
    el.style.width = `${Math.floor(tope * proporcion)}px`;
    el.style.maxWidth = '100%';
    el.style.height = 'auto';
  });

  // Se centra el documento entero —su cabecera dice qué archivo es, «INE — frente»— y se señala
  // sólo la imagen. Centrar la imagen dejaba la cabecera fuera de cuadro.
  await archivo.scrollIntoViewIfNeeded();
  await archivo.evaluate((el) => (el.closest('.bo-doc') ?? el).scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await page.waitForTimeout(400);
  await anilla(page, archivo, ms);
}

/**
 * Señala algo en pantalla con una etiqueta y una flecha, además del anillo de `enfoca`.
 *
 * Es para la demo completa: en una póliza o en una conciliación, el anillo dice «mira aquí» pero no
 * dice qué es lo que se mira. La etiqueta lo dice en el idioma del cliente («Cargo 1201 · Cartera
 * de crédito») mientras la cámara se queda quieta en el dato. Sigue al elemento cuadro a cuadro,
 * igual que el anillo, y se coloca del lado donde haya espacio.
 */
export async function senala(
  page: Page,
  locator: Locator,
  texto: string,
  ms = 2600,
  lado: 'derecha' | 'izquierda' | 'arriba' | 'abajo' | 'auto' = 'auto',
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await page.waitForTimeout(450);
  await Promise.all([
    anilla(page, locator, ms),
    locator.evaluate((el, { texto, ms, lado }) => new Promise<void>((listo) => {
      const caja = document.createElement('div');
      caja.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'pointer-events:none', 'max-width:360px',
        'background:#00B894', 'color:#04241C', 'font:700 17px/1.3 Inter,system-ui,sans-serif',
        'padding:10px 14px', 'border-radius:12px', 'box-shadow:0 10px 30px rgba(0,0,0,.28)',
        'opacity:0', 'transition:opacity .25s',
      ].join(';');
      caja.textContent = texto;
      const flecha = document.createElement('div');
      flecha.style.cssText = 'position:absolute;width:0;height:0;border:10px solid transparent';
      caja.appendChild(flecha);
      document.body.appendChild(caja);
      const coloca = () => {
        if (!caja.isConnected) return;
        if (!el.isConnected) { caja.style.opacity = '0'; return; }
        const r = el.getBoundingClientRect();
        const w = caja.offsetWidth;
        const h = caja.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let donde = lado;
        if (donde === 'auto') {
          donde = vw - r.right > w + 40 ? 'derecha' : r.left > w + 40 ? 'izquierda'
            : r.top > h + 40 ? 'arriba' : 'abajo';
        }
        let x = 0;
        let y = 0;
        flecha.style.border = '10px solid transparent';
        flecha.style.left = flecha.style.right = flecha.style.top = flecha.style.bottom = '';
        if (donde === 'derecha' || donde === 'izquierda') {
          y = Math.min(vh - h - 8, Math.max(8, r.top + r.height / 2 - h / 2));
          x = donde === 'derecha' ? r.right + 22 : r.left - w - 22;
          flecha.style.top = `${Math.min(h - 26, Math.max(6, r.top + r.height / 2 - y - 10))}px`;
          if (donde === 'derecha') { flecha.style.left = '-20px'; flecha.style.borderRightColor = '#00B894'; }
          else { flecha.style.right = '-20px'; flecha.style.borderLeftColor = '#00B894'; }
        } else {
          x = Math.min(vw - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
          y = donde === 'arriba' ? r.top - h - 22 : r.bottom + 22;
          flecha.style.left = `${Math.min(w - 26, Math.max(6, r.left + r.width / 2 - x - 10))}px`;
          if (donde === 'arriba') { flecha.style.bottom = '-20px'; flecha.style.borderTopColor = '#00B894'; }
          else { flecha.style.top = '-20px'; flecha.style.borderBottomColor = '#00B894'; }
        }
        caja.style.left = `${Math.round(x)}px`;
        caja.style.top = `${Math.round(y)}px`;
        caja.style.opacity = '1';
        requestAnimationFrame(coloca);
      };
      requestAnimationFrame(coloca);
      setTimeout(() => {
        caja.style.opacity = '0';
        setTimeout(() => { caja.remove(); listo(); }, 300);
      }, ms);
    }), { texto, ms, lado }),
  ]);
}
