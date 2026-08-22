# Integración del backoffice con el BFF — research y plan

**Fecha:** 2026-08-11
**Método:** se recorrió el BFF real (`localhost:8090`, `Host: backoffice.localhost`)
endpoint por endpoint con un token de `admin@kredius.mx`, y se comparó cada
respuesta contra lo que el brief asume y contra lo que el front llama hoy.

> **Antes de leer el plan, lee §1.** El brief da por materializado el backend
> completo. Cuatro cosas no lo están, y dos de ellas son el corazón del Módulo 1.

---

## 1. Lo que el research encontró

### 1.1 Todo se probó contra contenedores viejos — dos veces

`/permissions/me`, `/permissions/matrix`, `/sales-org/*` y `/audit/entries`
respondían **404** con los controladores ya escritos en el código. La imagen del
BFF era de dos días antes. Después, `sales-org` respondía **500** con
`Failed to resolve 'sales-org-service'`: el servicio existe en el compose pero
**no estaba levantado**.

Esto ya había pasado antes en este proyecto y volvió a pasar. Es la primera
acción del plan, no una anécdota:

```bash
cd ~/Documents/projects/fintech-services
docker compose up -d sales-org-service
docker compose build channel-backoffice-service && docker compose up -d --force-recreate channel-backoffice-service
```

**Regla para el equipo:** antes de concluir que un endpoint no existe, verificar
que la imagen corresponde al commit que se está leyendo.

### 1.2 Estado real, endpoint por endpoint

Con todo levantado y reconstruido:

| Endpoint | Estado | Nota |
|---|---|---|
| `GET /permissions/me` | ✅ 200 | `{roles:[ADMIN], capabilities:[13]}` |
| `GET /permissions/matrix` | ✅ 200 | 12 roles, capacidades por rol |
| `GET /origination/applications` | ✅ 200 | 34 filas · **faltan campos, ver 1.3** |
| `GET /origination/applications/{id}` | ⚠️ 200 | 5 bloques · **prospect null y bureau roto, ver 1.4** |
| `POST …/decision`, `…/request-documents`, `…/documents-received` | ✅ existen | **sin datos para probarlos, ver 1.5** |
| `GET /sales-org/levels` · `/units` · `/units/{id}/(children\|subtree\|scope\|assignments)` | ✅ 200 | jerarquía sembrada |
| `POST /sales-org/levels` · `/units` · `/units/{id}/assignments` | ✅ existen | |
| `GET /dashboard/commercial` | ✅ 400 correcto | sin `unitId` pide unidad, como dice el brief |
| `GET /dashboard/summary` · `/stats` · `/portfolio` · `/portfolio/{id}` | ✅ 200 | |
| `GET /audit/entries` · `/entries/{id}` | ✅ 200 | eventos con `actor`, `eventType`, `domainSource` |
| `GET /clients` · `/clients/{id}` · `/executives` · `/products` | ✅ 200 | |
| `POST /clients/{id}/assign-executive` | ✅ existe | |
| **`GET /distributors`** | ❌ **404** | **el front ya lo llama — ver 1.6** |

### 1.3 La bandeja no trae con qué llenar la tabla

El brief pide columnas: folio, prospecto, producto, monto, estado, riskLevel,
decision, approvalFlow, fecha. La respuesta real trae:

```
applicationId, prospectId, productType, requestedAmount, requestedTerm,
offeredAmount, offeredLine, offeredTerm, nominalRate, cat, status,
riskLevel, approvalFlow, decidedBy, rejectionReason, createdAt
```

Faltan tres, y no son cosméticas:

- **`folio`** — no existe. Hoy sólo hay `applicationId` (un UUID). Un analista no
  busca por UUID; el folio es lo que el cliente le dicta por teléfono.
- **Nombre del prospecto** — sólo llega `prospectId`. Una bandeja de UUIDs es
  inservible: hay que resolver el nombre, y **en lote**, no una llamada por fila.
