// Documentos de muestra para las pruebas y el video de demostración.
//
// Sustituyen a los rellenos que había: un PNG de 1×1 px que la consola ampliaba como un bloque rojo,
// y dibujos con la palabra «PRUEBA». En la mesa de cumplimiento una persona compara la INE contra
// la selfie y los datos capturados; con rellenos, el video enseña a alguien comparando nada.
//
// Son ESPECÍMENES: llevan «MUESTRA · SIN VALIDEZ OFICIAL» encima, el rostro es una ilustración y no
// la foto de nadie, y no usan escudos ni logotipos de ninguna institución. Los datos son los mismos
// que devuelve el OCR simulado, para que lo que la persona ve en el documento coincida con lo que
// la pantalla dice que se leyó de él.
//
//   const { renderDocumentos, personaBeneficiaria } = require('./documentos.cjs');
//   const docs = await renderDocumentos(page, persona);   // { ineFrente, ineReverso, selfie, comprobante }
//
//   node documentos.cjs <carpeta-salida> distribuidora [curp]
//   node documentos.cjs <carpeta-salida> beneficiaria <nombre> <telefono>
//     → escribe los cuatro JPG (lo usa la app, que no puede generarlos en el simulador)
const path = require('path');
const fs = require('fs');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Identidad sintética: el mismo cálculo que SyntheticIdentity de beneficiary-service ─────────
const ascii = (s) => {
  if (!s || !s.trim()) return 'X';
  const n = s.normalize('NFD').replace(/\p{M}/gu, '').replace(/Ñ/g, 'X').replace(/ñ/g, 'x').replace(/[^A-Za-z]/g, '');
  return n ? n.toUpperCase() : 'X';
};
const letra = (s, i) => (s && s.length > i ? s[i].toUpperCase() : 'X');
const vocal = (s) => {
  if (!s || s.length < 2) return 'X';
  for (const c of s.slice(1)) if ('AEIOU'.includes(c.toUpperCase())) return c.toUpperCase();
  return 'X';
};
function partirNombre(completo) {
  const p = (completo || '').trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return ['Beneficiaria', 'Sin', 'Apellido'];
  if (p.length === 1) return [p[0], 'Sin', 'Apellido'];
  if (p.length === 2) return [p[0], p[1], 'Sin'];
  if (p.length === 3) return p;
  return [`${p[0]} ${p[1]}`, p[2], p[3]];
}
function curpSintetica([nombre, paterno, materno], telefono) {
  const P = ascii(paterno), M = ascii(materno), N = ascii(nombre);
  const tel = (telefono || '0000000000').replace(/\D/g, '').padStart(10, '0');
  return (letra(P, 0) + vocal(P) + letra(M, 0) + letra(N, 0) + '900612' + 'MDF'
    + letra(P, 1) + letra(M, 1) + letra(N, 1) + tel[8] + tel[9]).toUpperCase();
}

/** La beneficiaria de la colocación, con los datos que el OCR simulado le atribuye. */
function personaBeneficiaria(nombreCompleto, telefono) {
  const partes = partirNombre(nombreCompleto);
  return {
    nombre: partes[0].toUpperCase(), paterno: partes[1].toUpperCase(), materno: partes[2].toUpperCase(),
    nacimiento: '12/06/1990', sexo: 'M', curp: curpSintetica(partes, telefono),
    calle: 'C. CERRADA DE XOCHICALCO 44', colonia: 'COL. NARVARTE PONIENTE 03020',
    municipio: 'BENITO JUÁREZ, CDMX', estado: 'CIUDAD DE MÉXICO', tono: 'mujer',
  };
}

/**
 * La distribuidora: lo que ella misma captura en la app durante la regresión (TestData de
 * fintech-app) y la CURP única de la corrida, para que la INE diga lo mismo que su expediente.
 */
function personaDistribuidora(curp) {
  return {
    nombre: 'LAURA', paterno: 'MÉNDEZ', materno: 'SOTO',
    nacimiento: '26/03/1993', sexo: 'M', curp: curp || 'MESL930326MSLNTR04',
    calle: 'AV. PRINCIPAL 100', colonia: 'COL. CENTRO 80060',
    municipio: 'CULIACÁN, SINALOA', estado: 'SINALOA', tono: 'distribuidora',
  };
}

