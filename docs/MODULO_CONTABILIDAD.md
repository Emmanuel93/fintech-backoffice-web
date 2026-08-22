# Módulo de contabilidad — pólizas por sucursal y préstamo

**Repos:** `fintech-services` (dominio + BFF) · `fintech-backoffice-web` (consola)
**Objetivo:** que cada hecho económico del ciclo de vida de un préstamo —desde el alta hasta la
recuperación post-quebranto— quede en una **póliza identificable, atribuida a una sucursal y a un
préstamo**, y que eso se pueda consultar, cuadrar y facturar desde la consola.

Este documento **ajusta** el plan: contabilidad no se construye desde cero. `accounting-service` y
`invoicing-service` ya existen y funcionan. Lo que falta es la **dimensión sucursal**, el **concepto
de póliza**, el **asiento de alta del préstamo** y **toda la exposición** hacia el backoffice.

---

## 1 · Hechos verificados

Leídos en el código el 2026-08-13, no inferidos del diseño. Si alguno resulta falso, se detiene el
plan en vez de construir encima.

| Afirmación | Dónde | Estado |
|---|---|---|
| `accounting-service` lleva partida doble real: catálogo de cuentas, `posting_rules` como **dato** (no código), asientos inmutables e idempotentes por `source_event_id` | `accounting/domain`, `005-seed-catalog.sql` | ✅ Existe |
| `invoicing-service` emite CFDI con líneas que **ya traen `credit_account_id`** | `invoicing.invoice_lines` | ✅ Existe |
| El quebranto consume primero la estimación preventiva y sólo el excedente va a P&L (GL-10) | `PostingService.postWriteOffOrQuita` | ✅ Correcto |
| La provisión se asienta **por delta** contra `provision_ledger`, no por monto absoluto (GL-09) | `ProvisionPostingService` | ✅ Correcto |
| El BFF ya declara `ACCOUNTING_SERVICE_URL` e `INVOICING_SERVICE_URL` en compose… | `docker-compose.yml:606-607` | ✅ |
| …y **no existe `AccountingClient`, ni `InvoicingClient`, ni controlador, ni ruta** | `channel-backoffice-service` | ❌ Hueco |
| No hay matcher `/accounting/**` ni `/invoices/**` en el `SecurityConfig` del BFF | `SecurityConfig.java:103-154` | ⚠️ **Trampa** |
| **No existe encabezado de póliza.** `journal_entries` es una lista plana de pares débito/crédito; lo único que une dos líneas del mismo hecho es el prefijo del `source_event_id` | `003-create-journal.sql` | ❌ Hueco |
| **Ninguna tabla lleva unidad ni sucursal.** No en `accounting`, no en `credit_portfolio.credit_accounts`, no en el evento `balance-updated` | búsqueda global de `org_unit` | ❌ **Bloqueo duro** |
| `sales_org.org_units` sí existe, con `path` LTREE y `unit_assignments` append-only | `sales-org-service` | ✅ Hay de dónde |
| **El alta del préstamo no asienta nada.** La primera huella contable es la disposición del dinero | `posting_rules` seed | ❌ Hueco |
| `period` se calcula con `YearMonth.now()` **al momento de postear**, no con la fecha del hecho | `JournalEntry.post()` | ⚠️ Defecto |
| `accounting_periods` existe con `OPEN`/`CLOSED` y **ninguna línea la consulta**: se puede postear a un período cerrado | `003-create-journal.sql` | ❌ Hueco |
| `PAYMENT_APPLIED` abona **el pago completo a `1201` (cartera vigente)**, aunque liquide interés devengado que vive en `1203` | `posting_rules` seed | ❌ **Defecto contable** |
| La balanza agrega **en memoria**: `findByPeriod(period)` trae el período entero y suma en Java | `LedgerQueryService.trialBalance` | ⚠️ No escala |
| La factura es **un CFDI por party/período**, no por préstamo | `BillingService.runBilling` | ⚠️ Decisión de negocio |
| `invoicing` sólo consulta por `invoiceId` y por `partyId`. No hay listado por período, estatus ni cuenta | `InvoicingController` | ❌ Hueco |
| `journalByAccount` / `journalByParty` devuelven **listas sin paginar** | `AccountingController` | ⚠️ |
| No existe ninguna capacidad `accounting.*`; el rol `FINANCE` sí existe y hoy sólo tiene `dashboard.view`, `portfolio.view`, `salesorg.view` | `011-create-role-capabilities.sql` | ❌ Hueco |
| `1290 Estimación preventiva` está tipada `ASSET` siendo **contra-activo** (naturaleza acreedora) | `005-seed-catalog.sql` | ⚠️ Cosmético, ver §6 |

