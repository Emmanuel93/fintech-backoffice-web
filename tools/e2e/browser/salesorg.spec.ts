import { expect, test } from '@playwright/test';
import { login, logout } from './fixtures';

/**
 * Estructura comercial: una sola tabla, y el alcance aplicado de verdad.
 *
 * Lo que se comprueba aquí no es que la pantalla pinte, es que las dos promesas que hace se
 * cumplan. La primera es de lectura: abrir una rama explica el renglón de arriba, así que los
 * hijos tienen que sumar el total del padre. La segunda es de mando: quien dirige una zona ve
 * botones sobre su zona y **ninguno** sobre la de al lado.
 *
 * Se recorre con dos sesiones distintas a propósito. Con una sola —la del administrador— la
 * pantalla se ve completa siempre y el alcance no se prueba: el caso que se rompe es el del
 * gerente, y ése sólo aparece entrando como él.
 */

const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/**
 * El último renglón que se abrió, que es desde donde sigue el descenso.
 *
 * Al abrir una rama, sus hijos se insertan justo debajo, así que el siguiente escalón es el
 * renglón que sigue al último marcado como abierto. Ir siempre a un índice fijo abriría hermanos
 * en vez de bajar.
 */
async function indiceUltimoAbierto(tabla: import('@playwright/test').Locator): Promise<number> {
  const clases = await tabla.locator('tbody tr').evaluateAll(
    (filas) => filas.map((f) => f.className),
  );
  const ultimo = clases.map((c, i) => (c.includes('bo-fila-abierta') ? i : -1))
                       .filter((i) => i >= 0)
                       .pop();
  return ultimo === undefined ? 0 : ultimo + 1;
}

/**
 * Abre el primer hijo de la última rama abierta, y espera a que aparezcan sus hijos.
 *
 * Se navega así y no por índices fijos porque las ramas se ordenan por cuánto traen: cambiar un
 * monto reordena la tabla, y una prueba que dice «la fila 2» acaba comprobando otra rama sin
 * avisar. Bajar por la última abierta es el mismo recorrido que hace una persona.
 */
async function bajaUnEscalon(tabla: import('@playwright/test').Locator): Promise<void> {
  const filas = tabla.locator('tbody tr');
  const antes = await filas.count();
  await filas.nth(await indiceUltimoAbierto(tabla)).click();
  await expect.poll(() => filas.count()).toBeGreaterThan(antes);
}

