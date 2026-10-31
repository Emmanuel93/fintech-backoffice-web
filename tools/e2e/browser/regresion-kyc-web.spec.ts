import { test, expect } from '@playwright/test';
import { iniciaHistoria, historia, enfoca } from './fixtures';
// Documentos de muestra con el nombre de ESTA beneficiaria: lo que la mesa de identidad compara
// después tiene que coincidir con lo que ella capturó, o el video enseña a alguien aprobando una
// INE que no es la suya.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderDocumentos, personaBeneficiaria } = require('./fixtures-kyc/documentos.cjs');

/**
 * La beneficiaria hace su KYC desde la liga, en un celular.
 *
 * El orquestador (`fintech-services/tools/regresion-e2e`) crea la colocación como distribuidora y
 * pasa aquí la liga completa. Este spec es sólo lo que hace ella: abrir, confirmar su celular,
 * fotografiar su INE, tomarse la selfie, corregir sus datos, firmar con su código. Nada de esto
 * pasa por la consola ni por un token de empleado — la liga es pública, y probarla con sesión de
 * staff escondería justo lo que tiene que funcionar sin ella.
 *
 * Al terminar imprime `##HANDOFF## KYC_DONE=1`: el orquestador lo lee para saber que puede pasar
 * a la mesa de identidad del backoffice.
 *
 * Momentos de la historia (`historia()`), en orden: bienvenida → celular → ine → selfie → datos →
 * firma.
 */
const LINK = process.env.RE2E_KYC_LINK ?? '';
const OTP = process.env.RE2E_KYC_OTP ?? '123456';
const CLABE = process.env.RE2E_KYC_CLABE ?? conDigitoVerificador('64618015700000000');

const BENEFICIARIA = process.env.RE2E_BENEFICIARIA ?? 'Rosa Elena Díaz Fuentes';
const BENEFICIARIA_TEL = process.env.RE2E_BENEFICIARIA_TEL ?? '5500000000';

type Docs = { ineFrente: Buffer; ineReverso: Buffer; selfie: Buffer; comprobante: Buffer };
const archivo = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/jpeg', buffer });

/**
 * La CLABE de prueba se calcula en vez de escribirse: con un dígito verificador inventado, la liga
 * la rechaza —bien hecho— y la prueba fallaría por el dato y no por la pantalla.
 * Banxico: pesos 3, 7, 1 sobre los primeros 17 dígitos, sumando cada producto módulo 10.
 */
function conDigitoVerificador(primeros17: string): string {
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(primeros17[i]) * pesos[i % 3]) % 10;
  return primeros17 + String((10 - (suma % 10)) % 10);
}

/** Lo que se escribe si el OCR dejó un campo vacío. Sólo rellena; lo leído de la INE no se toca. */
const RELLENO: Array<[string, string]> = [
  ['Nombre(s)', 'Rosa Elena'],
  ['Primer apellido', 'Díaz'],
  ['CURP', 'DIFR900612MDFZNS08'],
  ['RFC', 'DIFR900612H45'],
  ['Fecha de nacimiento', '1990-06-12'],
  ['Calle', 'Cerrada de Xochicalco'],
  ['Número', '44'],
  ['Colonia', 'Narvarte Poniente'],
  ['Alcaldía o municipio', 'Benito Juárez'],
  ['Ciudad', 'Ciudad de México'],
  ['Estado', 'Ciudad de México'],
  ['Código postal', '03020'],
];

/**
 * De los campos que ya leyó el OCR, los que se señalan al recorrer el formulario. No todos: doce
 * anillos seguidos son ruido, y estos bastan para que se vea que se revisó de arriba abajo.
 */
const RECORRIDO = new Set(['Nombre(s)', 'CURP', 'Fecha de nacimiento', 'Calle', 'Código postal']);