### Lo que estos hechos significan

Contabilidad **funciona** y está bien construida en lo que hace. Lo que se pide —«tracking total de
la contabilidad de cada sucursal»— no es un módulo nuevo: son **cuatro cosas que le faltan al que
ya hay**, y una de ellas bloquea a las demás.

---

## 2 · La trampa que hay que decir antes que nada

> `SecurityConfig` del BFF **no declara `/accounting/**`**. Una ruta nueva que nadie declare cae en
> el `anyRequest().authenticated()` final: **responde 200 a cualquier empleado con sesión válida**,
> sin comprobar capacidad. Un `COLLECTIONS_AGENT` vería la balanza completa de la institución.
>
> Es exactamente la trampa que ya mordió en cobranza (`/collections/**` en plural) y quedó
> documentada. Aquí es peor: el mayor contable es información financiera consolidada.
>
> **La primera línea de código de este trabajo es el matcher, no el controlador.**

---

## 3 · Las cinco decisiones

Las cinco son discutibles. Si alguna no convence cambia el alcance de un entregable entero.

### 3.1 · La sucursal se **sella** en el préstamo al activarlo; no se deriva en cada consulta

**Descartado:** resolver la sucursal en tiempo de consulta preguntando a `sales-org` por la unidad
actual del ejecutivo que lleva al cliente.

**Por qué no:** la cartera se reasigna. Si la sucursal se deriva del ejecutivo *de hoy*, mover 400
clientes de la sucursal Culiacán a la sucursal Mazatlán **reescribe retroactivamente la
contabilidad de los dos años anteriores**. La balanza de marzo cambiaría en agosto. Eso no es un
inconveniente: es que los estados financieros dejan de ser reproducibles, y es el primer hallazgo de
cualquier auditoría.

**Propuesta:** al activar la cuenta de crédito, `credit-portfolio` sella `origin_unit_id` +
`origin_unit_path` en `credit_accounts`, resueltos **una vez** contra `sales-org` a partir del
`promoter_code` que ya viaja de origination a cartera. Ese par viaja en `balance-updated` y
`accounting` lo copia en cada asiento.

**Consecuencia a aceptar:** la sucursal contable de un préstamo **no cambia nunca**, aunque el
cliente se reasigne. Es lo correcto —el ingreso se lo ganó quien lo colocó— pero hay que decirlo,
porque un gerente que reciba una cartera va a preguntar por qué su balanza no la refleja. Para eso
está la reasignación comercial, que sí es del "ahora": son dos preguntas distintas y ahora tienen
dos respuestas distintas.

**Se guarda el `path`, no sólo el id.** `MX.NORTE.MTY.SUC001` como texto permite que «la balanza de
toda la región Norte» sea un `LIKE 'MX.NORTE.%'` indexado dentro de accounting, sin llamar a
sales-org en cada consulta. El id solo obligaría a resolver el subárbol por red antes de cada
agregación, y la balanza consolidada es justo la consulta que más se pide.

### 3.2 · La póliza es un **encabezado nuevo**, no una columna más

**Descartado:** agrupar por `source_event_id` al leer y llamarle póliza a eso.

**Por qué no:** funciona para agrupar y no sirve para nada más. Una póliza tiene **folio consecutivo
por tipo, sucursal y período** —eso es lo que pide un auditor y lo que exige la contabilidad
electrónica del SAT—, tiene **estatus** (borrador, aplicada, cancelada) y tiene la invariante de que
**la suma de cargos es igual a la suma de abonos**. Un `GROUP BY` no puede llevar folio, y un folio
consecutivo derivado en tiempo de lectura cambia si mañana llega un asiento atrasado.

**Propuesta:** tabla `accounting.vouchers` (encabezado) y `journal_entries` gana `voucher_id`. El
folio es `(tipo, unidad, período, consecutivo)`, asignado en la transacción que crea la póliza.

**Consecuencia a aceptar:** el consecutivo es un punto de serialización por (tipo, unidad, período).
Con volumen alto de devengo diario esa fila es contención. Se acota con secuencia por unidad, no
global — que es también lo que hace que la sucursal Culiacán tenga sus folios 1..N sin huecos
causados por otra sucursal.