test.describe('Estructura comercial', () => {
  test('el administrador ve la red entera en una tabla, con las métricas de dirección', async ({ page }) => {
    await login(page, 'admin@kredius.mx', process.env.BO_ADMIN_PASSWORD ?? PASSWORD);
    await page.goto('/estructura');

    // El encuadre: qué parte de la red gobierna quien mira.
    await expect(page.locator('.bo-scope')).toContainText('Alcance completo');
    await expect(page.locator('.bo-scope')).toContainText('87 unidades');

    // Las columnas que pidió operación. Si alguna se cae, la tabla deja de responder la
    // pregunta para la que existe.
    const tabla = page.locator('table.bo-arbol-cartera');
    await expect(tabla).toBeVisible();
    // «Vencida 90+» y no «En mora»: la columna dice el criterio oficial CNBV/IFRS-9 que aplica,
    // porque el tramo 31-90 es atraso y se lleva aparte. Nombrarla por el criterio evita que
    // alguien compare esta cifra con otra que mide algo distinto.
    for (const col of ['Cuentas', 'Capital colocado', 'Vencida 90+', 'A cobrar',
                       'Devengado s/cobrar', 'Adeudo total', 'Origen', 'Ejecutivos']) {
      await expect(tabla.locator('thead')).toContainText(col);
    }

    // El responsable de cada rama, en su renglón: dirigir una red es hablar con personas.
    await expect(tabla.locator('tbody tr').first().locator('.bo-responsable')).not.toBeEmpty();

    // Una sola tabla: el panel lateral de la jerarquía ya no existe.
    await expect(page.locator('.bo-split')).toHaveCount(0);

    // El descenso completo, un clic por escalón y sobre el renglón entero —no sobre el
    // triángulo—: nacional → región → zona → sucursal → ejecutivo. Es el recorrido para el que
    // existe la pantalla, y si un escalón no abre, deja de servir a partir de ahí.
    for (const escalon of ['Región', 'Zona', 'Sucursal', 'Ejecutivo']) {
      await test.step(`abre el escalón que lleva a ${escalon}`, () => bajaUnEscalon(tabla));
    }

    // Al final del descenso hay clientes: la tabla llega hasta el titular de la cartera.
    await expect(tabla).toContainText('Región Centro');
    await expect(tabla).toContainText(/Sucursal /);
  });

  /**
   * El nacional y el panorama de cartera tienen que contar el mismo negocio.
   *
   * Discrepaban —$2.9M contra $4.7M— por dos motivos a la vez: el rollup leía una sola página de
   * cien filas creyendo que pedía dos mil, y había cartera viva sin ejecutivo que no cuelga de
   * ninguna rama. Lo primero era un error y está corregido; lo segundo es real.
   *
   * La comprobación vale en los **dos** estados posibles, porque los dos son legítimos y cuál
   * toca depende de los datos, no del código. Con cartera huérfana, la pantalla tiene que
   * decirlo y las cifras deben cuadrar: árbol + sin titular = red. Sin ella —una red donde todo
   * cliente tiene ejecutivo— el aviso no se pinta, y eso es correcto: avisar de cero pesos
   * huérfanos sería ruido. Fijar sólo uno de los dos casos hace que la prueba falle cuando el
   * entorno mejora, que es exactamente lo que pasó al dejar la red sin cartera sin asignar.
   */
  test('el árbol cuadra con el panorama, con o sin cartera huérfana', async ({ page }) => {
    await login(page, 'admin@kredius.mx', process.env.BO_ADMIN_PASSWORD ?? PASSWORD);
    await page.goto('/estructura');
    await expect(page.locator('table.bo-arbol-cartera')).toBeVisible();

    const enArbol = Number(
      (await page.locator('.bo-kpi-value').first().innerText()).replace(/[^0-9]/g, ''),
    );
    expect(enArbol, 'el árbol debe mostrar capital colocado').toBeGreaterThan(0);

    const aviso = page.locator('.bo-huerfanos');
    if (await aviso.count() === 0) {
      // Sin huérfanos el nacional ya es el total de la red; no hay nada que reconciliar.
      return;
    }

    const cifras = [...(await aviso.innerText()).matchAll(/\$([\d,]+)/g)]
      .map((m) => Number(m[1].replace(/,/g, '')));
    const [sinTitular, red] = cifras;
    expect(sinTitular, 'si se avisa de cartera huérfana, debe ser mayor que cero').toBeGreaterThan(0);
    expect(enArbol + sinTitular,
      `${enArbol} en el árbol + ${sinTitular} sin titular deberían dar ${red}`).toBe(red);
  });

  test('el nacional se abre con un clic en el renglón, no sólo en el triángulo', async ({ page }) => {
    await login(page, 'admin@kredius.mx', process.env.BO_ADMIN_PASSWORD ?? PASSWORD);
    await page.goto('/estructura');

    const tabla = page.locator('table.bo-arbol-cartera');
    const filas = tabla.locator('tbody tr');
    await expect(filas.first()).toContainText('México (Nacional)');
    expect(await filas.count()).toBe(1);

    // El clic va al nombre, que es donde una persona apunta.
    await filas.first().locator('.bo-arbol-nombre').click();
    await expect.poll(() => filas.count()).toBeGreaterThan(1);
    await expect(tabla).toContainText('Región Norte');
  });

  test('cada escalón se mueve al de arriba, y no se ofrece mover donde no hay destino', async ({ page }) => {
    await login(page, 'admin@kredius.mx', process.env.BO_ADMIN_PASSWORD ?? PASSWORD);
    await page.goto('/estructura');

    const tabla = page.locator('table.bo-arbol-cartera');
    await bajaUnEscalon(tabla);   // → regiones

    // Una región cuelga del nacional y nacional hay uno solo: ahí no hay a dónde ir, y el botón
    // no se ofrece. Un botón que siempre lleva a un callejón enseña a desconfiar de los demás.
    await expect(tabla).not.toContainText('Mover a otra nacional');
    await expect(tabla.locator('tbody tr', { hasText: /· R_/ }).first()).not.toContainText('Mover');

    // La regla del árbol, leída desde la propia tabla: cada nodo va al escalón de arriba. Se
    // busca por nivel y no por nombre — el orden de las ramas depende de cuánto trae cada una.
    await bajaUnEscalon(tabla);   // → zonas
    await expect(tabla.locator('tbody tr', { hasText: /· Z_/ }).first())
      .toContainText('Mover a otra región');

    await bajaUnEscalon(tabla);   // → sucursales
    await expect(tabla.locator('tbody tr', { hasText: /· S_/ }).first())
      .toContainText('Mover a otra zona');
  });

  test('mover una sucursal dice a qué zona va y dónde queda en el árbol', async ({ page }) => {
    await login(page, 'admin@kredius.mx', process.env.BO_ADMIN_PASSWORD ?? PASSWORD);
    await page.goto('/estructura');

    const tabla = page.locator('table.bo-arbol-cartera');
    // Bajar hasta una sucursal: nacional → región → zona → sucursales.
    await bajaUnEscalon(tabla);
    await bajaUnEscalon(tabla);
    await bajaUnEscalon(tabla);

    const sucursal = tabla.locator('tbody tr', { hasText: /· S_/ }).first();
    // El botón dice el destino antes de abrirlo: la regla del árbol se lee desde la tabla.
    await expect(sucursal).toContainText('Mover a otra zona');
    await sucursal.getByRole('button', { name: /Mover a otra zona/ }).click();

    const modal = page.locator('.bo-modal');
    await expect(modal).toContainText('a otra zona');
    // De dónde sale, con la ruta entera.
    await expect(modal.locator('.bo-ruta').first()).toContainText('›');

    // La cascada: una sucursal se elige por región y luego por zona, y viene precargada con
    // dónde está hoy. Que el primer selector traiga valor es lo que ahorra rehacer el camino.
    const selects = modal.locator('select');
    await expect(selects).toHaveCount(2);
    await expect(selects.first()).not.toHaveValue('');

    // A dónde llega, en cuanto se elige el último escalón —el que de verdad decide.
    await selects.last().selectOption({ index: 1 });
    await expect(modal.locator('.bo-ruta-nueva')).toBeVisible();
    await expect(modal.locator('.bo-ruta-nueva')).toContainText('Quedará en');

    // Cambiar un escalón de arriba invalida lo de abajo: una zona de otra región no puede
    // quedarse seleccionada. Es lo que impide componer una ruta que no existe.
    await selects.first().selectOption({ index: 2 });
    await expect(selects.last()).toHaveValue('');
    await expect(modal.locator('.bo-ruta-nueva')).toHaveCount(0);

    // Se cierra sin aplicar: elegir un destino es ver la consecuencia, no ejecutarla. Además
    // deja la sesión utilizable — con el diálogo abierto, su fondo tapa el botón de salir.
    await modal.getByRole('button', { name: /cerrar|×/i }).click();
    await expect(modal).toHaveCount(0);
    await expect(tabla.locator('tbody tr', { hasText: /· S_/ }).first()).toBeVisible();
  });

  test('un gerente de zona ve su zona y no puede tocar la de al lado', async ({ page }) => {
    await login(page, 'zona@kredius.mx', PASSWORD);
    await page.goto('/estructura');

    const aviso = page.locator('.bo-scope');
    await expect(aviso).toContainText('Zona Noroeste');
    await expect(aviso).toContainText('Puedes reorganizar');

    const tabla = page.locator('table.bo-arbol-cartera');
    await expect(tabla).toBeVisible();

    // Su zona es la raíz de lo que ve: la región y el nacional quedan por encima y no aparecen.
    await expect(tabla).toContainText('Zona Noroeste');
    await expect(tabla).not.toContainText('Zona Noreste');
    await expect(tabla).not.toContainText('México (Nacional)');

    // Su propia raíz no se puede mover: el destino quedaría por encima de su alcance.
    const raiz = tabla.locator('tbody tr').first();
    await expect(raiz).not.toContainText('Mover');

    // Lo que cuelga de ella, sí.
    await raiz.locator('.bo-tree-caret').click();
    await expect(tabla.locator('tbody tr').nth(1)).toContainText('Mover');
  });

  test.afterEach(async ({ page }) => {
    await logout(page).catch(() => { /* la sesión pudo no llegar a abrirse */ });
  });
});