- **`decision`** — llega `null` en las 34 filas, aunque en el detalle sí viene.
  Las columnas "decision" y el filtro por ella no se pueden pintar.

Los 6 filtros del brief (`status`, `productType`, `targetAudience`, `from`,
`to`, `q`) **se aceptan** y devuelven 200. Pero `q` **no es un buscador de
texto libre**: en `SpringDataCreditApplicationRepository` la cláusula es
`LOWER(a.promoterCode) LIKE :q` — busca **sólo por código de promotor**.

Un analista que escriba el nombre del cliente o el folio no encontrará nada, y
la caja de búsqueda parecerá rota. O se etiqueta explícitamente "buscar por
código de promotor", o se amplía el `q` en origination (ver **F2-B4**).

### 1.4 La mesa de análisis está vacía por dentro

`GET /origination/applications/{id}` devuelve los 5 bloques que promete el brief
—`application`, `prospect`, `evaluation`, `existingCredits`, `bureauReport`— y
dos están rotos:

**`prospect: null`.** El BFF llama a
`GET origination-service /api/v1/origination/prospects/{id}` y recibe **404**;
lo maneja con elegancia (`"Sin datos capturados del prospecto…"`) y devuelve
null. Pero eso significa que **hoy no hay datos personales, ni domicilio, ni
consentimientos, ni `documents[]`** — que es exactamente el expediente que el
analista tiene que revisar. El Módulo 1 sin esto es una ficha sin sujeto.

**`bureauReport` devuelve un objeto de error.** El BFF llama a
`GET scoring-service /api/v1/scoring/reports/by-prospect/{id}`, recibe 404
(`"No static resource"` — la ruta no está mapeada) y **pasa el cuerpo del error
tal cual**:

```json
{"timestamp":"…","status":404,"error":"Not Found",
 "message":"No static resource api/v1/scoring/reports/by-prospect/…","path":"…"}
```

El front pintaría un error como si fuera el reporte de buró. El brief dice
"viene null si el rol NO es de análisis" — hoy viene basura para **todos** los
roles. Es un bug del BFF, no del front.

**Lo que sí funciona bien:** `evaluation` trae `totalScore` (230), `riskLevel`,
`decision`, `evaluatedAt` y **`ruleDetails[]` con 7 reglas**, cada una con
`ruleType`, `matched`, `scoreApplied`, `disqualifying`, `detail`, `creditType`,
`ruleId`. Es el bloque más completo y el que da valor real a la mesa.
`existingCredits` también viene completo, con el avance del plan de pagos.

### 1.5 No hay una sola solicitud en revisión humana

Las 34 solicitudes están en `DISBURSED` (29), `APPROVED` (3),
`PENDING_SIGNATURE` (1) y `PENDING_SCORING` (1).

**Cero** en `UNDER_MANUAL_REVIEW`, `COMMITTEE_REVIEW` o `PENDING_DOCUMENTS`.

Los tres endpoints de decisión existen, pero **no hay contra qué probarlos**, y
la "Definición de hecho" exige e2e de aprobar / rechazar / pedir documentos. Sin
datos, esas pruebas no se pueden escribir. Es un work item de datos semilla, y
va antes que la UI de decisión.

### 1.6 El front ya llama un endpoint que no existe

`distributorsApi` pega a `GET /distributors` y `GET /distributors/{partyId}`.
El BFF **no los tiene** (404). En modo mock no se nota; en vivo, la pantalla de
distribuidores queda muerta. O se construyen en el BFF, o esa vista se apoya en
`/sales-org/units` filtrando por nivel `DISTRIBUTOR`.

### 1.7 No hay generación de tipos

`@bo/shared-types` es un `index.ts` escrito a mano. No hay script de OpenAPI ni
dependencia de generación. El BFF **sí** publica `/v3/api-docs` (OpenAPI 3.1),
accesible con token. La "Definición de hecho" pide regenerarlo — hoy eso es
trabajo de cero, no de mantenimiento.