### 3.3 · El período sale de **la fecha del hecho** y se valida contra `accounting_periods`

**Descartado:** dejarlo como está (`YearMonth.now()` al postear).

**Por qué no:** el devengo del 31 de marzo que se procesa a las 00:03 del 1 de abril cae en abril.
Es un error silencioso: nadie lo ve hasta que la balanza de marzo no cuadra con el devengo de marzo,
y para entonces el período está cerrado. Además `accounting_periods` ya existe con `OPEN`/`CLOSED` y
**nadie la consulta**, así que hoy un evento atrasado escribe en un período cerrado sin resistencia.

**Propuesta:** el período sale de `occurredAt` del evento de dominio. Si ese período está `CLOSED`,
el asiento **no se rechaza** —perder el hecho es peor— sino que se postea al primer período abierto
con `original_period` conservado y bandera `is_late_posting`. Eso es lo que hace una contabilidad
real con una partida extemporánea.

**A resolver con finanzas:** si prefieren rechazo duro, es un `if` — pero entonces hace falta una
bandeja de asientos rechazados y alguien que la trabaje, o los hechos se pierden en un log.

### 3.4 · El alta del préstamo se asienta en **cuentas de orden**

**Descartado:** no asentar nada al activar (lo de hoy), o asentar la línea autorizada como cartera.

**Por qué no lo primero:** el pedido es explícito —«primero se tiene que registrar el préstamo»— y
hoy la primera huella contable de un crédito es la disposición del dinero. Un crédito autorizado y
no dispuesto **no existe en ninguna parte de la contabilidad**, y el compromiso de la institución sí
es real.

**Por qué no lo segundo:** autorizar una línea no coloca capital. Cargar `1201` contra nada infla la
cartera con dinero que no salió y descuadra el balance.

**Propuesta:** cuentas de orden, que es justamente para lo que existen.

```
7101 Líneas de crédito autorizadas   (ORDER)      cargo
7201 Líneas autorizadas por disponer (ORDER)      abono
```

Se abre el `AccountType` a `ORDER` y las cuentas de orden **se excluyen de la balanza patrimonial**
—cuadran entre sí, no contra el balance—. En la consola son una sección aparte por la misma razón.

### 3.5 · El CFDI sigue siendo **por cliente**, con desglose por préstamo

> Ésta es la única decisión donde recomiendo **no** hacer lo que la lectura literal del pedido
> sugiere, y por eso la explico entera.

**El pedido:** «la factura de cada préstamo sea a ese nivel de detalle con sus asientos contables».

**Lo que hay:** `BillingService` consolida un CFDI por party y período; las líneas ya llevan
`creditAccountId`, así que **el detalle por préstamo ya existe dentro de la factura**.

**La alternativa:** un CFDI por préstamo y período.

|  | Un CFDI por cliente (hoy) | Un CFDI por préstamo |
|---|---|---|
| Cliente con 3 créditos | 1 factura, 3 grupos de líneas | 3 facturas |
| Timbrado PAC | 1 timbre | 3 timbres — **coste por timbre** |
| Conciliación pago↔factura | El pago de un crédito no casa con una factura | 1:1, más simple |
| Cancelación de un crédito | Cancela y refactura **todo** el CFDI | Cancela sólo el suyo |
| Volumen mensual | ~1 por cliente activo | ~1 por crédito activo |

**Recomiendo conservar uno por cliente** y resolver el pedido con la trazabilidad, que es lo que de
verdad se está pidiendo: desde el préstamo se llega a su renglón de factura y a sus asientos, y
desde la factura se llega a los préstamos que la componen. La consola lo pinta agrupado por préstamo
en las dos direcciones, así que la pantalla se ve igual que si fueran facturas separadas.

**Pero es una decisión de negocio, no técnica.** Si fiscal o finanzas quieren un CFDI por préstamo,
el cambio es acotado —`runBilling` agrupa por `(partyId, creditAccountId)` en vez de por `partyId`—
y **el frontend no cambia**: ya agrupa por préstamo. Está escrito así a propósito para que la
decisión se pueda tomar después sin rehacer la pantalla.

---

## 4 · El ciclo de vida, asiento por asiento

Lo que se pidió —«primero se registra el préstamo y devengamiento a devengamiento como se va
moviendo»—. La columna **Estado** dice qué existe hoy.

