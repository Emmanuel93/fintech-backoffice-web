// Design tokens + global styles for the Kredius backoffice.
// Injected imperatively (instead of a CSS import) so styles cross the Module
// Federation boundary without per-app exports/CSS-import wiring: every app just
// calls ensureThemeStyles() once at bootstrap.
//
// ⚠️ Todo el CSS vive dentro de un template literal, así que **ningún comentario puede llevar
// acentos graves**: un backtick cierra la cadena a media hoja de estilos y el archivo deja de
// compilar con un error de sintaxis que apunta a la línea siguiente, no a la comilla. Al citar
// una propiedad o un valor, escríbelo sin comillas (break-word, no el valor entre backticks).

import { initTheme } from './lib/theme.js';

const STYLE_ID = 'bo-design-system';

// El bloque oscuro se declara una vez y se emite dos veces: para quien no ha elegido tema (manda
// el sistema) y para quien eligió oscuro explícitamente. Escribirlo dos veces a mano es la forma
// clásica de que las dos copias se separen y el botón deje de coincidir con el sistema operativo.
const darkTokens = `
  color-scheme: dark;
  --bo-bg: #0b1220;
  --bo-surface: #111a2e;
  --bo-surface-2: #0f172a;
  --bo-border: #1e293b;
  --bo-border-strong: #31415c;
  --bo-text: #e2e8f0;
  --bo-text-muted: #94a3b8;
  --bo-text-faint: #64748b;
  /* El azul de marca no se lee sobre fondo oscuro: aquí manda un azul aclarado de la misma
     familia, con tinta oscura encima. El token de marca (--bo-brand) no cambia — el logotipo
     debe verse igual en los dos temas. */
  --bo-primary: #6ea8fe;
  --bo-primary-ink: #06172e;
  --bo-primary-soft: #13294f;
  --bo-ring: rgba(110,168,254,.28);
  --bo-accent-soft: #06342a;
  --bo-sidebar: #03142c;
  --bo-sidebar-ink: #a8bcda;
  --bo-sidebar-brand: #ffffff;
  --bo-sidebar-active: #0d2a52;
  --bo-sidebar-faint: #63799b;
  --bo-ok: #4ade80;
  --bo-ok-soft: #052e16;
  --bo-warn: #fbbf24;
  --bo-warn-soft: #451a03;
  --bo-bad: #f87171;
  --bo-bad-soft: #450a0a;
  --bo-info: #38bdf8;
  --bo-info-soft: #082f49;
  --bo-scrim: rgba(2,6,23,.66);
  --bo-shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
  --bo-shadow-lg: 0 24px 70px rgba(0,0,0,.6);
`;

// Reglas que dependen del tema pero no caben en una variable —filtros y mezclas—. Se escriben una
// vez y se emiten con los dos prefijos, igual que los tokens: si se copiaran a mano, el navegador
// del sistema oscuro y el botón de tema acabarían pintando cosas distintas.
const darkRules = (root: string) => `
${root} .bo-input::-webkit-calendar-picker-indicator { filter: invert(1) opacity(.7); }
`;