// Un rostro ilustrado. No es la foto de nadie, y así tiene que ser: un documento de muestra con la
// cara de una persona real sería usar su identidad sin su permiso.
function rostro(p, ancho) {
  // Dos mujeres en la historia —la distribuidora y su clienta— con rasgos distintos: si los dos
  // rostros ilustrados fueran iguales, la mesa de KYC parecería aprobar a la misma persona dos veces.
  const corto = p.tono === 'distribuidora';
  const mujer = p.tono === 'mujer' || corto;
  const piel = corto ? '#E0AC8A' : mujer ? '#C98E6B' : '#B97F5C';
  const pelo = corto ? '#5A3A22' : mujer ? '#2B1B14' : '#1E1410';
  return `<svg viewBox="0 0 200 240" width="${ancho}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EEF3F8"/><stop offset="1" stop-color="#D7E1EC"/></linearGradient></defs>
    <rect width="200" height="240" fill="url(#f)"/>
    ${mujer && !corto ? `<path d="M40 120 Q34 40 100 34 Q166 40 160 120 L168 210 L32 210 Z" fill="${pelo}"/>` : ''}
    ${corto ? `<path d="M46 120 Q40 44 100 38 Q160 44 154 120 Q156 150 146 160 L54 160 Q44 150 46 120 Z" fill="${pelo}"/>` : ''}
    <path d="M38 240 Q40 178 100 172 Q160 178 162 240 Z" fill="${corto ? '#7A3E6A' : mujer ? '#3F6E9E' : '#2E4A66'}"/>
    <rect x="86" y="146" width="28" height="34" rx="10" fill="${piel}"/>
    <ellipse cx="100" cy="112" rx="44" ry="54" fill="${piel}"/>
    ${mujer
      ? `<path d="M56 104 Q60 52 100 50 Q142 52 146 102 Q128 76 100 74 Q74 76 56 104 Z" fill="${pelo}"/>`
      : `<path d="M56 98 Q58 52 100 50 Q142 52 144 98 Q132 72 100 70 Q68 72 56 98 Z" fill="${pelo}"/>`}
    <ellipse cx="82" cy="114" rx="5" ry="3.6" fill="#2A1E18"/><ellipse cx="118" cy="114" rx="5" ry="3.6" fill="#2A1E18"/>
    <path d="M74 103 Q82 99 90 102" stroke="#3A2A20" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M110 102 Q118 99 126 103" stroke="#3A2A20" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M100 116 Q97 130 100 134 Q104 135 106 133" stroke="#9A6648" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M86 146 Q100 154 114 146" stroke="#8E4E3E" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
}

const BASE = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{font-family:Inter,sans-serif;background:#c9cfd6}
.marca{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.marca span{transform:rotate(-18deg);font-weight:800;font-size:64px;letter-spacing:.08em;color:rgba(200,30,60,.16);white-space:nowrap}
.mini{font-size:11px;font-weight:600;letter-spacing:.08em;color:#5d6b7a;text-transform:uppercase}
.dato{font-size:17px;font-weight:700;color:#132235;letter-spacing:.01em;line-height:1.25}</style>`;

const ineFrente = (p) => `<!doctype html><html><head><meta charset="utf-8">${BASE}<style>
.c{position:relative;width:860px;height:540px;margin:30px;border-radius:28px;overflow:hidden;
  background:linear-gradient(135deg,#F6F1E6 0%,#E9F0EC 45%,#E6E9F3 100%);box-shadow:0 18px 40px rgba(0,0,0,.25)}
.c:before{content:"";position:absolute;inset:0;background:repeating-radial-gradient(circle at 70% 40%,rgba(120,90,160,.06) 0 2px,transparent 2px 9px)}
.h{position:absolute;left:36px;top:26px;right:36px;display:flex;justify-content:space-between;align-items:flex-start}
.h b{display:block;font-size:22px;font-weight:800;color:#5A2D6E;letter-spacing:.02em}.h i{font-style:normal;font-size:14px;font-weight:700;color:#5A2D6E}
.foto{position:absolute;left:36px;top:110px;width:200px;height:250px;border-radius:12px;overflow:hidden;border:3px solid #fff}
.d{position:absolute;left:270px;top:108px;right:36px;display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}
.wide{grid-column:1/3}.firma{position:absolute;left:40px;bottom:46px;font-family:cursive;font-size:30px;color:#233}
.pie{position:absolute;left:270px;bottom:34px;right:36px;display:flex;gap:30px}
</style></head><body><div class="c">
<div class="h"><div><b>CREDENCIAL PARA VOTAR</b><i>DOCUMENTO DE IDENTIFICACIÓN · MÉXICO</i></div><div class="mini" style="text-align:right">MUESTRA<br>SIN VALIDEZ OFICIAL</div></div>
<div class="foto">${rostro(p, 194)}</div>
<div class="d">
  <div class="wide"><div class="mini">Nombre</div><div class="dato">${esc(p.paterno)}<br>${esc(p.materno)}<br>${esc(p.nombre)}</div></div>
  <div class="wide"><div class="mini">Domicilio</div><div class="dato">${esc(p.calle)}<br>${esc(p.colonia)}<br>${esc(p.municipio)}</div></div>
  <div><div class="mini">CURP</div><div class="dato">${esc(p.curp)}</div></div>
  <div><div class="mini">Fecha de nacimiento</div><div class="dato">${esc(p.nacimiento)}</div></div>
  <div><div class="mini">Sexo</div><div class="dato">${esc(p.sexo)}</div></div>
  <div><div class="mini">Vigencia</div><div class="dato">2024 - 2034</div></div>
</div>
<div class="firma">${esc(p.nombre.split(' ')[0][0] + p.nombre.split(' ')[0].slice(1).toLowerCase())} ${esc(p.paterno[0] + p.paterno.slice(1).toLowerCase())}</div>
<div class="marca"><span>MUESTRA · SIN VALIDEZ</span></div>
</div></body></html>`;

const ineReverso = (p) => {
  const barras = Array.from({ length: 70 }, (_, i) => `<i style="width:${(i * 7) % 5 + 1}px"></i>`).join('');
  const qr = Array.from({ length: 21 * 21 }, (_, i) => `<i style="background:${((i * 37 + (i >> 3)) % 7 < 3) ? '#132235' : 'transparent'}"></i>`).join('');
  const mrz = `IDMEX${p.curp.slice(0, 10)}<<${p.curp.slice(10)}<<<<<<<<`.padEnd(30, '<').slice(0, 30);
  const mrz3 = `${p.paterno}<<${p.nombre.replace(/ /g, '<')}`.normalize('NFD').replace(/\p{M}/gu, '').padEnd(30, '<').slice(0, 30);
  return `<!doctype html><html><head><meta charset="utf-8">${BASE}<style>
.c{position:relative;width:860px;height:540px;margin:30px;border-radius:28px;overflow:hidden;
  background:linear-gradient(135deg,#EEF1F6,#F4EFE6);box-shadow:0 18px 40px rgba(0,0,0,.25)}
.qr{position:absolute;left:40px;top:40px;width:190px;height:190px;display:grid;grid-template-columns:repeat(21,1fr);background:#fff;padding:8px;border-radius:6px}
.qr i{display:block}.bar{position:absolute;left:270px;top:56px;height:90px;display:flex;gap:3px;align-items:stretch}.bar i{background:#132235}
.txt{position:absolute;left:270px;top:170px;right:40px;font-size:15px;color:#2a3a4c;line-height:1.5}
.mrz{position:absolute;left:40px;right:40px;bottom:36px;font-family:"Courier New",monospace;font-size:28px;font-weight:700;letter-spacing:.14em;color:#132235;line-height:1.35}
</style></head><body><div class="c">
<div class="qr">${qr}</div><div class="bar">${barras}</div>
<div class="txt"><div class="mini">Reverso · muestra</div>Documento de muestra generado para el ambiente de pruebas. No corresponde a ninguna credencial emitida.</div>
<div class="mrz">${esc(mrz)}<br>${esc('9006128M3412316MEX<<<<<<<<<<<<'.slice(0, 30))}<br>${esc(mrz3)}</div>
<div class="marca"><span>MUESTRA · SIN VALIDEZ</span></div>
</div></body></html>`;
};

const selfie = (p) => `<!doctype html><html><head><meta charset="utf-8">${BASE}<style>
body{background:#111}.c{position:relative;width:720px;height:960px;overflow:hidden}
.c svg{width:720px;height:864px}.b{position:absolute;left:0;right:0;bottom:0;height:96px;background:#0D47A1;color:#fff;display:flex;align-items:center;justify-content:center;gap:16px;font-weight:700;font-size:24px}
.ok{width:16px;height:16px;border-radius:50%;background:#00B894}
.guia{position:absolute;left:150px;top:90px;width:420px;height:560px;border:5px solid rgba(255,255,255,.85);border-radius:50%}
</style></head><body><div class="c">${rostro(p, 720)}<div class="guia"></div>
<div class="b"><span class="ok"></span>Selfie de muestra · rostro ilustrado</div></div></body></html>`;

const comprobante = (p) => `<!doctype html><html><head><meta charset="utf-8">${BASE}<style>
body{background:#ddd}.c{position:relative;width:820px;height:1060px;margin:20px;background:#fff;padding:56px;box-shadow:0 10px 30px rgba(0,0,0,.2)}
h1{font-size:30px;font-weight:800;color:#0B3B6E}.row{display:flex;justify-content:space-between;margin-top:36px}
.box{border:1px solid #d9e1ea;border-radius:12px;padding:20px 24px;margin-top:28px}
table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:10px 0;border-bottom:1px solid #eef2f6;font-size:16px;color:#22313f}
td:last-child{text-align:right;font-weight:700}.total{font-size:34px;font-weight:800;color:#0B3B6E}
</style></head><body><div class="c">
<h1>Recibo de servicio doméstico</h1><div class="mini">Comprobante de domicilio · muestra</div>
<div class="row"><div><div class="mini">Titular</div><div class="dato">${esc(p.nombre)} ${esc(p.paterno)} ${esc(p.materno)}</div></div>
<div style="text-align:right"><div class="mini">Periodo</div><div class="dato">01 SEP - 30 SEP 2026</div></div></div>
<div class="box"><div class="mini">Domicilio del servicio</div><div class="dato">${esc(p.calle)}<br>${esc(p.colonia)}<br>${esc(p.municipio)}</div></div>
<div class="box"><div class="mini">Detalle</div><table><tr><td>Consumo del periodo</td><td>$412.00</td></tr>
<tr><td>Cargo fijo</td><td>$38.50</td></tr><tr><td>IVA</td><td>$72.08</td></tr></table>
<div class="row"><div class="mini">Total a pagar</div><div class="total">$522.58</div></div></div>
<div class="marca"><span>MUESTRA · SIN VALIDEZ</span></div>
</div></body></html>`;

async function captura(page, html, selector) {
  await page.setContent(html, { waitUntil: 'networkidle' }).catch(() => page.setContent(html));
  await page.evaluate(() => document.fonts.ready);
  return page.locator(selector).first().screenshot({ type: 'jpeg', quality: 88 });
}

/** Los cuatro documentos de una persona, como JPG en memoria. */
async function renderDocumentos(page, persona) {
  return {
    ineFrente:   await captura(page, ineFrente(persona), '.c'),
    ineReverso:  await captura(page, ineReverso(persona), '.c'),
    selfie:      await captura(page, selfie(persona), '.c'),
    comprobante: await captura(page, comprobante(persona), '.c'),
  };
}

module.exports = { renderDocumentos, personaBeneficiaria, personaDistribuidora };

if (require.main === module) {
  (async () => {
    const [, , salida, quien, nombre, telefono] = process.argv;
    const { chromium } = require('playwright');
    const persona = quien === 'beneficiaria' ? personaBeneficiaria(nombre, telefono) : personaDistribuidora(nombre);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 940, height: 1120 } });
    const docs = await renderDocumentos(page, persona);
    fs.mkdirSync(salida, { recursive: true });
    for (const [k, buf] of Object.entries(docs)) fs.writeFileSync(path.join(salida, `${k}.jpg`), buf);
    await browser.close();
    console.log(`documentos de ${persona.nombre} ${persona.paterno} → ${salida}`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