| # | Hecho | Tipo de póliza | Cargo | Abono | Estado |
|---|---|---|---|---|---|
| 1 | **Alta del préstamo** (`CREDIT_ACCOUNT_ACTIVATED`) | Diario (orden) | 7101 Líneas autorizadas | 7201 Por disponer | ❌ **No existe** — §3.4 |
| 2 | **Disposición / desembolso** | Egreso | 1201 Cartera vigente | 1101 Bancos / 2101 Fondos | ✅ |
| 3 | **Comisión de apertura** | Diario | 1203 Int. y com. por cobrar | 4103 Ingresos por comisiones | ✅ |
| 4 | **IVA de la comisión** | Diario | 1203 | 2110 IVA trasladado | ✅ |
| 5 | **Devengo de interés ordinario** ← *el corazón del pedido* | Diario | 1203 | 4101 Ingresos por intereses | ✅ |
| 6 | **Devengo moratorio** | Diario | 1203 | 4102 Ingresos moratorios | ✅ |
| 7 | **Pago recibido** | Ingreso | 1101 Bancos | 1201 Cartera **← defecto, §6** | ⚠️ |
| 8 | **Devolución de pago** | Egreso | 1201 | 1101 | ✅ |
| 9 | **Estimación preventiva** (riesgo) | Diario | 5101 Gasto por estimación | 1290 Estimación preventiva | ✅ |
| 10 | **Condonación** | Diario | 5103 Gasto por condonación | 1203 | ✅ |
| 11 | **Reversa de cargo** | Diario | 4103 | 1203 | ✅ |
| 12 | **Quebranto** — consume reserva primero | Diario | 1290, excedente 5102 | 1201 | ✅ GL-10 |
| 13 | **Recuperación post-quebranto** | Ingreso | 1101 | 4104 Recuperación castigada | ✅ |
| 14 | **Liquidación / cierre** | Diario | — | — | ❌ No hay regla; cierra sin asiento propio |

De catorce pasos, **doce ya postean correctamente**. Falta el 1, hay que arreglar el 7 y decidir si
el 14 merece asiento propio o basta con que el saldo llegue a cero.

**Los tres primeros de cada préstamo son los que hacen falta para «registrar el préstamo»**: alta en
orden, disposición y comisión de apertura. Con esos tres, la ficha contable de un crédito arranca el
día que nace y no el día que alguien dispone.

---

## 5 · Entregables

Ordenados por dependencia. **C1 bloquea todo lo que se pidió por sucursal.**

```
C1 (sucursal) ──┬──> C2 (póliza) ──> C5 (BFF) ──> C7 (consola)
                └──> C3 (período)         ↑
C4 (alta + pago) ────────────────────────┘
C6 (facturas) ───────────────────────────┘
```

### C1 · La dimensión sucursal — *bloqueo duro*

Sin esto, «pólizas por sucursal» **no se puede construir**: el dato no existe en ninguna parte del
sistema. No es que esté mal expuesto; no está.

**`credit-portfolio-service`**

```sql
ALTER TABLE credit_portfolio.credit_accounts
  ADD COLUMN origin_unit_id   UUID,
  ADD COLUMN origin_unit_path TEXT,      -- MX.NORTE.MTY.SUC001
  ADD COLUMN origin_unit_code VARCHAR(40);
CREATE INDEX idx_credit_accounts_origin_unit ON credit_portfolio.credit_accounts (origin_unit_id);
```

- Se resuelven **una sola vez**, al activar la cuenta, contra `sales-org` a partir del
  `promoter_code` que ya llega de origination (`010-add-promoter-code.sql`).
- Se añaden a la carga de `credit-portfolio.balance-updated`. Es el vehículo: accounting no debe
  llamar a nadie para saber la sucursal de un asiento.
- **Backfill de lo existente.** Las cuentas activas hoy no tienen unidad. Se resuelven por el
  ejecutivo asignado en `party` al momento del backfill, y **lo que no se pueda resolver cuelga de
  un nodo `SIN_ASIGNAR` creado a propósito** — visible y molesto, para que se corrija, en vez de
  repartirlo con una heurística que nadie podrá auditar después. Mismo criterio que ya se usó en la
  migración de cartera comercial.

**`accounting-service`**