### 1.8 Lo que el front ya tiene y sirve

No se parte de cero. `api-client` ya tiene métodos —hoy tras `isMock()`— para
portfolio, clients, executives, products y `origination/applications` +
`decision`. El `http.ts` ya maneja el 401 limpiando sesión. Falta: permissions,
sales-org, audit, `dashboard/commercial`, el detalle de solicitud, y
`request-documents` / `documents-received`.

---

## 2. Plan

Cinco fases. Las dos primeras son requisito de todo lo demás y valen días, no
semanas. Cada work item lleva **DoD verificable**.

### Fase 0 · Piso firme (bloquea todo)

| # | Work item | DoD |
|---|---|---|
| **F0-1** | Script `npm run env:up` que levante los servicios que el backoffice necesita y **reconstruya** el BFF | `curl /permissions/me` responde 200 con un token recién emitido |
| **F0-2** | Generar `@bo/shared-types` desde `/v3/api-docs` (`openapi-typescript`), con script `npm run types:gen` | `libs/shared-types/src/generated.ts` existe; `nx build` verde; los tipos escritos a mano quedan sólo para lo que el OpenAPI no cubre |
| **F0-3** | Comparar tipos generados vs escritos a mano y listar divergencias | Documento con las diferencias; ninguna sorpresa en runtime |
| **F0-4** | `useAsync` con estados `loading/empty/error` + `<Block>` que aísla fallos de panel | Un panel que revienta no tumba la pantalla (prueba de componente con fetch que rechaza) |
| **F0-5** | Traducir 403 a "fuera de alcance" y 400 de `/dashboard/commercial` a "elige una unidad" | `ApiError` distingue `FORBIDDEN_SCOPE` y `UNIT_REQUIRED`; prueba unitaria de `http.ts` |

### Fase 1 · Gating por capacidades (Módulo 3, parte read-only)

| # | Work item | DoD |
|---|---|---|
| **F1-1** | `permissionsApi.me()` + `useCapabilities()` cacheado por sesión | La nav se arma de `capabilities`, no del array de roles de `nav.ts` |
| **F1-2** | Sustituir el gating por roles de `nav.ts` por gating por capacidades | Un `EXECUTIVE` (5 capacidades) no ve Productos ni Auditoría; verificado con los 5 usuarios semilla |
| **F1-3** | `<Can capability="…">` para acciones dentro de pantalla | Los botones de decisión sólo existen con `applications.decide` |
| **F1-4** | Vista read-only de `/permissions/matrix` (12 roles × capacidades) | Sólo visible con `ADMIN`/`OPS_SUPERVISOR`; los demás no ven la entrada |

> El brief dice que la matriz de `nav.ts` y `SecurityConfig` "hay que moverlos
> juntos". Con F1-2 deja de haber dos fuentes: la nav se deriva de lo que el
> backend ya decide.

### Fase 2 · Módulo 1 — Solicitudes y mesa de análisis

**Bloqueadores de backend primero** (sin esto la mesa es una ficha vacía):

| # | Work item | Lado | DoD |
|---|---|---|---|
| **F2-B1** | Exponer `GET /api/v1/origination/prospects/{id}` en origination-service (datos capturados, domicilio, consentimientos con sello, `documents[]`) | services | El bloque `prospect` deja de venir null |
| **F2-B2** | `bureauReport` devuelve `null` cuando el downstream falla o el rol no analiza — nunca el cuerpo del error | services | Con rol sin `applications.analyze` viene null; con scoring caído, también |
| **F2-B3** | Ruta real del reporte en scoring-service (hoy "No static resource") | services | El panel de buró pinta un reporte |
| **F2-B4** | `folio` legible y `prospectName` en la fila de la bandeja; `decision` no nulo | services | La tabla se llena sin llamadas extra por fila |
| **F2-B4b** | Ampliar `q` a folio y nombre del prospecto (hoy sólo `promoterCode`) — o etiquetar la caja por lo que de verdad busca | services / front | Escribir un folio encuentra su solicitud |
| **F2-B5** | Datos semilla: al menos 2 solicitudes en `UNDER_MANUAL_REVIEW`/`COMMITTEE_REVIEW` y 1 en `PENDING_DOCUMENTS` | services | La bandeja de comité tiene filas |