// Tamaño de celular, y el video del mismo tamaño: es el entregable, y una liga pública se ve en un
// teléfono, no en un monitor de escritorio. 432×936 es exactamente el hueco del teléfono en el video
// compuesto (`TELEFONO` en `tools/regresion-e2e/video.py`): grabado a esa medida entra 1:1, sin
// reescalar. `deviceScaleFactor` va en 1 a propósito: el video se codifica a `size` de todos modos,
// y en 2 no salía más nítido.
test.use({
  viewport: { width: 432, height: 936 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
  video: { mode: 'on', size: { width: 432, height: 936 } },
});

test.describe('Regresión E2E · KYC de la beneficiaria en la liga pública', () => {
  test.skip(!LINK, 'sin RE2E_KYC_LINK no hay liga que abrir');

  test('abre la liga, confirma su celular, sube INE y selfie, captura y firma', async ({ page, browser }) => {
    iniciaHistoria();
    test.setTimeout(180_000);

    // Se dibujan en una pestaña aparte, que no sale en el video de la beneficiaria.
    const taller = await (await browser.newContext({ viewport: { width: 940, height: 1120 } })).newPage();
    const docs: Docs = await renderDocumentos(taller, personaBeneficiaria(BENEFICIARIA, BENEFICIARIA_TEL));
    await taller.context().close();

    await test.step('bienvenida', async () => {
      // La liga vive en otro origen (:4300) que la consola: va completa, no contra el baseURL.
      await page.goto(LINK);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('te envió un préstamo', { timeout: 20_000 });
      historia('bienvenida');
      // El monto es lo primero que tiene que leerse: es por lo que ella abrió la liga.
      await enfoca(page, page.locator('.k-facts'), 1600);
      await page.waitForTimeout(1400); // el video es entregable: sin pausa no se alcanza a leer
      const empezar = page.getByRole('button', { name: 'Empezar' });
      await enfoca(page, empezar, 900);
      await empezar.click();
    });

    await test.step('confirma su celular con el código', async () => {
      await expect(page.getByRole('heading', { name: 'Confirma que este celular es tuyo' })).toBeVisible();
      historia('celular');
      await page.waitForTimeout(800);
      // Se señalan las casillas, no el <input>: ése es transparente encima de ellas y el anillo
      // no diría nada.
      await enfoca(page, page.locator('.k-otp'), 700, () =>
        page.getByLabel('Código de 6 dígitos').pressSequentially(OTP, { delay: 220 }));
      await page.waitForTimeout(500);
      const verificar = page.getByRole('button', { name: 'Verificar mi celular' });
      await enfoca(page, verificar, 900);
      await verificar.click();
    });

    await test.step('fotografía su INE por los dos lados', async () => {
      await expect(page.getByRole('heading', { name: 'Fotografía tu INE' })).toBeVisible({ timeout: 20_000 });
      historia('ine');
      await page.waitForTimeout(800);
      // Cada lado: se señala el recuadro, se «toma» la foto y se vuelve a señalar ya con su
      // miniatura, que es la prueba visible de que la foto quedó.
      for (const [aria, foto] of [
        ['Frente de tu INE', archivo('ine-frente.jpg', docs.ineFrente)],
        ['Reverso de tu INE', archivo('ine-reverso.jpg', docs.ineReverso)],
      ] as const) {
        const recuadro = page.locator('label.k-slot').filter({ has: page.getByLabel(aria) });
        await enfoca(page, recuadro, 900);
        await page.getByLabel(aria).setInputFiles(foto);
        await expect(recuadro).toHaveClass(/\bdone\b/);
        await enfoca(page, recuadro, 1500);
      }
      await enfoca(page, page.locator('.k-slots'), 1200);
      const continuar = page.getByRole('button', { name: 'Continuar' });
      await enfoca(page, continuar, 800);
      await continuar.click();
    });

    await test.step('se toma la selfie', async () => {
      await expect(page.getByRole('heading', { name: 'Ahora tu cara' })).toBeVisible({ timeout: 30_000 });
      historia('selfie');
      await page.waitForTimeout(800);
      const marco = page.locator('.k-live-frame');
      await enfoca(page, marco, 900);
      await page.getByLabel('Tu selfie').setInputFiles(archivo('selfie.jpg', docs.selfie));
      await expect(marco.locator('img')).toBeVisible();
      await enfoca(page, marco, 2000);
      const continuar = page.getByRole('button', { name: 'Continuar' });
      await enfoca(page, continuar, 800);
      await continuar.click();
    });

    await test.step('revisa sus datos y escribe su CLABE', async () => {
      await expect(page.getByRole('heading', { name: 'Revisa que esté bien escrito' })).toBeVisible({ timeout: 30_000 });
      historia('datos');
      await page.waitForTimeout(800);
      // Un recorrido de arriba abajo por lo que se leyó de su INE: en el video, el formulario se
      // revisa, no se salta. Lo que el OCR dejó vacío se rellena en su turno.
      for (const [label, valor] of RELLENO) {
        const campo = page.getByLabel(label, { exact: true });
        const vacio = !(await campo.inputValue()).trim();
        if (vacio) {
          await enfoca(page, campo, 500, () => campo.fill(valor));
        } else if (RECORRIDO.has(label)) {
          await enfoca(page, campo, 700);
        }
      }
      const ocupacion = page.getByLabel('Ocupación', { exact: true });
      await enfoca(page, ocupacion, 500, async () => {
        await ocupacion.clear();
        await ocupacion.pressSequentially('Estilista independiente', { delay: 35 });
      });
      const ingreso = page.getByLabel('Ingreso mensual', { exact: true });
      await enfoca(page, ingreso, 500, async () => {
        await ingreso.clear();
        await ingreso.pressSequentially('14000', { delay: 80 });
      });
      // La CLABE es lo único que no sale de la INE y a donde va el dinero: se teclea con el anillo
      // puesto para que se vea dígito por dígito.
      const clabe = page.getByLabel('CLABE interbancaria');
      await enfoca(page, clabe, 700, async () => {
        await clabe.clear();
        await clabe.pressSequentially(CLABE, { delay: 70 });
      });
      await page.waitForTimeout(800);
      const correctos = page.getByRole('button', { name: 'Mis datos son correctos' });
      await enfoca(page, correctos, 900);
      await correctos.click();
    });

    await test.step('acepta las tres autorizaciones y firma con su código', async () => {
      await expect(page.getByRole('heading', { name: 'Tu autorización' })).toBeVisible({ timeout: 20_000 });
      historia('firma');
      await page.waitForTimeout(800);
      // Se toca el texto de cada tarjeta, como lo haría ella; la casilla real está oculta a la vista
      // y se comprueba por su nombre accesible.
      for (const nombre of [/^Acepto el aviso de privacidad/, /^Autorizo la consulta/, /^Entiendo que este crédito es mío/]) {
        const casilla = page.getByRole('checkbox', { name: nombre });
        await enfoca(page, page.locator('.k-consent').filter({ has: casilla }), 1100);
        if (!(await casilla.isChecked())) {
          await page.locator('.k-consent label').filter({ has: casilla }).locator('.k-consent-title').click();
        }
        await expect(casilla).toBeChecked();
        await page.waitForTimeout(500);
      }
      // Lo que acepta, en cifras, antes de firmar: es lo que la protege de un monto que no pidió.
      await enfoca(page, page.locator('.k-summary'), 2000);

      // Firmar son dos toques: el primero registra las casillas y pide el código; el segundo, con
      // el código escrito, firma. Por eso el botón se señala dos veces.
      const firmar = page.getByRole('button', { name: /^Firmar con mi código/ });
      await enfoca(page, firmar, 900);
      await firmar.click();
      const codigo = page.getByLabel('Código de 6 dígitos');
      await expect(codigo).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await enfoca(page, page.locator('.k-sign'), 700, () => codigo.pressSequentially(OTP, { delay: 200 }));
      await page.waitForTimeout(400);
      await enfoca(page, firmar, 1000);
      await firmar.click();
    });

    await test.step('listo: ya es turno de la financiera', async () => {
      await expect(page.getByRole('heading', { level: 1 })).toContainText(/^Listo,/, { timeout: 20_000 });
      await expect(page.getByText('QUÉ SIGUE')).toBeVisible();
      await page.waitForTimeout(4000);
    });

    console.log('##HANDOFF## KYC_DONE=1');
  });
});