```sql
ALTER TABLE accounting.journal_entries
  ADD COLUMN org_unit_id   UUID,
  ADD COLUMN org_unit_path TEXT;
CREATE INDEX idx_journal_entries_unit_period ON accounting.journal_entries (org_unit_path text_pattern_ops, period);
```

`text_pattern_ops` no es adorno: es lo que hace que `org_unit_path LIKE 'MX.NORTE.%'` —la balanza
consolidada de una región— use el índice en vez de recorrer la tabla.

> **Qué pasa con los asientos que ya existen.** No tienen unidad y no se les puede inventar una. Se
> quedan con `org_unit_path = NULL` y la consola los agrupa bajo **«Sin sucursal»**, contados y
> visibles. Repartirlos proporcionalmente haría cuadrar la pantalla mintiendo.

### C2 · La póliza

**`accounting-service`**

```sql
CREATE TABLE accounting.vouchers (
  voucher_id     UUID         NOT NULL DEFAULT gen_random_uuid(),
  voucher_type   VARCHAR(8)   NOT NULL,   -- DIARIO | INGRESO | EGRESO
  org_unit_id    UUID,
  org_unit_path  TEXT,
  period         VARCHAR(6)   NOT NULL,   -- YYYYMM
  folio          BIGINT       NOT NULL,   -- consecutivo por (tipo, unidad, período)
  voucher_date   TIMESTAMPTZ  NOT NULL,   -- la fecha del HECHO, no la del posteo
  concept        VARCHAR(300) NOT NULL,
  source_event_id  VARCHAR(120) NOT NULL,
  trigger_event    VARCHAR(60)  NOT NULL,
  credit_account_id UUID,
  obligor_party_id  UUID,
  total_debit    NUMERIC(19,4) NOT NULL,
  total_credit   NUMERIC(19,4) NOT NULL,
  status         VARCHAR(12)  NOT NULL DEFAULT 'POSTED',  -- POSTED | CANCELLED
  is_late_posting BOOLEAN     NOT NULL DEFAULT FALSE,
  original_period VARCHAR(6),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_vouchers PRIMARY KEY (voucher_id),
  CONSTRAINT uq_vouchers_folio  UNIQUE (voucher_type, org_unit_id, period, folio),
  CONSTRAINT uq_vouchers_source UNIQUE (source_event_id),
  -- GL-01 a nivel póliza: si no cuadra, no entra. La invariante en la base, no en una prueba.
  CONSTRAINT chk_vouchers_balanced CHECK (total_debit = total_credit)
);
CREATE INDEX idx_vouchers_unit_period ON accounting.vouchers (org_unit_path text_pattern_ops, period);
CREATE INDEX idx_vouchers_account     ON accounting.vouchers (credit_account_id, voucher_date DESC);

ALTER TABLE accounting.journal_entries ADD COLUMN voucher_id UUID
  REFERENCES accounting.vouchers (voucher_id);
```

`chk_vouchers_balanced` en la base y no sólo en una prueba: una póliza descuadrada es el único error
de este servicio que no se puede corregir después sin tocar estados financieros ya publicados.

**Migración de lo existente:** una póliza por `source_event_id` distinto, con `folio` asignado por
orden de `posting_date`. Los asientos previos a C1 quedan con unidad nula y comparten la secuencia
de folios de `SIN_SUCURSAL`.

**Cancelación:** una póliza no se borra ni se edita. Cancelar emite una **póliza de reversa** que
apunta a la original (`reversal_ref`, que ya existe en `journal_entries`) y ambas quedan visibles.

### C3 · Período correcto y período cerrado

- `JournalEntry.post` deja de usar `YearMonth.now()`: recibe el `occurredAt` del evento.
- `PostingService` consulta `accounting_periods` antes de asentar. Cerrado → póliza extemporánea al
  primer período abierto, con `original_period` e `is_late_posting = true`.
- Endpoints de cierre: `POST /periods/{period}/close`, `POST /periods/{period}/reopen`, ambos sólo
  `ADMIN` o `FINANCE`, ambos auditados. Reabrir un período es la operación más delicada del módulo y
  merece rastro con actor.

### C4 · Alta del préstamo y el pago que no cuadra

**Alta** (§3.4): `AccountType` gana `ORDER`; alta de `7101`/`7201`; listener nuevo de
`credit-portfolio.account-activated`; regla `ACCOUNT_ACTIVATED → 7101 / 7201` por el monto
autorizado.