export const themeCss = `
:root {
  color-scheme: light;
  --bo-bg: #f4f6fb;
  --bo-surface: #ffffff;
  --bo-surface-2: #f8fafc;
  --bo-border: #e4e8f0;
  /* El borde que se ve al pasar por encima de un campo: sin este escalón, apuntar a un input no
     produce ninguna respuesta y el formulario parece una lista de rectángulos apagados. */
  --bo-border-strong: #c9d4e5;
  --bo-text: #0f172a;
  --bo-text-muted: #64748b;
  --bo-text-faint: #94a3b8;
  /* ---- Marca Kredius ----
     Mismos valores que la app (fa_design_system/AppColors): azul profundo #0D47A1 y el verde
     #00B894 del brazo del isotipo. El backoffice y la app son el mismo producto visto por dos
     lados; no pueden tener dos azules. Estos dos no cambian con el tema porque son el logotipo. */
  --bo-brand: #0d47a1;
  --bo-brand-ink: #ffffff;
  --bo-accent: #00b894;
  --bo-accent-soft: #d8f5ee;
  --bo-primary: #0d47a1;
  --bo-primary-ink: #ffffff;
  --bo-primary-soft: #d6e4ff;
  /* Anillo de foco: se pinta fuera del borde, así que va translúcido para no tapar lo de al lado. */
  --bo-ring: rgba(13,71,161,.18);
  --bo-sidebar: #08234d;
  --bo-sidebar-ink: #b9c9e4;
  --bo-sidebar-brand: #ffffff;
  --bo-sidebar-active: #10386f;
  --bo-sidebar-faint: #7d97c2;
  --bo-ok: #16a34a;
  --bo-ok-soft: #dcfce7;
  --bo-warn: #d97706;
  --bo-warn-soft: #fef3c7;
  --bo-bad: #dc2626;
  --bo-bad-soft: #fee2e2;
  --bo-info: #0284c7;
  --bo-info-soft: #e0f2fe;
  --bo-scrim: rgba(2,6,23,.45);
  --bo-radius: 12px;
  --bo-radius-sm: 8px;
  --bo-shadow: 0 1px 2px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.06);
  --bo-shadow-lg: 0 24px 70px rgba(15,23,42,.28);
  --bo-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif;
  --bo-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
}
/* Sin elección explícita manda el sistema; :not([data-theme="light"]) deja que elegir claro gane
   sobre un sistema oscuro. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${darkTokens}  }
${darkRules(':root:not([data-theme="light"])')}}
:root[data-theme="dark"] {${darkTokens}}
${darkRules(':root[data-theme="dark"]')}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bo-bg); }
.bo-root, .bo-root * { font-family: var(--bo-font); }
.bo-root {
  color: var(--bo-text);
  background: var(--bo-bg);
  -webkit-font-smoothing: antialiased;
}

/* ---- App frame ---- */
.bo-frame { display: grid; grid-template-columns: 248px 1fr; min-height: 100vh; }
.bo-sidebar {
  background: var(--bo-sidebar); color: var(--bo-sidebar-ink);
  display: flex; flex-direction: column; padding: 18px 12px; gap: 4px;
  position: sticky; top: 0; height: 100vh;
}
/* ---- Marca ----
   El isotipo lo dibuja <BrandMark/> en SVG con la geometría oficial; aquí sólo va la caja que lo
   acompaña. El logotipo hereda el color de quien lo contiene (currentColor), así la misma pieza
   sirve sobre la barra azul y sobre la tarjeta de acceso sin repintarla desde el JSX. */
.bo-brand { display: flex; align-items: center; gap: 10px; padding: 6px 10px 18px; color: var(--bo-sidebar-brand); }
.bo-brand-mark { flex: none; display: block; }
/* Inter 800 con tracking cerrado: es la proporción del logotipo de la app (letter-spacing -0.053em),
   no una fuente de interfaz cualquiera. */
.bo-brand-name { font-weight: 800; font-size: 17px; letter-spacing: -.053em; line-height: 1; }
.bo-brand-sub { color: var(--bo-sidebar-faint); font-size: 11px; margin-top: 3px; }
.bo-nav-section { color: var(--bo-sidebar-faint); font-size: 10px; text-transform: uppercase; letter-spacing: .8px; padding: 14px 10px 6px; }
.bo-nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px;
  color: var(--bo-sidebar-ink); text-decoration: none; font-size: 13.5px; font-weight: 500; cursor: pointer;
  border: none; background: none; width: 100%; text-align: left;
}
.bo-nav-item:hover { background: var(--bo-sidebar-active); color: var(--bo-sidebar-brand); }
.bo-nav-item.active { background: var(--bo-sidebar-active); color: var(--bo-sidebar-brand); }
.bo-nav-ico { width: 18px; text-align: center; opacity: .9; }
.bo-sidebar-foot { margin-top: auto; font-size: 11px; color: var(--bo-sidebar-faint); padding: 10px; }

/* ---- Menú por secciones ----
   La consola pasó de diez entradas sueltas a ocho secciones con sus pantallas dentro. Una lista
   plana de veintitantos renglones obliga a leerla entera para encontrar la balanza; agrupada por
   el momento del negocio —originar, seguir, cobrar, contabilizar— se llega por eliminación.
   La sección se abre sola cuando la ruta actual cuelga de ella: entrar por un enlace directo tiene
   que dejar el menú mostrando dónde se está parado, no cerrado sobre sí mismo. */
.bo-nav-group { margin-bottom: 2px; }
.bo-nav-head {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px;
  border: none; background: none; border-radius: 8px; cursor: pointer; text-align: left;
  color: var(--bo-sidebar-ink); font-family: inherit; font-size: 13px; font-weight: 600;
}
.bo-nav-head:hover { background: var(--bo-sidebar-active); color: var(--bo-sidebar-brand); }
/* Sección cerrada que contiene la pantalla actual: se marca, porque plegada no hay ningún
   renglón activo que lo diga y el menú parecería no saber dónde estás. */
.bo-nav-head.dentro { color: var(--bo-sidebar-brand); }
.bo-nav-head .bo-nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bo-nav-chev { font-size: 10px; opacity: .6; transition: transform .15s ease; display: inline-block; }
.bo-nav-chev[data-abierto] { transform: rotate(90deg); opacity: 1; }
/* La guía vertical hace visible de qué sección cuelga cada pantalla al recorrer la columna. */
.bo-nav-sub {
  display: flex; flex-direction: column; gap: 1px;
  padding: 3px 0 6px 10px; margin-left: 17px; border-left: 1px solid var(--bo-sidebar-active);
}
.bo-nav-subitem {
  display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 7px;
  color: var(--bo-sidebar-ink); text-decoration: none; font-size: 12.5px; font-weight: 500;
}
.bo-nav-subitem:hover { background: var(--bo-sidebar-active); color: var(--bo-sidebar-brand); }
.bo-nav-subitem.active { background: var(--bo-sidebar-active); color: var(--bo-sidebar-brand); font-weight: 600; }
/* Lo que está en el modelo operativo y todavía no tiene de dónde leer. Apagado y con su motivo al
   posarse encima; el rótulo va **debajo** del nombre y no al lado, porque en una columna de 248px
   compartir renglón dejaba el nombre cortado a media palabra —«Contact… SIN CONECTAR»—, que es
   exactamente el renglón que hay que poder leer para entender qué falta. */
.bo-nav-subitem.soon {
  opacity: .45; cursor: default; align-items: flex-start;
  flex-wrap: wrap; row-gap: 2px; padding-top: 6px; padding-bottom: 7px;
}
.bo-nav-subitem.soon .bo-nav-dot { margin-top: 5px; }
.bo-nav-subitem.soon:hover { background: none; color: var(--bo-sidebar-ink); }
.bo-nav-subitem.soon .bo-nav-text { white-space: normal; line-height: 1.35; }
.bo-nav-subitem.soon .bo-nav-tag { flex-basis: 100%; margin-left: 14px; }
.bo-nav-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .45; flex: none; }
.bo-nav-subitem.active .bo-nav-dot { opacity: 1; background: var(--bo-accent); }
.bo-nav-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Marca de lo que está en el modelo operativo pero todavía no tiene de dónde leer. Se escribe en
   vez de dejar sólo el renglón apagado: «gris» se lee como «no tienes permiso», que es otra cosa. */
.bo-nav-tag {
  align-self: flex-start; font-size: 8.5px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; padding: 0 5px; line-height: 1.7;
  border-radius: 4px; border: 1px solid currentColor; opacity: .85;
}

.bo-main { display: flex; flex-direction: column; min-width: 0; }
.bo-topbar {
  height: 60px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; background: var(--bo-surface); border-bottom: 1px solid var(--bo-border);
  position: sticky; top: 0; z-index: 10;
}
.bo-topbar-title { font-weight: 650; font-size: 15px; }
.bo-user { display: flex; align-items: center; gap: 10px; }
.bo-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bo-primary-soft); color: var(--bo-primary); display: grid; place-items: center; font-weight: 700; font-size: 13px; }
.bo-content { padding: 24px; min-width: 0; }

/* ---- Theme toggle ---- */
.bo-theme-btn {
  width: 38px; height: 38px; padding: 0; border-radius: var(--bo-radius-sm);
  border: 1px solid var(--bo-border); background: var(--bo-surface); color: var(--bo-text-muted);
  cursor: pointer; display: grid; place-items: center; font-size: 15px; line-height: 1;
}
.bo-theme-btn:hover { background: var(--bo-surface-2); color: var(--bo-text); }
.bo-theme-btn:focus-visible { outline: 2px solid var(--bo-primary); outline-offset: 2px; }

/* ---- Typography / headers ---- */
.bo-page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 12px; flex-wrap: wrap; }
.bo-page-title { font-size: 22px; font-weight: 700; margin: 0; }
.bo-page-sub { color: var(--bo-text-muted); font-size: 13px; margin: 4px 0 0; }

/* ---- Cards ---- */
/* El min-width:0 no es cosmético: sin él, una tarjeta que es hija de un grid o un flex se estira
   hasta caber su contenido más ancho —una tabla de nueve columnas— y arrastra la página entera,
   que pasa a desplazarse en horizontal con la barra lateral y el encabezado incluidos. Con esto,
   quien se desplaza es la tabla dentro de su propio .bo-table-wrap, que es lo correcto. */
.bo-card { background: var(--bo-surface); border: 1px solid var(--bo-border); border-radius: var(--bo-radius); box-shadow: var(--bo-shadow); min-width: 0; }
.bo-card-pad { padding: 18px; }
.bo-card-head { padding: 14px 18px; border-bottom: 1px solid var(--bo-border); font-weight: 650; font-size: 14px; display:flex; justify-content:space-between; align-items:center; }
.bo-grid { display: grid; gap: 16px; }
.bo-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
.bo-cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* ---- Árbol de estructura comercial ----
   Dos paneles: la jerarquía a la izquierda, fija, y la cartera de lo seleccionado a la derecha.
   En pantalla angosta se apilan —el árbol no se lee en 200px. */
.bo-split { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .bo-split { grid-template-columns: 1fr; } }
.bo-tree-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
  cursor: pointer; user-select: none;
}
.bo-tree-row:hover { background: var(--bo-surface-2); }
.bo-tree-row.active { background: var(--bo-primary-soft); }
.bo-tree-caret {
  background: none; border: none; cursor: pointer; color: var(--bo-text-muted);
  width: 18px; flex: none; font-size: 11px; line-height: 1;
}
.bo-tree-caret:disabled { cursor: default; opacity: .35; }
.bo-tree-code { font-family: var(--bo-mono); font-size: 11px; color: var(--bo-text-muted); }
.bo-tree-empty { font-size: 12px; color: var(--bo-text-muted); padding: 2px 0 6px; }
/* El monto de cada rama, junto a su nombre: es lo que se lee al recorrer el árbol. */
.bo-tree-monto { font-size: 11.5px; color: var(--bo-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bo-tree-mora { color: var(--bo-bad); font-weight: 700; }

/* ---- Árbol de cartera: una sola tabla que baja hasta el cliente ---- */
.bo-arbol-celda { display: flex; align-items: center; gap: 6px; min-width: 0; }
.bo-arbol-nombre { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.bo-arbol-cartera td { padding: 7px 10px; vertical-align: top; }
.bo-arbol-cartera tbody tr:hover { background: var(--bo-surface-2); }
/* La primera columna se queda a la vista al desplazar: con nueve columnas de cifras, perder de
   vista de qué rama son convierte la tabla en una lista de números sueltos. */
.bo-arbol-cartera th:first-child, .bo-arbol-cartera td:first-child {
  position: sticky; left: 0; z-index: 1; background: var(--bo-surface);
  min-width: 260px; max-width: 420px;
}
.bo-arbol-cartera tbody tr:hover td:first-child { background: var(--bo-surface-2); }
/* El dato de apoyo bajo la cifra principal: proporción, ticket, tasa. Se lee sólo si se busca. */
.bo-sub { font-size: 11px; color: var(--bo-text-muted); font-weight: 400; margin-top: 2px; }
/* Quién responde por la rama, bajo su nombre. Una red comercial se dirige hablando con personas:
   "Región Norte al 28% de mora" no es accionable hasta saber a quién llamar. */
.bo-responsable { display: block; font-size: 11.5px; color: var(--bo-text-muted); font-weight: 500; margin-top: 1px; }
.bo-responsable i { color: var(--bo-warn); font-style: normal; }
/* El renglón entero abre la rama. Bajar cuatro escalones es el recorrido normal de esta pantalla,
   y con sólo el triángulo activo la tabla parece que no se abre. */
.bo-fila-arbol.abrible { cursor: pointer; }
.bo-fila-arbol.abrible:hover .bo-tree-caret { color: var(--bo-primary); }
/* El triángulo pasa a ser una marca, no un botón: quien recibe el clic es la fila. */
.bo-arbol-cartera .bo-tree-caret { display: inline-block; user-select: none; }
/* La fila abierta se marca para no perder de vista de qué cuelga lo que se está leyendo. */
.bo-fila-abierta > td:first-child { box-shadow: inset 2px 0 0 var(--bo-primary); }
/* Aviso de alcance: qué parte de la red gobierna quien mira. No es un error, es el encuadre. */
.bo-scope {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: var(--bo-primary-soft); border-radius: var(--bo-radius-sm);
  padding: 9px 12px; font-size: 12.5px; color: var(--bo-text);
}
.bo-tree-legend { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--bo-border); font-size: 11px; color: var(--bo-text-muted); }
.bo-scroll-list { max-height: 420px; overflow-y: auto; }
.bo-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12.5px; }
.bo-crumb { background: none; border: 0; padding: 0 2px; cursor: pointer; color: var(--bo-text-muted); font: inherit; }
.bo-crumb:hover { color: var(--bo-primary); text-decoration: underline; }
.bo-crumb-sep { color: var(--bo-border); margin: 0 2px; }
/* El acceso rápido que está cargado en el formulario, para saber con quién se va a entrar. */
.bo-btn-selected { border-color: var(--bo-primary); background: var(--bo-primary-soft); }

/* ---- Expediente ---- */
.bo-doc { border: 1px solid var(--bo-border); border-radius: 10px; overflow: hidden; }
.bo-doc.open { border-color: var(--bo-primary); }
.bo-doc-head {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  background: none; border: 0; cursor: pointer; color: inherit; font: inherit;
}
.bo-doc-head:hover { background: var(--bo-surface-2); }
.bo-doc-caret { color: var(--bo-text-muted); font-size: 11px; width: 12px; }
.bo-doc-body { padding: 10px 12px 12px; border-top: 1px solid var(--bo-border); }
.bo-doc-tools { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 8px; }
.bo-doc-tools button {
  min-width: 28px; padding: 2px 8px; font-size: 12px; cursor: pointer; border-radius: 6px;
  border: 1px solid var(--bo-border); background: transparent; color: inherit;
}
.bo-doc-tools button:disabled { opacity: .4; cursor: default; }
.bo-doc-tools a { margin-left: auto; color: var(--bo-primary); }
/* El acercamiento desborda a propósito: se recorre el documento en vez de encogerlo. */
.bo-doc-canvas { max-height: 560px; overflow: auto; background: var(--bo-surface-2); border-radius: 8px; text-align: center; }
.bo-doc-canvas img { display: block; margin: 0 auto; }

/* El hecho en una oración, arriba del acta. Es la línea que un auditor cita en su papel de
   trabajo, así que se lee antes que cualquier campo técnico. */
.bo-acta {
  background: var(--bo-primary-soft); border-radius: var(--bo-radius-sm);
  padding: 12px 14px; font-size: 14px; font-weight: 600; line-height: 1.45;
}
.bo-mono-sm { font-family: var(--bo-mono); font-size: 10.5px; }

/* El payload de auditoría se muestra tal cual llegó: es evidencia, no un resumen. */
.bo-payload {
  margin: 0; padding: 12px; border-radius: 10px; max-height: 320px; overflow: auto;
  background: var(--bo-surface-2); border: 1px solid var(--bo-border);
  font-family: var(--bo-mono); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}

/* Matriz de RBAC: muchas columnas angostas y una etiqueta larga a la izquierda. */
.bo-matrix th.num, .bo-matrix td.num { text-align: center; }
/* Los nombres de rol se parten en dos líneas en vez de estirar la columna. Con trece roles y
   white-space nowrap, «Gestor de cobranza» imponía un ancho de columna que sólo sirve para una
   palomita: la tabla llegaba a 2100px y el último rol quedaba cortado a media palabra. */
.bo-matrix thead th.num {
  font-size: 11px; white-space: normal; max-width: 112px; min-width: 74px;
  vertical-align: bottom; line-height: 1.3; padding: 10px 8px;
  /* Sin versalitas ni espaciado extra: son nombres propios, no etiquetas. En mayúsculas
     «Administrador de producto» mide un tercio más y deja de caber, y una palabra que no cabe
     no se parte — se sale de su celda y se encima con la de al lado.
     break-word y no anywhere: el segundo parte también donde sí hay espacios disponibles y
     dejaba «Analist / a de crédito», que se lee peor que la columna ancha que se quería evitar. */
  text-transform: none; letter-spacing: 0; overflow-wrap: break-word;
}
/* La capacidad se queda a la vista al desplazar. Sin esto, al llegar al décimo rol ya no se sabe
   de qué fila es la palomita que se está leyendo — que es justo para lo que existe la matriz. */
.bo-matrix th:first-child, .bo-matrix td:first-child {
  position: sticky; left: 0; z-index: 1; background: var(--bo-surface);
  min-width: 230px; box-shadow: 1px 0 0 var(--bo-border);
}
.bo-matrix tbody tr:hover td:first-child { background: var(--bo-surface-2); }

/* ---- Embudo de crédito ----
   Cada etapa es un botón: leer dónde se atora la originación y filtrar por ello es el mismo
   gesto. Un tablero que sólo informa obliga a traducir a mano lo que se acaba de leer. */
.bo-embudo { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.bo-etapa {
  text-align: left; cursor: pointer; font: inherit;
  background: var(--bo-surface); border: 1px solid var(--bo-border);
  border-radius: var(--bo-radius); padding: 12px 14px; box-shadow: var(--bo-shadow);
  display: grid; gap: 2px; min-width: 0;
}
.bo-etapa:hover { border-color: var(--bo-primary); }
.bo-etapa.activa { border-color: var(--bo-primary); background: var(--bo-primary-soft); }
.bo-etapa-n { font-size: 24px; font-weight: 750; letter-spacing: -.4px; font-variant-numeric: tabular-nums; }
.bo-etapa-t { font-size: 12.5px; font-weight: 650; }
.bo-etapa-q { font-size: 11px; color: var(--bo-text-muted); }
.bo-etapa-m { font-size: 11.5px; color: var(--bo-text-muted); font-variant-numeric: tabular-nums; }
.bo-etapa-barra { height: 4px; border-radius: 999px; background: var(--bo-border); margin: 6px 0 4px; overflow: hidden; }
.bo-etapa-barra span { display: block; height: 100%; background: var(--bo-text-faint); border-radius: 999px; }
.bo-etapa.t-espera .bo-etapa-barra span { background: var(--bo-warn); }
.bo-etapa.t-espera .bo-etapa-n { color: var(--bo-warn); }
.bo-etapa.t-ok .bo-etapa-barra span { background: var(--bo-ok); }
.bo-etapa.t-bad .bo-etapa-barra span { background: var(--bo-bad); }
.bo-etapa.t-bad .bo-etapa-n { color: var(--bo-bad); }
.bo-etapa-d { display: flex; gap: 8px; flex-wrap: wrap; font-size: 10.5px; color: var(--bo-text-faint); margin-top: 2px; }

/* ---- Ficha de producto: la política de riesgo que lo gobierna ---- */
.bo-politica { border: 1px solid var(--bo-border); border-radius: var(--bo-radius); padding: 14px; margin-top: 12px; }
.bo-politica-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
/* Los umbrales son el marcador: qué score se convierte en qué decisión. */
.bo-umbrales { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.bo-umbral { border: 1px solid var(--bo-border); border-left-width: 3px; border-radius: var(--bo-radius-sm); padding: 8px 10px; }
.bo-umbral.n-bajo { border-left-color: var(--bo-ok); }
.bo-umbral.n-medio { border-left-color: var(--bo-warn); }
.bo-umbral.n-alto { border-left-color: var(--bo-bad); }
.bo-umbral-n { font-weight: 700; font-size: 12px; }
.bo-umbral-s { font-size: 11.5px; color: var(--bo-text-muted); font-variant-numeric: tabular-nums; }
.bo-umbral-d { font-size: 11.5px; margin-top: 2px; }
.bo-regla-titulo { font-size: 12px; font-weight: 650; }
/* Cada regla en una línea: atributo, condición y cuánto pesa. Tres columnas y no un párrafo,
   porque lo que se compara entre reglas es el peso, y comparar exige alineación. */
.bo-regla {
  display: grid; grid-template-columns: 150px 1fr auto; gap: 10px; align-items: baseline;
  padding: 6px 10px; border-radius: var(--bo-radius-sm); background: var(--bo-surface-2);
  font-size: 12.5px; border-left: 3px solid var(--bo-border);
}
.bo-regla.t-ok { border-left-color: var(--bo-ok); }
.bo-regla.t-warn { border-left-color: var(--bo-warn); }
.bo-regla.t-bad { border-left-color: var(--bo-bad); }
/* El atributo se parte si no cabe en su columna. Sin esto, un nombre largo se sale de su celda y
   se encima con la condición de al lado: dos textos superpuestos e ilegibles. */
.bo-regla-attr { font-weight: 650; overflow-wrap: break-word; min-width: 0; }
/* Una regla en edición: nombre, operador, umbral y puntos en una sola línea. Alinear los campos
   entre reglas es lo que permite comparar pesos de un vistazo, que es como se calibra una
   política — no leyendo veinte formularios apilados. */
.bo-regla-edit {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 8px 10px; border: 1px solid var(--bo-border); border-radius: var(--bo-radius-sm);
  background: var(--bo-surface-2);
}
.bo-regla-edit-nombre { min-width: 170px; flex: 0 0 auto; font-size: 12.5px; }
.bo-regla-edit .bo-input, .bo-regla-edit .bo-select { height: 32px; font-size: 12.5px; max-width: 170px; }
.bo-regla-cond { color: var(--bo-text-muted); }
.bo-regla-pts { font-variant-numeric: tabular-nums; font-weight: 650; white-space: nowrap; }
.bo-regla.t-bad .bo-regla-pts { color: var(--bo-bad); }
.bo-regla.t-ok .bo-regla-pts { color: var(--bo-ok); }
@media (max-width: 700px) { .bo-regla { grid-template-columns: 1fr auto; } .bo-regla-cond { grid-column: 1 / -1; } }

/* ---- Listado de políticas de riesgo ---- */
.bo-politica-fila { border: 1px solid var(--bo-border); border-radius: var(--bo-radius-sm); }
.bo-politica-fila.abierta { border-color: var(--bo-primary); }
.bo-politica-cabecera {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: none; border: 0; cursor: pointer; color: inherit; font: inherit; text-align: left;
}
.bo-politica-cabecera:hover { background: var(--bo-surface-2); }
/* Las cifras del resumen: cuántas reglas suman, restan y descalifican, y dónde está el corte de
   aprobación automática. Es lo que permite comparar dos políticas sin abrir ninguna. */
.bo-politica-cifras {
  display: flex; gap: 12px; flex-wrap: wrap; font-size: 11.5px; color: var(--bo-text-muted);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 800px) { .bo-politica-cifras { display: none; } }

/* Encabezado de grupo dentro del detalle de un rol. */
.bo-grupo-cap {
  font-weight: 650; font-size: 11.5px; text-transform: uppercase; letter-spacing: .5px;
  color: var(--bo-text-muted); margin-bottom: 8px;
  padding-bottom: 6px; border-bottom: 1px solid var(--bo-border);
}
.bo-yes { color: var(--bo-ok); font-weight: 700; }
.bo-no { color: var(--bo-border); }

/* ---- Roles ---- */
.bo-role-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-top: 16px; }
.bo-role-card { cursor: pointer; }
.bo-role-card:hover { background: var(--bo-surface-2); border-radius: var(--bo-radius); }
.bo-cap-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--bo-border); color: var(--bo-text-muted); white-space: nowrap;
}
/* Las que la propia sesión tiene: sirve para leer la matriz desde uno mismo. */
.bo-cap-chip.mine { border-color: transparent; background: var(--bo-primary-soft); color: var(--bo-primary); }
.bo-cap-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px;
  border: 1px solid transparent; cursor: pointer;
}
.bo-cap-row:hover { background: var(--bo-surface-2); }
/* Lo que cambiaría al guardar, marcado antes de guardar: la intención se ve, y salirse no la aplica. */
.bo-cap-row.added   { border-color: var(--bo-ok);  background: var(--bo-ok-soft); }
.bo-cap-row.removed { border-color: var(--bo-bad); background: var(--bo-bad-soft); }
@media (max-width: 900px) { .bo-cols-2 { grid-template-columns: 1fr; } .bo-frame { grid-template-columns: 1fr; } .bo-sidebar { display: none; } }

.bo-kpi { background: var(--bo-surface); border: 1px solid var(--bo-border); border-radius: var(--bo-radius); padding: 16px 18px; box-shadow: var(--bo-shadow); }
.bo-kpi-label { color: var(--bo-text-muted); font-size: 12.5px; font-weight: 500; display:flex; align-items:center; gap:6px; }
.bo-kpi-value { font-size: 26px; font-weight: 750; margin-top: 8px; letter-spacing: -.4px; font-variant-numeric: tabular-nums; }
.bo-kpi-delta { font-size: 12px; margin-top: 6px; font-weight: 600; }
.bo-kpi-accent { width: 34px; height: 34px; border-radius: 9px; display:grid; place-items:center; font-size: 16px; }

/* ---- Cifra de encabezado ----
   Más pequeña que el KPI y sin icono: es la que va en fila de cuatro sobre una tabla —«En pipeline
   35 · Atoradas 3 · Aprobadas hoy 11»— para encuadrar lo que se va a leer debajo. El KPI con su
   acento de color compite con la tabla cuando se usa así. */
.bo-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(195px, 1fr)); gap: 14px; margin-bottom: 16px; }
.bo-stat { background: var(--bo-surface); border: 1px solid var(--bo-border); border-radius: var(--bo-radius); padding: 15px 17px; box-shadow: var(--bo-shadow); min-width: 0; }
.bo-stat-l { font-size: 12px; font-weight: 500; color: var(--bo-text-muted); }
.bo-stat-v { font-size: 22px; font-weight: 700; letter-spacing: -.6px; margin-top: 9px; font-variant-numeric: tabular-nums; }
.bo-stat-s { font-size: 11.5px; color: var(--bo-text-muted); margin-top: 5px; }
.bo-stat-v.t-ok { color: var(--bo-ok); }
.bo-stat-v.t-warn { color: var(--bo-warn); }
.bo-stat-v.t-bad { color: var(--bo-bad); }

/* ---- Medidor ----
   Etiqueta, cifra y barra en tres renglones apretados. Es el patrón de «colocación por producto» y
   «pipeline»: comparar proporciones entre renglones, no leer un valor exacto — para eso está la
   tabla. La barra se dibuja sobre el divisor y no sobre el fondo de la tarjeta, porque al 3% la
   pieza pintada es de dos pixeles y sin canal de fondo no se distingue de la nada. */
.bo-meter { min-width: 0; }
.bo-meter-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.bo-meter-l { font-size: 12.5px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bo-meter-v { font-family: var(--bo-mono); font-size: 11.5px; color: var(--bo-text-muted); white-space: nowrap; flex: none; }
.bo-meter-bar { height: 7px; border-radius: 999px; background: var(--bo-surface-2); border: 1px solid var(--bo-border); overflow: hidden; }
.bo-meter-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--bo-primary); }
.bo-meter-list { display: flex; flex-direction: column; gap: 15px; }
/* Un medidor que además filtra: el renglón entero es el clic, como las etapas del embudo. */
.bo-meter.abrible { cursor: pointer; background: none; border: 0; padding: 0; width: 100%; text-align: left; font: inherit; color: inherit; }
.bo-meter.abrible:hover .bo-meter-l { color: var(--bo-primary); }

/* ---- Línea de tiempo ----
   La trazabilidad de un expediente: qué pasó y cuándo, de arriba abajo. El hilo entre puntos es lo
   que la hace leer como una secuencia; sin él son cinco fechas apiladas. El último punto no lleva
   hilo — colgando de la nada sugiere que falta un paso por ocurrir. */
.bo-timeline { display: flex; flex-direction: column; }
.bo-tl-row { display: flex; gap: 13px; }
.bo-tl-rail { display: flex; flex-direction: column; align-items: center; flex: none; }
.bo-tl-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--bo-border-strong); margin-top: 4px; flex: none; }
.bo-tl-dot.hecho { background: var(--bo-ok); }
.bo-tl-dot.ahora { background: var(--bo-primary); box-shadow: 0 0 0 3px var(--bo-ring); }
.bo-tl-dot.falla { background: var(--bo-bad); }
.bo-tl-line { flex: 1; width: 1px; background: var(--bo-border); margin: 4px 0 0; min-height: 14px; }
.bo-tl-body { padding-bottom: 14px; min-width: 0; }
.bo-tl-l { font-size: 12.5px; font-weight: 600; }
.bo-tl-t { font-size: 11px; color: var(--bo-text-muted); margin-top: 4px; }

/* ---- Anillo de score ----
   La cifra que decide, del tamaño que le corresponde. Va en disco y no en una fila de definición
   porque el score es la primera cosa que se busca al abrir un expediente, y un dato de 13px entre
   otros doce no se encuentra sin leerlos todos. El color lo pone el nivel de riesgo. */
.bo-ring { width: 108px; height: 108px; border-radius: 50%; flex: none; display: grid; place-items: center; text-align: center; background: var(--bo-primary-soft); color: var(--bo-primary); }
.bo-ring.t-ok { background: var(--bo-ok-soft); color: var(--bo-ok); }
.bo-ring.t-warn { background: var(--bo-warn-soft); color: var(--bo-warn); }
.bo-ring.t-bad { background: var(--bo-bad-soft); color: var(--bo-bad); }
.bo-ring-n { font-size: 32px; font-weight: 700; letter-spacing: -1.4px; line-height: 1; font-variant-numeric: tabular-nums; }
.bo-ring-l { font-size: 9.5px; font-weight: 600; letter-spacing: .12em; margin-top: 7px; }

/* ---- Chip ----
   Etiqueta sin punto, para lo que rotula (segmento, política, tipo de línea) en vez de indicar un
   estado. El punto del badge significa «esto tiene un estado»; ponerlo en un rótulo hace pensar que
   el valor cambia solo. */
.bo-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 7px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em; white-space: nowrap;
  background: var(--bo-surface-2); color: var(--bo-text-muted); border: 1px solid var(--bo-border);
}
.bo-chip.ok { background: var(--bo-ok-soft); color: var(--bo-ok); border-color: transparent; }
.bo-chip.warn { background: var(--bo-warn-soft); color: var(--bo-warn); border-color: transparent; }
.bo-chip.bad { background: var(--bo-bad-soft); color: var(--bo-bad); border-color: transparent; }
.bo-chip.info { background: var(--bo-primary-soft); color: var(--bo-primary); border-color: transparent; }

/* ---- Nota al pie de una pantalla ----
   De dónde salen las cifras y qué regla las gobierna. Va al final y en gris: es lo que se lee
   cuando un número no cuadra, no en el recorrido normal. */
.bo-footnote { margin-top: 14px; font-size: 12px; line-height: 1.6; color: var(--bo-text-faint); }
.bo-footnote b { color: var(--bo-text-muted); }

/* ---- Buzón de la barra superior ----
   La campana y su panel. El indicador es un punto con el conteo, no un color: «tienes avisos» y
   «tienes once avisos» son dos informaciones distintas y la segunda es la que decide si se abre
   ahora o al rato. El panel se ancla a la derecha porque la campana vive al final de la barra. */
.bo-bell { position: relative; }
.bo-bell-badge {
  position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: 999px; background: var(--bo-bad); color: #fff;
  font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
  border: 2px solid var(--bo-surface); font-variant-numeric: tabular-nums;
}
.bo-buzon {
  position: absolute; top: calc(100% + 8px); right: 0; width: min(380px, 90vw); z-index: 50;
  background: var(--bo-surface); border: 1px solid var(--bo-border); border-radius: var(--bo-radius);
  box-shadow: var(--bo-shadow-lg); overflow: hidden;
}
.bo-buzon-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--bo-border); font-weight: 650; font-size: 13.5px;
}
.bo-buzon-lista { max-height: 380px; overflow-y: auto; }
.bo-aviso { display: block; width: 100%; text-align: left; padding: 11px 14px; border: 0; border-bottom: 1px solid var(--bo-border); background: none; color: inherit; font: inherit; }
/* Lo no leído se marca con una barra, no con negrita: en una lista de once, once negritas no
   destacan nada. */
.bo-aviso.nuevo { background: var(--bo-primary-soft); box-shadow: inset 3px 0 0 var(--bo-primary); }
.bo-aviso-t { font-size: 12.5px; font-weight: 600; }
.bo-aviso-s { font-size: 11px; color: var(--bo-text-muted); margin-top: 3px; }
.bo-buzon-vacio { padding: 26px 14px; text-align: center; font-size: 12.5px; color: var(--bo-text-muted); }

/* ---- Badges ---- */
.bo-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; line-height: 1.6; }
.bo-badge.ok { background: var(--bo-ok-soft); color: var(--bo-ok); }
.bo-badge.warn { background: var(--bo-warn-soft); color: var(--bo-warn); }
.bo-badge.bad { background: var(--bo-bad-soft); color: var(--bo-bad); }
.bo-badge.info { background: var(--bo-info-soft); color: var(--bo-info); }
.bo-badge.muted { background: var(--bo-surface-2); color: var(--bo-text-muted); border: 1px solid var(--bo-border); }
.bo-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

/* ---- Table ---- */
.bo-table-wrap { width: 100%; overflow-x: auto; }
.bo-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.bo-table th { text-align: left; color: var(--bo-text-muted); font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: .4px; padding: 10px 14px; border-bottom: 1px solid var(--bo-border); white-space: nowrap; }
.bo-table td { padding: 12px 14px; border-bottom: 1px solid var(--bo-border); white-space: nowrap; }
.bo-table tbody tr:hover { background: var(--bo-surface-2); }
/* Una fila que abre algo tiene que parecerlo antes de que la toques. Con cursor:pointer a secas la
   señal llega cuando el puntero ya está encima, así que quien recorre la tabla con la vista nunca
   descubre que cada renglón lleva a un detalle. El realce al pasar es lo que lo delata.
   (Sin acentos graves aquí dentro: esto vive en un template literal y los cierra.) */
.bo-table tr.clickable { cursor: pointer; transition: background .12s ease; }
.bo-table tr.clickable:hover { background: var(--bo-surface-2); }
.bo-table tr.clickable:hover .bo-row-abrir { opacity: 1; }
.bo-row-abrir { opacity: .35; transition: opacity .12s ease; font-size: 15px; line-height: 1; }
/* Fila desplegada y su detalle. La abierta se marca con una barra a la izquierda y fondo propio
   para que, con el detalle abierto ocupando media pantalla, siga estando claro de que renglon
   cuelga lo que se esta leyendo. El detalle no repinta al pasar el puntero: no es clickable, y
   heredar el hover de la tabla lo haria parecerlo. */
.bo-table tr.bo-row-abierta { background: var(--bo-surface-2); box-shadow: inset 3px 0 0 var(--bo-accent); }
.bo-table tr.bo-row-abierta td { border-bottom-color: transparent; }
.bo-table tr.bo-row-detalle:hover { background: transparent; }
.bo-table tr.bo-row-detalle > td { padding: 0 0 14px; white-space: normal; background: var(--bo-surface-2); box-shadow: inset 3px 0 0 var(--bo-accent); }
.bo-detalle-pad { padding: 4px 14px 0 22px; }
/* ---- Totales de un bloque ----
   Van pegados a la tabla que resumen, no en una tarjeta aparte: separarlos obliga a mirar en dos
   sitios para cotejar una suma contra los renglones que la producen. El borde superior grueso es
   la convencion de un total en papel. */
.bo-totales { margin: 10px 0 4px; border-top: 2px solid var(--bo-border); padding-top: 10px; }
.bo-totales-grid { display: flex; flex-direction: column; gap: 6px; max-width: 620px; }
.bo-totales-fila { display: flex; justify-content: space-between; gap: 20px; font-size: 13px; align-items: baseline; }
.bo-totales-fila b { font-variant-numeric: tabular-nums; font-family: var(--bo-mono); }
.bo-totales-suma { border-top: 1px solid var(--bo-border); padding-top: 6px; margin-top: 2px; font-size: 14px; }

/* ---- Seccion plegable ----
   El encabezado es un boton de ancho completo para que toda la fila sea el area de clic: un
   chevron de 12px es un blanco incomodo, y quien no acierta concluye que la seccion no abre. */
.bo-collapsible { border-top: 1px solid var(--bo-border); }
.bo-collapsible-head {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 11px 2px;
  background: none; border: none; cursor: pointer; text-align: left;
  color: var(--bo-text); font-size: 13px; font-family: inherit;
}
.bo-collapsible-head:hover { color: var(--bo-primary); }
.bo-collapsible-chevron { display: inline-block; font-size: 15px; line-height: 1; opacity: .45; transition: transform .15s ease, opacity .12s ease; }
.bo-collapsible-head:hover .bo-collapsible-chevron { opacity: 1; }
.bo-collapsible-chevron[data-abierto] { transform: rotate(90deg); opacity: 1; }
.bo-collapsible-count {
  font-family: var(--bo-mono); font-size: 11.5px; background: var(--bo-surface-2);
  border: 1px solid var(--bo-border); border-radius: 999px; padding: 1px 8px; color: var(--bo-text-muted);
}
.bo-collapsible-body { padding-bottom: 12px; }
.bo-table .num { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--bo-mono); }
.bo-table-empty { padding: 40px; text-align: center; color: var(--bo-text-muted); }

/* ---- Toolbar / campos ----
   Un solo control base para input, select, textarea y botón: misma altura (38px), mismo radio,
   mismo borde y el mismo anillo de foco. Antes cada módulo se dibujaba el suyo con padding y
   color a mano —la bandeja de crédito llevaba borde #334155 y fondo transparente— y no había dos
   filtros iguales entre pantallas. Lo que se toca se toca igual en toda la consola. */
.bo-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }
.bo-input, .bo-select, .bo-textarea {
  font-family: inherit; font-size: 13.5px; color: var(--bo-text);
  background: var(--bo-surface); border: 1px solid var(--bo-border);
  border-radius: var(--bo-radius-sm); outline: none;
  transition: border-color .12s ease, box-shadow .12s ease, background-color .12s ease;
}
.bo-input, .bo-select { height: 38px; padding: 0 12px; }
.bo-textarea { width: 100%; min-height: 84px; padding: 9px 12px; line-height: 1.5; resize: vertical; }
.bo-input::placeholder, .bo-textarea::placeholder { color: var(--bo-text-faint); }
/* Apuntar a un campo tiene que responder antes de hacer clic: es la diferencia entre un formulario
   y una lista de rectángulos. */
.bo-input:hover:not(:disabled), .bo-select:hover:not(:disabled), .bo-textarea:hover:not(:disabled) {
  border-color: var(--bo-border-strong);
}
.bo-input:focus, .bo-select:focus, .bo-textarea:focus {
  border-color: var(--bo-primary); box-shadow: 0 0 0 3px var(--bo-ring);
}
.bo-input:disabled, .bo-select:disabled, .bo-textarea:disabled {
  background: var(--bo-surface-2); color: var(--bo-text-muted); cursor: not-allowed;
}
/* Un campo que el servidor rechazó se marca en el campo, no sólo en un texto al pie. */
.bo-input[aria-invalid="true"], .bo-select[aria-invalid="true"], .bo-textarea[aria-invalid="true"] { border-color: var(--bo-bad); }
.bo-input[aria-invalid="true"]:focus, .bo-select[aria-invalid="true"]:focus, .bo-textarea[aria-invalid="true"]:focus {
  box-shadow: 0 0 0 3px var(--bo-bad-soft);
}
/* El triángulo nativo del select no se puede pintar ni alinear; se apaga y se dibuja uno propio,
   en un gris que funciona sobre fondo claro y oscuro. */
.bo-select {
  appearance: none; -webkit-appearance: none; padding-right: 32px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%2394a3b8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 11px center; background-size: 12px;
}
.bo-select:disabled { opacity: .75; }
/* El icono del calendario venía con el contraste del navegador y desaparecía en modo oscuro
   (el filtro que lo invierte va en darkRules). */
.bo-input::-webkit-calendar-picker-indicator { opacity: .5; cursor: pointer; }
.bo-input:hover::-webkit-calendar-picker-indicator { opacity: .9; }
/* Cifras: alineadas a la derecha y con dígitos de ancho fijo, que es lo que permite comparar dos
   montos leyéndolos en vertical. */
.bo-input.num { text-align: right; font-variant-numeric: tabular-nums; }
.bo-input.grow { flex: 1; min-width: 200px; }

/* Campo con icono, sufijo o botón de limpiar: la caja envuelve al input para poder colocarlos
   dentro del borde y no como un cuadro pegado al lado. */
.bo-input-wrap { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.bo-input-wrap.grow { flex: 1; min-width: 220px; }
.bo-input-wrap .bo-input { width: 100%; }
.bo-input-ico { position: absolute; left: 11px; font-size: 12.5px; line-height: 1; color: var(--bo-text-faint); pointer-events: none; }
.bo-input.has-ico { padding-left: 32px; }
.bo-input-suffix { position: absolute; right: 12px; font-size: 12.5px; color: var(--bo-text-muted); pointer-events: none; }
.bo-input.has-suffix { padding-right: 34px; }
.bo-input-clear {
  position: absolute; right: 7px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%;
  background: var(--bo-surface-2); color: var(--bo-text-muted); cursor: pointer; font-size: 13px; line-height: 1;
  display: grid; place-items: center;
}
.bo-input-clear:hover { background: var(--bo-border); color: var(--bo-text); }
.bo-input-wrap:has(.bo-input-clear) .bo-input { padding-right: 32px; }

.bo-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
/* Dentro de un campo con etiqueta, el control ocupa la columna entera: en una rejilla de dos, un
   input a su ancho natural deja un hueco a la derecha y las etiquetas dejan de leerse en columna. */
.bo-field .bo-input, .bo-field .bo-select, .bo-field .bo-textarea, .bo-field .bo-input-wrap { width: 100%; }
.bo-field-label { font-size: 12px; font-weight: 600; color: var(--bo-text-muted); letter-spacing: .1px; }
.bo-field-req { color: var(--bo-bad); margin-left: 3px; }
/* La ayuda explica qué se espera; el error dice qué pasó. Nunca se muestran las dos. */
.bo-field-hint { font-size: 11.5px; color: var(--bo-text-faint); line-height: 1.4; }
.bo-field-error { font-size: 11.5px; color: var(--bo-bad); font-weight: 600; line-height: 1.4; }

/* Casillas: el color de marca en vez del azul del sistema operativo, y tamaño suficiente para
   acertarles con el ratón en una matriz de trece roles. */
.bo-root input[type="checkbox"], .bo-root input[type="radio"] {
  accent-color: var(--bo-primary); width: 15px; height: 15px; flex: none; cursor: pointer; margin: 0;
}
.bo-root input[type="checkbox"]:disabled, .bo-root input[type="radio"]:disabled { cursor: not-allowed; opacity: .5; }
.bo-root input[type="checkbox"]:focus-visible, .bo-root input[type="radio"]:focus-visible { outline: 2px solid var(--bo-primary); outline-offset: 2px; }
.bo-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; cursor: pointer; }
.bo-check.disabled { cursor: not-allowed; color: var(--bo-text-muted); }

.bo-btn { height: 38px; padding: 0 16px; border-radius: var(--bo-radius-sm); border: 1px solid var(--bo-border); background: var(--bo-surface); color: var(--bo-text); font-size: 13.5px; font-weight: 600; cursor: pointer; display:inline-flex; align-items:center; gap:7px; }
.bo-btn:hover { background: var(--bo-surface-2); }
.bo-btn.primary { background: var(--bo-primary); border-color: var(--bo-primary); color: var(--bo-primary-ink); }
.bo-btn.primary:hover { filter: brightness(1.06); }
.bo-btn.danger { background: var(--bo-bad); border-color: var(--bo-bad); color: #fff; }
.bo-btn:disabled { opacity: .55; cursor: not-allowed; }
.bo-btn:focus-visible { outline: 2px solid var(--bo-primary); outline-offset: 2px; }

/* ---- Tabs ---- */
.bo-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--bo-border); margin-bottom: 16px; flex-wrap: wrap; }
.bo-tab {
  border: none; background: none; cursor: pointer; padding: 10px 14px; font-size: 13.5px; font-weight: 600;
  color: var(--bo-text-muted); border-bottom: 2px solid transparent; margin-bottom: -1px;
  display: inline-flex; align-items: center; gap: 7px;
}
.bo-tab:hover { color: var(--bo-text); }
.bo-tab.active { color: var(--bo-primary); border-bottom-color: var(--bo-primary); }
.bo-tab-count { background: var(--bo-surface-2); border: 1px solid var(--bo-border); border-radius: 999px; padding: 1px 7px; font-size: 11px; font-weight: 700; }
.bo-tab.active .bo-tab-count { background: var(--bo-primary-soft); border-color: transparent; color: var(--bo-primary); }

.bo-x { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--bo-text-muted); line-height: 1; }
.bo-x:hover { color: var(--bo-text); }

/* ---- Modal (centrado) ----
   El detalle de una cuenta es la pantalla de trabajo, no una nota al margen: lleva saldos, tabla de
   amortización y pagos. Centrado y ancho se lee de un vistazo; en un cajón lateral la tabla queda
   estrangulada contra el borde. */
.bo-modal-scrim {
  position: fixed; inset: 0; background: var(--bo-scrim); z-index: 40;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: bo-fade .14s ease-out; overflow-y: auto;
}
.bo-modal {
  width: min(920px, 100%); max-height: calc(100vh - 48px);
  background: var(--bo-surface); border: 1px solid var(--bo-border); border-radius: 16px;
  box-shadow: var(--bo-shadow-lg); display: flex; flex-direction: column; overflow: hidden;
  animation: bo-pop .16s cubic-bezier(.2,.8,.3,1);
}
.bo-modal.wide { width: min(1180px, 100%); }
.bo-modal.narrow { width: min(560px, 100%); }
.bo-modal-head {
  padding: 18px 22px; border-bottom: 1px solid var(--bo-border);
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex: none;
}
.bo-modal-body { padding: 22px; overflow-y: auto; }
@keyframes bo-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes bo-pop { from { transform: translateY(8px) scale(.985); opacity: .7 } to { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .bo-modal, .bo-modal-scrim { animation: none; }
}
@media (max-width: 700px) {
  .bo-modal-scrim { padding: 0; align-items: stretch; }
  .bo-modal, .bo-modal.wide, .bo-modal.narrow { width: 100%; max-height: 100vh; border-radius: 0; border: none; }
}

/* ---- Definition rows ---- */
.bo-defs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
.bo-defs.cols-3 { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 700px) { .bo-defs, .bo-defs.cols-3 { grid-template-columns: 1fr 1fr; } }
.bo-def-k { color: var(--bo-text-muted); font-size: 12px; }
.bo-def-v { font-size: 14px; font-weight: 600; margin-top: 2px; }

/* La ruta de un nodo en el árbol, de la raíz hacia abajo. Se muestra antes y después de mover:
   comprobar "entonces Culiacán pasa a Zona Noreste, que es de Región Norte" es lo que evita
   descubrir el error cuando la cartera ya suma en otra región. */
.bo-ruta { background: var(--bo-surface-2); border: 1px solid var(--bo-border); border-radius: var(--bo-radius-sm); padding: 10px 12px; }
.bo-ruta-v { font-size: 13.5px; font-weight: 600; margin-top: 3px; line-height: 1.5; }
.bo-ruta-nueva { background: var(--bo-primary-soft); border-color: transparent; }
.bo-ruta-nueva .bo-ruta-v { color: var(--bo-primary); }

.bo-spinner { width: 22px; height: 22px; border: 3px solid var(--bo-border); border-top-color: var(--bo-primary); border-radius: 50%; animation: bo-spin .7s linear infinite; }
.bo-center { display: grid; place-items: center; padding: 48px; }
@keyframes bo-spin { to { transform: rotate(360deg); } }

/* ---- Login ----
   El fondo son los dos colores del isotipo: el azul de marca arriba a la izquierda y el verde del
   brazo entrando por la derecha. Es lo mismo que ve el cliente al abrir la app. */
.bo-login { min-height: 100vh; display: grid; place-items: center; background:
  radial-gradient(1000px 500px at 20% -10%, rgba(13,71,161,.16), transparent),
  radial-gradient(900px 500px at 110% 20%, rgba(0,184,148,.12), transparent), var(--bo-bg); }
.bo-login-card { width: 380px; max-width: 92vw; background: var(--bo-surface); border: 1px solid var(--bo-border); border-radius: 16px; box-shadow: var(--bo-shadow); padding: 30px; }
.bo-login-brand { display:flex; align-items:center; gap:10px; margin-bottom: 6px; color: var(--bo-text); }
.bo-login h1 { font-size: 19px; margin: 14px 0 2px; }
.bo-login p.sub { color: var(--bo-text-muted); font-size: 13px; margin: 0 0 20px; }
.bo-alert { background: var(--bo-bad-soft); color: var(--bo-bad); padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
/* Cartera sin dueño: es un hallazgo que hay que atender, no un fallo del sistema. Ámbar y no
   rojo — nada está roto, hay trabajo pendiente. */
.bo-huerfanos { background: var(--bo-warn-soft); color: var(--bo-text); border-left: 3px solid var(--bo-warn); margin-bottom: 0; }
.bo-huerfanos b { color: var(--bo-warn); }
.bo-legend { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color: var(--bo-text-muted); }
.bo-legend span { display:inline-flex; align-items:center; gap:6px; }
`;

export function ensureThemeStyles(): void {
  if (typeof document === 'undefined') return;
  initTheme();
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = themeCss;
  document.head.appendChild(el);
  document.body.classList.add('bo-root');
}