**Front, una vez desbloqueado:**

| # | Work item | DoD |
|---|---|---|
| **F2-1** | Bandeja con las 9 columnas y los 6 filtros; vacío/carga/error | Filtrar por los 6 ejes devuelve resultados coherentes contra el BFF |
| **F2-2** | Bandeja de comité = filtro por estados de revisión humana | Vista guardada con `status in (UNDER_MANUAL_REVIEW, COMMITTEE_REVIEW)` |
| **F2-3** | Ficha: layout de 5 bloques con degradación por bloque | Con `prospect: null` la ficha se abre y el bloque dice "sin datos capturados" |
| **F2-4** | Panel de evaluación: score, riesgo, decisión y **tabla de `ruleDetails`** (regla, aplicada, puntos, descalificante) | Las 7 reglas se leen; las descalificantes se distinguen |
| **F2-5** | Panel de buró condicionado a `capabilities.applications.analyze` | Sin la capacidad, el panel no se monta (no basta ocultarlo con CSS) |
| **F2-6** | Panel de créditos vigentes desde `existingCredits` | Reusa la tarjeta de cartera; muestra avance de pagos y mora |
| **F2-7** | **Máquina de estados de la ficha**: read-only vs acciones | Ver tabla abajo; una prueba por caso |
| **F2-8** | Acciones: Aprobar / Rechazar (motivo obligatorio) / Pedir documentos (nota) / Documentos recibidos | Cada una refresca la ficha y deja rastro en auditoría |
| **F2-9** | Seguimiento post-aprobación (OFFER→…→DISBURSED) en solo lectura | Línea de tiempo con oferta y contrato |

**La máquina de estados, explícita** (el front refleja, no calcula):

| Estado / decisión | Qué se ve | Acciones |
|---|---|---|
| `AUTO_APPROVED` + `APPROVED` + `AUTO` | Expediente completo, solo lectura | ninguna |
| `UNDER_MANUAL_REVIEW` / `COMMITTEE_REVIEW` | Mesa completa (+ buró si analiza) | Aprobar · Rechazar · Pedir documentos |
| `REJECTED` + `decidedBy=SYSTEM` | Expediente + `rejectionReason` visible | ninguna |
| `PENDING_DOCUMENTS` | Nota de lo pedido + plazo | Documentos recibidos |
| `OFFER_PRESENTED` … `DISBURSED` | Seguimiento | ninguna |

### Fase 3 · Módulo 2 — Estructura comercial y cartera con alcance

| # | Work item | DoD |
|---|---|---|
| **F3-1** | Árbol de `sales-org` con drill-down (`/levels`, `/units`, `/children`, `/subtree`) | Se navega NACIONAL→…→DISTRIBUIDOR sin recargar |
| **F3-2** | `/dashboard/commercial?unitId=` con **403 = "fuera de tu alcance"** y 400 = "elige una unidad" | Un `EXECUTIVE` pidiendo otra unidad ve el mensaje correcto, no un error genérico |
| **F3-3** | Panel de distribuidores del subárbol (`distributorCartera[]`, conteos, principal) | Cuadra con `/portfolio?executiveId=` |
| **F3-4** | Administración de sales-org tras `salesorg.manage`: crear nivel, crear unidad, asignar/cerrar | Sin la capacidad, los formularios no se montan |
| **F3-5** | Asignación de ejecutivo: `/executives` + `POST /clients/{id}/assign-executive` | La fila de cartera muestra el ejecutivo tras asignar |
| **F3-6** | Resolver `/distributors` (§1.6): construirlo en el BFF **o** derivarlo de `/sales-org/units` nivel DISTRIBUTOR | La vista de distribuidores funciona en vivo |