**Pago** (§6): `PAYMENT_APPLIED` deja de ser una regla de un solo par. El pago se descompone con el
delta que **ya se calcula** —`BalanceDelta` trae `principalDelta`, `interestDelta` y
`penaltyDelta` por separado y hoy se descartan usando sólo `absTotal()`— y emite **una póliza de
ingreso con tres renglones**:

```
1101 Bancos                          cargo   totalDelta
   1201 Cartera vigente                abono   principalDelta
   1203 Intereses y comisiones         abono   interestDelta
   1203 Intereses y comisiones         abono   penaltyDelta
```

Éste es el cambio que justifica por sí solo el encabezado de póliza: **un hecho con más de dos
renglones no cabe en el modelo actual.**

### C5 · Exposición en el BFF

**Primero el matcher** (§2), en `SecurityConfig`, antes que cualquier controlador:

```java
.requestMatchers(HttpMethod.POST, "/accounting/periods/**").access(requires("accounting.close"))
.requestMatchers(HttpMethod.POST, "/accounting/billing-runs").access(requires("accounting.close"))
.requestMatchers("/accounting/**").access(requires("accounting.view"))
.requestMatchers("/invoices/**").access(requires("accounting.view"))
```

**Capacidades nuevas** en `identity.capabilities` + `role_capabilities`:

| Capacidad | Qué abre | Roles sembrados |
|---|---|---|
| `accounting.view` | Resumen, pólizas, facturas, balanza | `ADMIN`, `FINANCE`, `AUDITOR` |
| `accounting.close` | Cerrar/reabrir período, corrida de facturación | `ADMIN`, `FINANCE` |

`AUDITOR` recibe `view` y **no** `close`: auditar es leer. Es la separación que hace que la
capacidad valga algo.

**`AccountingClient` + `InvoicingClient` + `AccountingController`** en el BFF, con la ruta en plural
y sin versionar, como el resto. Reenvía `X-User-Id` / `X-Roles` / `X-Channel`.

**Superficie del BFF** (todo paginado en la base, nunca en memoria):

| Método | Ruta | Devuelve |
|---|---|---|
| `GET` | `/accounting/summary?period=&unitId=` | Resumen general: cargos, abonos, cuadre, pólizas, devengado, provisión, facturado |
| `GET` | `/accounting/units?period=` | Un renglón por sucursal: pólizas, cargos, abonos, devengado, provisión — **agregado en SQL** |
| `GET` | `/accounting/vouchers?period=&unitId=&type=&creditAccountId=&partyId=&page=&size=` | Pólizas paginadas |
| `GET` | `/accounting/vouchers/{voucherId}` | Encabezado + renglones + nombres resueltos **en lote** |
| `GET` | `/accounting/accounts/{creditAccountId}/ledger` | Ficha contable del préstamo: pólizas + saldos por cuenta + facturas |
| `GET` | `/accounting/trial-balance?period=&unitId=` | Balanza, filtrable por subárbol |
| `GET` | `/accounting/periods` | Períodos con su estatus |
| `POST` | `/accounting/periods/{period}/close` · `/reopen` | Cierre contable |
| `GET` | `/invoices?period=&partyId=&creditAccountId=&status=&page=&size=` | Facturas paginadas |
| `GET` | `/invoices/{invoiceId}` | CFDI con líneas agrupables por préstamo |
| `POST` | `/accounting/billing-runs?period=` | Corrida de facturación |

**Alcance por subárbol.** `unitId` se valida contra el alcance del solicitante igual que
`/dashboard/commercial`: fuera de alcance → **403, no lista vacía**. Un 200 vacío es indistinguible
de «esa sucursal no tiene movimientos» y filtra la forma de la organización. `ADMIN`, `FINANCE` y
`AUDITOR` son transversales y alcanzan la raíz.

**Agregación en SQL, no en el BFF.** `/accounting/units` y `/trial-balance` son `GROUP BY` con
`WHERE org_unit_path LIKE :prefix`. Hoy `trialBalance` trae el período entero y suma en Java (§1);
con la cartera real eso no aguanta, y encima impide filtrar por sucursal sin traerlo todo.

### C6 · Consulta de facturas

**`invoicing-service`** — hoy sólo se puede consultar una factura si ya se conoce su id o su party.

- `GET /api/v1/invoices` con filtros por `period`, `status`, `creditAccountId`, `partyId`, paginado.
  El filtro por `creditAccountId` cruza contra `invoice_lines`, que ya lo tiene.
- Índice: `CREATE INDEX idx_invoice_lines_account ON invoicing.invoice_lines (credit_account_id);`
- `GET /api/v1/invoices/{id}/pdf|xml` — hoy no hay representación descargable. El PAC es
  `NoopPacAdapter`, así que **esto queda fuera de alcance hasta que haya PAC real**; la consola dice
  que el timbre es simulado en vez de ofrecer una descarga que no existe.

### C7 · La consola — `mfe-accounting`

Módulo nuevo en `/contabilidad`, puerto `5110`, capacidad `accounting.view`. Cuatro vistas:

1. **Resumen general** — cuadre del período (cargos = abonos), pólizas del período, devengado,
   provisión, facturado, y el desglose **por sucursal** con su participación.
2. **Pólizas** — filtrables por período, sucursal, tipo y préstamo. Detalle con los renglones y el
   total cargo/abono a la vista.
3. **Facturas** — por período y estatus, con las líneas **agrupadas por préstamo**.
4. **Balanza** — por período y sucursal, separando patrimoniales de cuentas de orden.

Construido en modo mock contra el contrato de C5, que es como se construyeron cobranza y estructura
comercial. **Ver §8 para qué muestra hoy y qué muestra cuando el backend exista.**

---

## 6 · Los dos defectos que encontré de paso

Ninguno de los dos es del alcance pedido, los dos afectan a los números que la pantalla va a mostrar.

**El pago abona todo a cartera.** `PAYMENT_APPLIED` está declarada `1101 / 1201`: el importe
completo del pago se abona a capital, incluida la parte que liquida interés devengado que vive en
`1203`. El efecto acumulado es que **`1203` crece indefinidamente y `1201` se subestima**: el
auxiliar de intereses por cobrar nunca baja aunque los clientes paguen sus intereses. Con seis meses
de operación la balanza deja de ser presentable. El arreglo está en C4 y el dato para hacerlo
—`interestDelta`, `penaltyDelta`— ya se calcula y se descarta.

**`1290` está tipada como activo.** Es un contra-activo: naturaleza acreedora. Con `balance =
débitos − créditos` aparece en negativo, que es aritméticamente correcto y contablemente confuso.
Se arregla con `AccountType.CONTRA_ASSET` y presentación con signo invertido. Es cosmético y sólo se
nota en la balanza — pero se nota justo en la pantalla que este trabajo construye.

---

## 7 · Criterios de aceptación

| Entregable | Se da por terminado cuando |
|---|---|
| **C1** | Un préstamo nuevo nace con `origin_unit_path`; la suma de las pólizas de una región **coincide** con la suma de sus sucursales; y lo que no se pudo resolver aparece contado bajo `SIN_ASIGNAR`, no repartido. |
| **C2** | Toda póliza cumple `total_debit = total_credit` **por restricción de base**; el folio de una sucursal es consecutivo y sin huecos; cancelar emite reversa y deja las dos visibles. |
| **C3** | Un devengo del 31 procesado el día 1 cae en el período del **31**; postear a un período cerrado produce póliza extemporánea con `original_period`, no una excepción silenciosa. |
| **C4** | Activar un crédito genera póliza de orden; un pago que liquida capital **e** intereses genera una póliza de tres renglones y **`1203` baja**. |
| **C5** | Un `COLLECTIONS_AGENT` recibe **403** en `/accounting/**` — *y esta prueba se escribe antes que el controlador*; pedir una sucursal fuera de alcance devuelve 403, no lista vacía; ninguna respuesta agrega en memoria. |
| **C6** | Las facturas de un préstamo se listan por `creditAccountId` sin conocer el party. |
| **C7** | El resumen cuadra contra la balanza del mismo período; desde un préstamo se llega a sus pólizas y a sus facturas, y desde una factura a los préstamos que la componen. |

---

## 8 · Estado — construido y conectado

**Entregado el 2026-08-14.** El módulo corre contra el backend real: `accounting-service`,
`invoicing-service`, `credit-portfolio-service`, `identity-service` y el BFF están modificados,
desplegados y verificados de punta a punta.