### Fase 4 · Módulo 4 — Auditoría

| # | Work item | DoD |
|---|---|---|
| **F4-1** | Módulo tras `capabilities.audit.view` | Sin la capacidad no aparece en la nav |
| **F4-2** | Buscador por `actor` (pantalla principal: "qué hizo este usuario") + sujeto, agregado, tipo y rango | Los 5 filtros combinan |
| **F4-3** | Detalle con payload saneado, resaltando `***REDACTED***` | Se ve que el secreto está tapado, no ausente |
| **F4-4** | Vista de intentos de acceso (`IDENTITY_LOGIN_*`) | Filtro rápido desde la misma pantalla |

### Fase 5 · Pruebas (Definición de hecho)

| # | Work item | DoD |
|---|---|---|
| **F5-1** | Componente: los 3 desenlaces de la ficha + `PENDING_DOCUMENTS` | 4 pruebas, una por rama de la máquina de estados |
| **F5-2** | Componente: gating por capacidades | Con y sin `applications.decide` |
| **F5-3** | e2e contra el BFF real: aprobar, rechazar con motivo, pedir documentos | Depende de **F2-B5** (datos semilla) |
| **F5-4** | e2e de alcance: ejecutivo fuera de su subárbol ve "fuera de alcance" | 403 tratado como tal |
| **F5-5** | Degradación por bloque | Con `prospect: null` y buró caído, la ficha sigue usable |

---

## 3. Spikes

Los cinco del brief, con lo que el research aporta:

| Spike | Hallazgo | Estimación |
|---|---|---|
| **S-1 · RBAC editable** | Confirmado: `/permissions/matrix` es read-only y los roles son un enum. No hay endpoint de escritura. | Diseñar UI ahora tras feature flag + `isMock()`. El backend (matriz en configuration-service + maker-checker + invalidación por evento + roles dinámicos) es un proyecto propio, no un work item. |
| **S-2 · Documento no procesable** | La ficha **hoy no trae `documents[]`** (bloque `prospect` null). El flag no es lo único que falta: falta el bloque entero. | Resolver **F2-B1** primero; el flag se define después, junto con scoring. |
| **S-3 · Cartera del ejecutivo directo** | `/dashboard/commercial` trae `distributorCartera[]`; el agregado por ejecutivos del subárbol no existe. | Con el volumen actual (16 cuentas activas), fan-out acotado sobre `/portfolio?executiveId=` alcanza. Read-model por evento cuando el subárbol pase de ~50 ejecutivos. Medir antes de construir. |
| **S-4 · Pipeline** | `/dashboard/summary.pipeline` sale `[]` — confirmado en el código: `body.put("pipeline", List.of())`, línea 121 de `DashboardController`. | Endpoint nuevo en el BFF agregando por estatus en origination. Barato; ya existe el listado con filtro por estatus. |
| **S-5 · Alta de distribuidor** | Confirmado: 2 pasos manuales. Además `/distributors` no existe (§1.6). | Diseñar el flujo guiado junto con **F3-6**: son la misma vista. |

---

## 4. Orden y dependencias

```
F0 (piso) ─┬─> F1 (capacidades) ─> gating de todo lo demás
           ├─> F3 (comercial)  ── independiente, se puede paralelizar
           └─> F4 (auditoría)  ── independiente

F2-B1..B5 (backend) ─> F2 (mesa de análisis) ─> F5-3 (e2e de decisión)
```

**Ruta crítica:** F0 → F2-B1/B2/B4/B5 → F2 → F5. Los módulos 2 y 4 no dependen
de esos bloqueadores y pueden avanzar en paralelo desde que F0 y F1 estén.

**Lo que NO se debe hacer:** empezar por la UI de la mesa de análisis. Sin
`prospect` no hay expediente, sin datos en revisión no hay decisión que probar,
y se construiría contra un mock que no se parece a lo que va a llegar.