| Entregable | Estado | Dónde |
|---|---|---|
| **C1** · Dimensión sucursal | ✅ | `credit_accounts.origin_unit_code` sellado al activar; viaja en `balance-updated` y `credit-account-activated`; `accounting.vouchers.org_unit_code` |
| **C2** · La póliza | ✅ | `accounting.vouchers` con folio por (tipo, sucursal, período) y `CHECK (total_debit = total_credit)` |
| **C3** · Período del hecho y período cerrado | ✅ | `VoucherPostingService` — período desde `occurredAt` en zona contable; extemporánea al primer período abierto |
| **C4** · Alta del préstamo y pago desglosado | ✅ | Cuentas de orden 7101/7201; pago en hasta 4 renglones contra 1201/1203 |
| **C5** · Exposición en el BFF | ✅ | `/accounting/**` y `/invoices/**` con matcher propio y capacidades `accounting.view` / `accounting.close` |
| **C6** · Consulta de facturas | ✅ | `GET /invoices` paginado con filtro por `creditAccountId` a través de las líneas |
| **C7** · La consola | ✅ | `mfe-accounting` en `/contabilidad`, puerto 5110 |

### Verificado contra el entorno local

- **88 pólizas**, cuadre exacto: `531,141.52` en cargos y en abonos.
- **18 sucursales** con movimiento propio, más «Sin sucursal» con 12 pólizas de 3 créditos.
- La reconciliación selló **19 de 22** créditos y atribuyó **76 pólizas**; los 3 restantes no tienen
  ejecutivo asignado y se reportan contados, no repartidos.
- Un `COLLECTIONS_AGENT` recibe **403** en `/accounting/**`; `ADMIN`, `FINANCE` y `AUDITOR`, 200.
- 16 pruebas unitarias y de integración en verde en accounting, incluidas las tres nuevas: pago
  desglosado, alta en cuentas de orden y sello de sucursal que no se sobrescribe.

### Dos decisiones que cambiaron respecto del plan

**El alcance por subárbol viaja como lista de códigos, no como ruta materializada en accounting.**
El plan proponía `org_unit_path` con `LIKE` indexado dentro de contabilidad. En su lugar, el BFF
resuelve el subárbol contra sales-org en **una** llamada y manda los códigos como filtro. Contabilidad
no guarda una copia del árbol comercial, que habría que mantener sincronizada en dos servicios para
una consulta que ya viene acotada.

**El asiento sigue siendo un par, y la póliza lo agrupa.** El plan hablaba de renglones de un solo
lado. Un pago que liquida capital e intereses se expresa igual de bien como dos pares balanceados
—caja/intereses y caja/capital— bajo la misma póliza, y así no hubo que soltar los `NOT NULL` de las
dos cuentas, reescribir el evento `journal-entry-created` que otros consumen, ni migrar lo histórico.
Los renglones de un solo lado que muestra la consola se derivan agregando por cuenta.

### Lo que queda

- **La atribución retroactiva es un paso de la reconciliación, no un evento.** Un crédito sellado hoy
  recibe la sucursal en sus pólizas al correr `POST /accounting/backfill-origin-units`. Automatizarlo
  con un evento `origin-unit-sealed` es trabajo aparte.
- **`promoterCode` sigue siendo la única fuente del sello en la activación.** Cuando llega vacío —lo
  habitual hoy— el crédito nace sin sucursal y espera a la reconciliación.
- **Facturado sale de invoicing y se lee de la primera página.** Con más de 200 facturas en un
  período, el total del resumen se queda corto. Necesita un agregado propio en invoicing.

## 9 · Fuera de alcance, dicho a propósito

- **Timbrado real.** El PAC es `NoopPacAdapter`. Los folios fiscales que se ven no son válidos y la
  consola lo dice. Descargar PDF/XML no se construye sobre un timbre simulado.
- **Contabilidad electrónica del SAT** (catálogo, balanza y pólizas en XML mensual). El modelo de C2
  está pensado para poder generarla —folio por tipo y período es justamente lo que pide— pero el
  generador es otro trabajo.
- **Presupuesto y centros de costo.** La sucursal entra como dimensión del ingreso, no como centro
  de costo con gasto asignado. Repartir gasto operativo por sucursal es un modelo de costeo, no una
  columna.
- **Conciliación bancaria.** `1101 Bancos` se mueve por evento; nadie la contrasta contra el estado
  de cuenta real. Existe `accounting.reconciliation-alert` sin consumidor.
- **Multi-moneda.** Todo es MXN. La columna `currency` existe y siempre vale lo mismo.
