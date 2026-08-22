# Plan — Crédito de distribuidora (B2B2C)

**Repos:** `fintech-services` (dominio + canales) · `fintech-backoffice-web` (consola)
**Objetivo:** que una distribuidora reciba una línea revolvente, la disponga para colocar crédito a
sus beneficiarios, y que todo eso **conviva** con el crédito de uso propio sin bifurcar el sistema.

> Escrito el 2026-08-15. **Revisado el 2026-08-14 releyendo el código de los 24 servicios**: la
> mitad del plan original ya estaba construida y el bloqueo real resultó ser otro. Lo que cambió
> está en §2. Lo que no pude verificar está marcado **sin verificar**.

---

## 1 · Qué es este producto, y en qué se distingue

No es «un producto más del catálogo». Es una **relación de crédito de dos pisos**:

```
        Institución
             │  línea revolvente (DISTRIBUTOR_LINE)
             ▼
        Distribuidora  ──── coloca crédito a ────▶  Beneficiario
             │                                          │
             └── responde por el saldo ◀────────────────┘
```

De ahí salen las tres diferencias que gobiernan todo el diseño:

| | Uso propio | Distribuidora |
|---|---|---|
| **Quién debe** | El acreditado | La distribuidora, aunque el dinero llegue al beneficiario |
| **Forma del crédito** | Amortizable, calendario fijo | **Revolvente**: dispone, paga, vuelve a disponer |
| **Riesgo** | Del acreditado | De la distribuidora, con el beneficiario como colateral comercial |

### Todo vive en la distribuidora; del beneficiario, el expediente y su evaluación

Es la regla que gobierna el alcance de este trabajo, y conviene leerla como una lista de lo que el
beneficiario **no** es:

| Concepto | Dónde vive |
|---|---|
| La línea de crédito y su saldo | **Distribuidora** |
| La deuda con la institución | **Distribuidora** |
| La ECL y la estimación preventiva | **Distribuidora** |
| La mora, el DPD y el quebranto | **Distribuidora** |
| La comisión | **Distribuidora** |
| Reporte a buró | **Distribuidora** |
| **Expediente KYC** | **Beneficiario** |
| **Evaluación de la persona contra el producto** | **Beneficiario** |

El beneficiario es **un party con expediente y una evaluación, y nada más**. No tiene cuenta de
crédito, no acumula mora, no se le calcula ECL, no se le reporta a buró y no aparece en la cartera
ni en el mayor.

Esto no es una simplificación del modelo: es el modelo. La institución le presta a la distribuidora,
y a quién le venda ella es asunto suyo — salvo por dos cosas que sí son responsabilidad de la
institución porque es quien trata esos datos y quien pone el dinero: el expediente, y saber si esa
persona califica para ese producto.

### La evaluación sin exposición

**Se evalúa a la persona para el producto, pero la persona no queda expuesta.** Suena contradictorio
y no lo es: son dos cosas distintas que el sistema ya sabe separar.

- **Evaluar** es correr las reglas de riesgo contra el buró de esa persona y ese producto, y quedarse
  con la decisión. Eso es `scoring.prequalify` — que existe, es de sólo lectura, **no** escribe
  `score_evaluations` ni publica `scoring-completed`, y deja su resultado en
  `prequalification_snapshots` ([`ScoringEvaluationService.prequalify`](../../fintech-services/scoring-service/src/main/java/com/fintech/scoring/application/service/ScoringEvaluationService.java)).
- **Exponer** es abrir una cuenta de crédito, devengar interés y responder por un saldo. Eso no
  ocurre para el beneficiario: la colocación es una **disposición de la línea de la distribuidora**.

La consecuencia práctica es que el sistema puede decir «este beneficiario no califica» y la
distribuidora, aun así, puede decidir colocarle — porque quien responde es ella. La evaluación es
**información y rastro**, no una compuerta. Que sea compuerta o no es una decisión de producto que
todavía está abierta (§8).

**Y por eso el beneficiario no entra al árbol comercial.** Meterlo en `org_units` haría crecer el
árbol con una fila por cliente final y rompería el alcance por subárbol, que es lo que sostiene el
tablero. Su vínculo con la distribuidora vive en `party_relationships` y en la disposición.

---

## 2 · Hechos verificados — y qué cambió desde la primera versión

La primera versión de este plan daba por faltantes tres piezas que **hoy existen**. Vale la pena
decirlo con claridad porque cambia el tamaño del trabajo: el plan original pedía construir el
modelo; lo que falta ahora es **conectarlo y poder verlo**.

### 2.1 · Lo que ya está construido

| Afirmación | Dónde | Estado |
|---|---|---|
| Nivel `DISTRIBUTOR` (depth 5, bajo `EXECUTIVE`) en el árbol | `sales-org 007` | ✅ |
| `org_units.party_ref` enlaza el nodo con su party | `sales-org 007` | ✅ |
| **`party.party_roles` con vigencia + endpoints + eventos** | `party 010`, `PartyRoleController` | ✅ **ya no falta** |
| `PartyRoleType` = `DISTRIBUTOR` · `GUARANTOR` · `BENEFICIARY` | `PartyRoleType.java` | ✅ |
| `PartyType` quedó en `INDIVIDUAL` \| `BUSINESS` — sin `DISTRIBUTOR` | `PartyType.java` | ✅ **§3.1 ya aplicado** |
| Producto `DL-DIST-STD-V1` (`DISTRIBUTOR_LINE`) ACTIVE, `REVOLVING`, comité | `creditproduct 006` | ✅ |
| Capacidades del producto: `dispositionType=THIRD_PARTY_CREDIT`, `requiresBeneficiaryPartyId=true`, `hasCutoffDate=true`, `hasMinimumPayment=true`, `commissionsEnabled=true` | `creditproduct 006` | ✅ |
| Política de scoring `(DISTRIBUTOR, DISTRIBUTOR_LINE)` sembrada | `scoring 008` | ✅ |
| `sales-org` resuelve código → distribuidora: `GET /distributors/by-code/{code}` y `GET /units/{id}/distributors` | `DistributorController`, `OrgUnitService` | ✅ |
| `origination` resuelve `promoterCode` contra sales-org y **rechaza** el que no existe (CM-07 endurecido) | `RestClientPromoterResolverAdapter` | ✅ |
| `wallet` exige `beneficiaryPartyId` para `DISTRIBUTOR_LINE` (DO-03) | `DispositionOrchestrationService:46` | ✅ |
| `channel-mobile` `POST /credit/dispose` acepta `dispositionType` y `beneficiaryPartyId` | `CreditController:283` | ✅ |
| Cartera soporta `REVOLVING`: abre en cero, crece por disposiciones | `CreditAccount.create`, `resolveAmount` | ✅ |
| `credit_accounts` guarda `beneficiary_name`/`beneficiary_tax_id` y `origin_unit_code` | `creditportfolio 012`, `013` | ✅ |
| **La comisión ya devenga contra el pago, no contra la colocación** | `CommissionAccrualService:59` (CM-01) | ✅ **§6.2 verificado** |
| El BFF ya arma `distributorCartera` cruzando subárbol → `creditsByPromoters` | `DashboardController:185-232` | ✅ |
| La consola ya tiene pestaña «Distribuidores» y ficha de detalle | [mfe-clients/src/App.tsx:42](../apps/mfe-clients/src/App.tsx#L42) | ✅ |

**§3.1 y §6.2 del plan original quedaron resueltas en el código antes de que este plan se
escribiera.** No hay que hacer nada de D1 salvo probarlo.

### 2.2 · Lo que sigue faltando, y por qué

| # | Hallazgo | Dónde | Consecuencia |
|---|---|---|---|
| **G1** | `credit_product_eligible_party_types` de `DL-DIST-STD-V1` dice **sólo** `'DISTRIBUTOR'`, y `PartyType` ya no tiene ese valor | `creditproduct 006:172` | El catálogo declara elegible a un tipo de persona que no existe. **Nadie hace cumplir esa tabla** —origination no lee las reglas de elegibilidad—, así que no bloquea el journey: corrige lo que el producto *dice*, no lo que el sistema *impide* |
| **G2** | La política de scoring está sembrada contra `prospect_type='DISTRIBUTOR'`; si la distribuidora es `INDIVIDUAL`/`BUSINESS` + rol, `findActiveBy` no encuentra nada | `scoring 008:75`, `ScoringEvaluationService:68` | La solicitud se queda sin decisión y **nunca avanza** — se omite con un `warn`, no falla |
| **G3** | `StartCreditApplicationRequest` **no tiene** `promoterCode`; sólo lo lleva el camino Kafka desde `channels` | `StartCreditApplicationRequest.java`, `CreateApplicationRequest.java` | Un crédito originado por REST **nunca se atribuye**: sin comisión, y `distributorCartera` sale vacío aunque haya nodos |
| **G4** | `account.sealOriginUnit(cmd.promoterCode())` sella el **código de promotor** en `origin_unit_code`, que la migración 013 define como la **sucursal** | `CreditAccountService.java:167` | Contabilidad atribuye por sucursal usando un UUID de distribuidora. Cabe en `VARCHAR(40)`, así que **falla en silencio** |
| **G5** | El DPD sale de `installments` vencidas; una revolvente no tiene installments | `DelinquencyAccountProcessor:34-44` | Una distribuidora **siempre está en DPD 0** → STAGE_1 → sin ECL, sin caso de cobranza, sin quebranto |
| **G6** | No existe entidad de **corte** ni de **pago mínimo**. `hasCutoffDate`/`hasMinimumPayment` son banderas que nadie consume; `minimumPayment` está declarado en la respuesta y no lo calcula nadie | `CreditAccountResponse:49` | Es la causa raíz de G5: sin corte no hay fecha desde la cual contar |
| **G7** | `party_relationships` tiene tabla, entidad y repositorio — **no tiene servicio ni controlador** | `party 006` + `PartyRelationship.java` | El vínculo beneficiario↔distribuidora **no se puede crear por API**. Es justo el rastro que pide A13 |
| **G8** | `channel-mobile` no conoce a la distribuidora: `OnboardingController` es autoservicio de persona física, no hay alta de beneficiario por un tercero, ni regla de alcance | búsqueda global | **No hay por dónde entrar.** Sigue siendo el bloqueo, ahora acotado |
| **G9** | La consola llama `GET /distributors` y `GET /distributors/{partyId}`; **el BFF no expone esas rutas** | [endpoints.ts:256](../libs/api-client/src/lib/endpoints.ts#L256) vs. rutas del BFF | La pestaña «Distribuidores» funciona en mock y **da 404 contra el gateway real** |
| **G10** | Ninguna siembra crea distribuidoras: `seed-sales-org.py` llega a ejecutivo, `seed-portfolio.py` sólo pondera `PERSONAL_LOAN`/`PAYROLL_LOAN`/`SME_LOAN` | `scripts/` | 0 nodos `DISTRIBUTOR`, 0 líneas colocadas |

### El bloqueo, redefinido

El plan original decía «no hay forma de originar un crédito de distribuidora» y lo atribuía al canal
móvil. Es cierto (**G8**), pero incompleto: aunque mañana existiera el journey, **G2 lo dejaría sin
decisión de scoring y G3 lo desatribuiría al activarse**. Un campo de DTO y una llave de búsqueda, y
sin ellos el journey no sirve de nada.

Eso reordena el trabajo: **primero se destraba el camino existente (G1–G4, barato), luego se
construye lo que falta (G5–G8, caro), y la consola (G9) va en paralelo.**

---

## 2.bis · Estado de ejecución — 2026-08-14

Autorizado el destrabe (pasos 1–3) y, sobre la marcha, **D5 y la siembra**, porque «una distribuidora
en mora» no es sembrable sin cortes. Lo hecho:

| | Qué se hizo | Dónde |
|---|---|---|
| **G1** ✅ | `DL-DIST-STD-V1` elegible para `INDIVIDUAL` + `BUSINESS` + `DISTRIBUTOR` | `creditproduct 013` |
| **G2** ✅ | `scoring_policies` re-llaveada por producto; `prospect_type` pasa a descriptivo y opcional; sembrada la política que faltaba de `BUSINESS_REVOLVING_LINE` | `scoring 013` + 6 archivos |
| **G3** ✅ | `promoterCode` en `StartCreditApplicationRequest` y `CreateApplicationRequest`, propagado al comando | origination · channel-mobile |
| **G4** ✅ | `CreateCreditAccountCommand.originUnitCode` separado de `promoterCode`; deja de sellarse el promotor como sucursal | `CreditAccountService` |
| **G7** ✅ | `party_relationships` con servicio, controlador y las dos direcciones de consulta | party (6 archivos nuevos) |
| **G9** ✅ | `GET /distributors` y `/distributors/{partyId}` en el BFF, componiendo sales-org + party + commission + cartera | `DistributorsController` |
| **D5** ✅ | Calendario **por disposición** (`scheduleId = dispositionId`), `termPeriods` propagado por la cadena, `DelinquencyAccountProcessor` bifurcado, invariante beneficiario≠obligor, plazos y amortización francesa sembrados en los dos revolventes que no los tenían | credit-portfolio · wallet · channel-mobile · credit-product |
| **D6** ✅ | `seed-distribuidoras.py` y `verifica-distribuidoras.py`, enganchados a `reinicia-y-siembra.sh` | `scripts/` |

**Pruebas:** 658 en los nueve servicios tocados, 0 fallos. Nuevas: `StatementServiceTest` (14 · A8),
`PartyRelationshipServiceTest` (7 · A13), y los casos de A18 y A19 sobre los dos defectos
corregidos — el promotor que se perdía al entrar por REST y la sucursal que se sellaba con él.

**Tres hallazgos aparecieron al ejecutar**, ninguno previsto en el análisis:

- **`BUSINESS_REVOLVING_LINE` no tenía política de scoring.** Producto ACTIVE en el catálogo con el
  mismo síntoma que la línea de distribuidora, en algo que nadie había pedido todavía. Sembrado.
- **El daño de G4 era irreparable, no sólo incorrecto.** El trabajo de reconciliación del BFF salta
  toda cuenta que ya tenga `originUnitCode` —con razón, un sello ocurre una vez—, así que el único
  mecanismo capaz de arreglar la atribución daba por bueno el UUID del promotor. Ver §3.5.
- **El agujero del DPD no era de distribuidoras: era de todo lo revolvente.** Los cuatro productos
  con `hasAmortizationSchedule: false` —tarjeta, revolvente personal, línea de distribuidora y
  revolvente empresarial— no podían mostrar mora nunca. Se notó aquí porque era lo que se estaba
  mirando.

**Y una corrección de modelo**, hecha sobre la marcha a indicación del usuario: la mora de una
revolvente no sale de un corte sino del **calendario de cada disposición**. Se retiró el mecanismo
de cortes que se había construido y se implementó éste, que reutiliza el motor de amortización que
ya existía. Ver §3.3.

### 2.ter · El hallazgo más incómodo: una persona, dos identificadores

Salió al sembrar, no al leer, y afecta a todo el sistema — no sólo a las distribuidoras.

**`credit_portfolio.credit_accounts.obligor_party_id` no guarda el `partyId`: guarda el
`prospectId`.** Comprobado contra la base sembrada: de 22 cuentas, **0 casan** por `party_id` y
**22** por `prospect_id`.

Así que una persona arrastra dos claves y cada dominio habla en una:

| Habla en `prospectId` | Habla en `partyId` |
|---|---|
| `credit_accounts.obligor_party_id` | `party.parties` |
| `commission.credit_promoter_assignments.beneficiary_party_id` | `party.party_roles` |
| `org_units.party_ref` (para que cruce con lo anterior) | `party.party_relationships` |
| El sujeto del JWT móvil (`X-User-Id`) | |

El repo **ya lo sabe** —`GET /parties/batch?by=prospectId` existe, con el comentario «cartera y
otros read models guardan el prospectId como obligado»—, pero no está escrito en ningún plan y no
hay nada que lo haga cumplir. El modo de fallar es siempre el mismo y siempre silencioso: se pasa
una clave donde iba la otra, la consulta devuelve vacío en vez de error, y la pantalla enseña un
cero que parece un dato.

> **Y le quita el filo a una regla nueva.** La invariante «el beneficiario no puede ser el
> acreditado» (§3.3.bis) compara `beneficiaryPartyId` contra `obligorPartyId`. Si quien llama manda
> el `partyId` del expediente y la cuenta guarda el `prospectId`, **la comparación nunca coincide y
> la regla nunca salta**. Una regla que no puede fallar no protege nada. Hoy se sostiene por
> convención —el canal manda el mismo identificador que la cuenta—, no por construcción.

**Qué haría falta**, y no cabe en este trabajo: o unificar la identidad, o hacer explícito en cada
firma cuál de las dos claves se espera —tipos distintos, no `UUID` a secas, que es lo que permite
pasar una por otra sin que el compilador diga nada—. Mientras tanto, la regla práctica es la de la
tabla de arriba, y conviene repetirla en cualquier código nuevo que cruce dominios.

> No confundir con `docs/PROMPT_AUDITORIA_IDENTIDAD.md`, que trata otra cosa: que la bitácora
> registra el id del actor pero casi nunca su nombre (57 % de las entradas sin `actor_name`).

---

## 3 · Decisiones de diseño

### 3.1 · Un distribuidor es un **rol**, no un tercer tipo de party ✅ implementado

Es la invariante I‑03. Ya está en el código: `party.party_roles` con `role_type`, `active`,
`granted_at`/`revoked_at`, índice único parcial sobre las filas vigentes, y eventos
`party.role-granted`/`role-revoked`. `PartyType` quedó en `INDIVIDUAL` | `BUSINESS`.

**Descartado en su momento:** `partyType = DISTRIBUTOR`. Una persona física que además distribuye
**no deja de ser** `INDIVIDUAL`: sigue teniendo su CURP, su expediente y su tratamiento regulatorio.

**Lo que quedó pendiente de esa decisión** es el arrastre en dos catálogos que nadie migró: la
elegibilidad del producto (**G1**) y la política de scoring (**G2**) siguen hablando de un
`DISTRIBUTOR` que ya no existe como tipo. Es exactamente la clase de residuo que deja una migración
de modelo bien hecha en un servicio y no propagada a los demás.

> **Decisión tomada (2026-08-14) — la política de scoring se llavea por producto, no por tipo de
> persona.** Ninguna de las dos opciones que estaban sobre la mesa: el tipo de persona sale de la
> llave por completo.
>
> **Por qué se puede.** Se verificó contra las tres siembras (`007`, `008`, `010`): **ningún
> `product_type` aparece hoy bajo dos `prospect_type` distintos**. La llave
> `(prospect_type, product_type_intent)` es redundante — `prospect_type` no discrimina nada, sólo
> obliga a que quien pregunta acierte el valor, y ése es exactamente el modo en que G2 falla.
>
> **Por qué es lo correcto, no sólo lo barato.** Lo que cambia las reglas de riesgo no es qué es el
> solicitante, sino **qué producto pide y en qué modalidad se usa**. Y esa modalidad ya está
> declarada en el catálogo: `capabilities.dispositionType` ∈ `SELF_USE` (uso propio) ·
> `THIRD_PARTY_CREDIT` (distribución) · `PAYROLL`. `DL-DIST-STD-V1` ya está marcado
> `THIRD_PARTY_CREDIT`; los demás, `SELF_USE`. **No hay parámetro nuevo que inventar.**
>
> Con eso, «la política, los límites y lo demás se definen en el producto» deja de ser una
> aspiración: los montos, los límites de línea, las tasas por tramo, el plazo y el flujo de
> aprobación ya viven en `credit_product_definitions`, y ahora la política de scoring se busca por
> la misma llave que todo lo demás.
>
> **Hallazgo colateral:** `BUSINESS_REVOLVING_LINE` está ACTIVE en el catálogo y **no tiene ninguna
> política sembrada** — el mismo síntoma de G2, en un producto que nadie había mirado. Se siembra
> junto con la corrección.
>
> `ProspectType.DISTRIBUTOR` se queda en `origination`: ahí no describe una identidad sino con qué
> intención llega alguien a pedir, y ya no gobierna ninguna búsqueda.

### 3.2 · La distribuidora es un nodo del árbol; el beneficiario no ✅ implementado

La distribuidora cuelga de su ejecutivo (`DISTRIBUTOR`, depth 5) con `party_ref` a su party. Eso le
da alcance, tablero y **atribución contable por sucursal** sin ninguna pieza nueva: hereda la rama de
su ejecutivo. El invariante `padre.depth = hijo.depth − 1` ya obliga a que sólo cuelgue de un
`EXECUTIVE`.

El beneficiario **no entra al árbol**. Su vínculo con la distribuidora vive en `party_relationships`
(que hay que exponer, **G7**) y en la disposición.

### 3.3 · La mora de una revolvente: **cada disposición amortiza**

**El agujero, con su mecanismo exacto.** `DelinquencyAccountProcessor` pedía
`findPendingOverdueByScheduleId(account.getCreditAccountId(), …)` y contaba días desde la cuota
vencida más antigua. Un producto con `hasAmortizationSchedule: false` **nunca escribe una sola fila
en `installments`** — el guardia de `CreditAccountService` no dispara. Resultado: `days = 0`
siempre, `DelinquencyStatusUpdated(0)`, `RiskProfile` en STAGE_1, sin provisión, sin caso en
cobranza y sin quebranto posible.

> **No era un problema de distribuidoras.** Son los **cuatro productos revolventes** del catálogo:
> `CREDIT_CARD`, `REVOLVING_LINE`, `DISTRIBUTOR_LINE` y `BUSINESS_REVOLVING_LINE`. Ninguno podía
> mostrar mora nunca. El cero no era una medición: era una constante.

**La solución — corregida el 2026-08-14 sobre el modelo del negocio.** Una línea revolvente no se
amortiza; **se amortiza cada disposición**, a su propio plazo. Es la mecánica de una tarjeta con
compras a meses: la línea vive, cada compra tiene su calendario. El dueño de la cuenta sigue siendo
uno solo —la distribuidora—; lo que cambia por colocación es a quién se le colocó y a cuántos meses.

```
credit_accounts (la línea, REVOLVING)          ← la distribuidora es el obligor
  └── dispositions (una por colocación)        ← beneficiary_party_id: a quién se le colocó
        └── installments (scheduleId = dispositionId)   ← su calendario, a su plazo
```

Y `DelinquencyAccountProcessor` se bifurca por **dónde viven las cuotas**, no por otro criterio:
un amortizable las busca en el calendario de la cuenta; una revolvente, en los de todas sus
disposiciones. El criterio es el mismo para ambos —días desde la cuota vencida más antigua—.

**Lo que esto descarta, y por qué.** La primera versión de este plan proponía una tabla de cortes
(`statements`) con saldo, pago mínimo y fecha de vencimiento. Se construyó y **se retiró**: era un
mecanismo nuevo para un problema que el sistema ya sabía resolver con el motor de amortización que
lleva construido desde el principio. Dos formas de medir la misma mora, conviviendo, es exactamente
lo que hace que dentro de un año nadie sepa cuál manda.

**Dos piezas ya estaban modeladas y sin usar**, lo que confirma que ésta era la forma prevista:
`Disposition.beneficiaryPartyId` («only for THIRD_PARTY_CREDIT», DE-02) e `Installment.scheduleId`,
que es un UUID libre y no una llave foránea a la cuenta.

### 3.3.bis · El beneficiario no puede ser el distribuidor

Si lo fuera no habría colocación: sería la distribuidora usando su línea para sí misma, y eso es un
crédito de **uso propio** —con su producto, su expediente y su riesgo—, no una venta a un cliente
final. Sin la regla, alguien podría cobrarse comisión por prestarse a sí mismo.

Se corta en dos capas a propósito: `DO-04` en wallet, para que el rechazo llegue como respuesta a
quien lo pidió, y `BENEFICIARY_CANNOT_BE_OBLIGOR` en cartera, para que tampoco entre por Kafka.

### 3.4 · Convivencia: una sola cartera, un solo mayor

Nada se bifurca. El crédito de distribuidora es una cuenta más en `credit_accounts` con
`product_behavior = REVOLVING`, sus colocaciones en `dispositions`, y sus pólizas en el mismo mayor
con las mismas cuentas. Lo único que cambia es **quién responde** y **cómo se mide la mora**.

Un módulo aparte para distribuidoras produciría dos carteras que no suman y dos balanzas que no
cuadran entre sí.

### 3.5 · `origin_unit_code` no es `promoterCode` — hay que separarlos

**G4 es un defecto, no una decisión.** La migración 013 documenta con cuidado por qué la sucursal se
sella una vez y no se recalcula, y luego el servicio la sella con el código de promotor. Como el
`promoterCode` que hoy llega es un UUID de 36 caracteres y la columna es `VARCHAR(40)`, **no truena**:
escribe un dato equivocado que contabilidad consume como si fuera una sucursal
(`CreditAccountActivatedListener`, `BalanceUpdatedListener` de `accounting`).

**Y el daño se vuelve permanente**, que es lo que lo convierte en urgente. El BFF tiene un trabajo de
reconciliación que resuelve la sucursal de cada crédito contra sales-org
([`AccountingController`](../../fintech-services/channel-backoffice-service/src/main/java/com/fintech/channelbackoffice/infrastructure/adapter/in/api/AccountingController.java)),
y **salta cualquier cuenta que ya tenga `originUnitCode`** — con razón: un sello es un hecho que
ocurre una vez. Como el crédito de distribuidora llega ya «sellado» con el UUID del promotor, el
único mecanismo que podría repararlo lo da por bueno y le atribuye pólizas a una sucursal que no
existe.

**La corrección, en dos tiempos.** Ahora mismo: `CreateCreditAccountCommand` gana un
`originUnitCode` propio y `CreditAccountService` sella **eso**, nunca `promoterCode`. Con eso el
crédito de distribuidora se comporta como cualquier otro —llega sin sellar— y el trabajo de
reconciliación vuelve a poder repararlo.

> Vale decir qué **no** arregla ese primer tiempo, para no dejarlo como deuda invisible. La
> migración 013 quería que la póliza de alta ya llevara la sucursal. Eso **hoy no se cumple para
> ningún crédito**: el sello sólo se disparaba cuando había `promoterCode`, así que el 95 % de la
> cartera —la que no tiene promotor— ya nacía sin sucursal y dependía del trabajo de reconciliación.
> Sellar la sucursal de verdad en el alta exige que alguien la resuelva antes de activar (sales-org
> no expone hoy «sucursal de este party»), y eso es trabajo de D4, no del destrabe. Queda anotado
> en §8, no silenciado.

---

## 4 · Entregables

```
D0 (destrabe) ──┬──> D3 (journey) ──> D5 (mora revolvente) ──> D6 (siembra) ──> D7 (pruebas)
D2 (árbol)   ───┘         │
D1 (roles) ✅ ────────────┘
D4 (consola) ── independiente ─────────────────────────────────┘
```

### D0 · Destrabe — lo barato que hoy detiene todo lo demás

Cuatro correcciones, ninguna de diseño. Van primero porque sin ellas D3 no puede funcionar aunque se
construya entero.

- **G1** — migración de `credit-product`: `eligible_party_types` de `DL-DIST-STD-V1` pasa de
  `DISTRIBUTOR` a `INDIVIDUAL` + `BUSINESS`, y la regla `REQUIRED_PARTY_TYPE`, si se agrega, va
  contra el rol y no contra el tipo.
- **G2** — re-llavear `scoring_policies` por `product_type_intent` (§3.1): se retira `prospect_type`
  de la llave y del índice único, se ajusta `findActiveBy` y sus llamadores, y se siembra la política
  faltante de `BUSINESS_REVOLVING_LINE`. La modalidad de uso la sigue declarando el producto en
  `capabilities.dispositionType`.
- **G3** — `promoterCode` en `StartCreditApplicationRequest` (origination) y en
  `CreateApplicationRequest` (channel-mobile), propagado al comando. El resto de la cadena ya lo
  lleva.
- **G4** — separar `originUnitCode` de `promoterCode` en `CreditAccountService`, resolviendo la
  sucursal contra sales-org antes de sellar.

### D1 · `party-service` — roles de party ✅ **hecho**

Nada que construir. Queda **probarlo** (A1, A2 en D7) y una pieza suelta:

- **G7** — exponer `party_relationships` por API: `POST /parties/{id}/relationships`,
  `GET /parties/{id}/relationships`, baja lógica. Es el vínculo beneficiario↔distribuidora y el
  rastro de quién capturó el expediente.

### D2 · `sales-org` — la distribuidora en el árbol ✅ **hecho, sin poblar**

El nivel, el `party_ref`, la resolución por código y el alcance por subárbol están. Falta **crear
nodos**, que es D6. El reparto de cartera no cambia: la distribuidora hereda la rama.

### D3 · `channel-mobile` — el journey B2B2C · **el grueso**

Tres flujos nuevos, ninguno de los cuales existe hoy:

1. **Alta de distribuidora** — prospecto + rol `DISTRIBUTOR` en party + nodo en sales-org + solicitud
   contra `DISTRIBUTOR_LINE`. Los cuatro pasos existen por separado; falta el que los orquesta.
2. **Alta de beneficiario bajo la distribuidora** — la distribuidora autenticada da de alta al
   cliente final: party + KYC + `party_relationships(BENEFICIARY)` + rol `BENEFICIARY`, **y su
   evaluación** (`prequalify` contra `DISTRIBUTOR_LINE`), guardada como información, no como
   compuerta.
3. **Colocación** — `POST /credit/dispose` con `dispositionType=THIRD_PARTY_CREDIT` y
   `beneficiaryPartyId`. Esto **ya funciona**; lo que falta es que sólo la distribuidora dueña de la
   línea pueda llamarlo por ese beneficiario.

> **Autorización.** Una distribuidora sólo puede ver y colocar sobre **sus** beneficiarios. Es una
> regla de alcance nueva en el canal móvil, que hoy sólo conoce «el dueño de la sesión»
> (`resolvePrimaryCreditAccountId` resuelve por `X-User-Id` y toma `accounts.get(0)`). Sin ella,
> cualquier distribuidora podría consultar la cartera de otra. **Es A5 y no es negociable.**

### D4 · Consola — la vista que hoy sale vacía o rota

- **G9** — el BFF necesita `GET /distributors` y `GET /distributors/{partyId}`. La consola ya los
  llama y ya sabe pintarlos; contra el gateway real dan 404.
- `distributorCartera` deja de salir vacío con D6, sin tocar el front.
- Ficha de distribuidora: su línea, lo dispuesto, **sus beneficiarios con la evaluación de cada uno**,
  y su propio DPD (que existe sólo después de D5).

### D5 · Mora de revolvente

Calendario de amortización **por disposición** (§3.3), `termPeriods` propagado por la cadena
(canal móvil → wallet → Kafka → cartera), y la bifurcación en `DelinquencyAccountProcessor`. Es lo
que habilita DPD 30/60/90, estimación preventiva, caso de cobranza y quebranto para distribuidoras
— es decir, **todos los estatus que la siembra tiene que producir**— y, de paso, para los otros tres
productos revolventes del catálogo, que tenían el mismo agujero.

### D6 · Siembra — reinicio completo, 10 distribuidoras × 10 colocaciones

Ver §6, que es donde está el detalle y la reconciliación con el modelo de una sola cuenta.

### D7 · Pruebas

Ver §7.

---

## 5 · Las decisiones de negocio

### 5.1 · La distribuidora responde por el **saldo íntegro**

Sin recurso parcial ni garantía del beneficiario. Consecuencias, todas simplificadoras:

- **Hay una sola cuenta de crédito por distribuidora**, no una por beneficiario. La línea revolvente
  es el crédito; colocar es **disponer** de ella.
- **La exposición y la estimación preventiva se calculan sobre la distribuidora**, no sobre diez
  beneficiarios. `risk` no necesita conocerlos: una sola cuenta, un solo cálculo de ECL.
- **El beneficiario no es deudor de la institución.** No entra a la cartera ni al mayor, no se le
  calcula ECL y no se le reporta a buró.

> **Lo que esto obliga a no hacer.** Si el beneficiario no debe, no se le puede reportar a buró ni
> gestionar en cobranza como acreditado. Quien cae en mora es la distribuidora. Cobranza persigue a
> una, no a diez, y eso cambia la forma de la bandeja.

### 5.2 · La comisión se devenga **por cobranza**, no por colocación ✅ verificado

Estaba marcado «sin verificar». Ya no: `CommissionAccrualService` sólo devenga con
`triggerEvent = PAYMENT_APPLIED` y una **caída real** de `accruedInterestBalance`; los `CHARGE_*`
nunca devengan (CM-01). El tipo es `DISTRIBUTOR_INTEREST_SHARE` y la política sembrada para
`DISTRIBUTOR_LINE` es 0.30 del interés cobrado.

- **Contablemente cambia el momento, no las cuentas**: `5104 Gasto por comisiones / 2120 Comisiones
  por pagar` se asienta al cobrar.
- **Alinea el incentivo con la recuperación**, y hace que una distribuidora morosa deje de acumular
  comisión sola, sin ninguna regla que lo impida.

**No hay trabajo aquí.** Sólo la prueba A12.

### 5.3 · Del beneficiario, el expediente **y su evaluación** — y lo captura la distribuidora

Aquí es donde esta revisión amplía el plan original, siguiendo lo que se pidió: *«el beneficiario del
crédito se trackea por KYC, y se evalúa a la persona para el producto»*.

- El beneficiario es un **party con expediente completo, un rol `BENEFICIARY`, una relación con su
  distribuidora, y una precalificación contra `DISTRIBUTOR_LINE`**. Nada más.
- La evaluación usa `prequalify`, que **no** abre expediente de riesgo ni publica decisión: es
  lectura sobre el motor de reglas con un snapshot cacheado. Es exactamente la herramienta para
  «evaluar sin exponer».
- El journey de D3 se ordena: sesión de la distribuidora → alta del beneficiario con su KYC →
  evaluación → colocación. **No hay auto-alta del beneficiario**, así que no hace falta OTP ni
  onboarding propio para él.
- **Quién capturó queda en el expediente**, vía `party_relationships` (G7). Sin ese rastro no hay a
  quién preguntarle por un documento mal tomado.

> **Lo que esto abre.** Si la distribuidora captura el KYC y consulta el buró de alguien que no es
> cliente de la institución, el consentimiento y el tratamiento de datos son de la institución.
> **Confirmar con cumplimiento antes de D3** — no es una decisión de arquitectura. Con la evaluación
> incluida esto pesa más que antes: consultar buró exige consentimiento firmado del evaluado.

---

## 6 · Siembra — reinicio completo y 10 distribuidoras

### 6.1 · Qué significa «10 distribuidoras con 10 créditos en distintos estatus»

Hay que reconciliarlo con §5.1, porque las dos cosas no pueden ser ciertas a la vez si «crédito»
significa «cuenta de crédito»:

> **Una distribuidora = una cuenta de crédito (su línea). Diez «créditos» = diez colocaciones,
> es decir diez disposiciones a diez beneficiarios distintos.**

Si se sembraran 100 cuentas de crédito, el producto estaría bifurcado y A11 fallaría. Así que los
«distintos estatus» viven en **dos planos**, y la siembra tiene que producir los dos:

**Plano 1 — estatus de la línea (10 distribuidoras, una cada una):**

| # | Estado de la línea | Cómo se produce |
|---|---|---|
| 1–2 | **Al corriente**, con disponible | coloca y paga cada corte |
| 3 | **Al corriente, línea agotada** | coloca hasta el límite |
| 4 | **DPD 30** | un corte impago |
| 5 | **DPD 60** | dos cortes impagos |
| 6 | **DPD 90+ / STAGE_3** | tres cortes impagos |
| 7 | **En cobranza con promesa de pago** | caso + `payment-promise-made` |
| 8 | **Reestructurada** (convenio ejecutado) | `collections.agreement-executed` |
| 9 | **Quebrantada** | `write-off-executed` |
| 10 | **Aprobada sin disponer** | línea activa, saldo cero |

**Plano 2 — estatus de la colocación (10 por distribuidora):** solicitada · evaluada-aprobada ·
evaluada-rechazada (colocada igual, porque quien responde es la distribuidora) · disposición en
proceso · dispuesta · dispuesta y pagada · dispuesta parcialmente pagada · en atraso · liquidada ·
cancelada antes de disponer.

Los estados de los planos 4–9 **dependen de D5**: sin cortes no hay DPD, y sin DPD no hay estimación,
ni caso de cobranza, ni quebranto. Esa es la razón de que la siembra vaya después.

### 6.2 · Cómo se siembra: por los endpoints, no por `INSERT`

Es la regla que ya rige `seed-portfolio.py` y que hace que la data valga: *«cada cliente pasa por el
canal igual que lo haría desde el teléfono; si un endpoint no acepta lo que le mandamos aquí, tampoco
lo aceptaría la app»*. Se mantiene.

Sembrar antes de D3 exigiría inserciones directas, y eso produce estados que el dominio no genera:
una distribuidora sin rol, un beneficiario sin vínculo, una revolvente con calendario. Es exactamente
el tipo de dato que hace confiar en una pantalla que miente.

### 6.3 · Guion del reinicio

`scripts/reinicia-y-siembra.sh` ya borra volúmenes, levanta el stack, espera al gateway y encadena
los seeds. Se le agregan dos pasos y se toca un tercero:

```
  … estructura comercial (4 regiones, 8 zonas, 22 sucursales, 52 ejecutivos)
  … un responsable por nivel
  … roles funcionales del acceso rápido
+ … 10 distribuidoras: party + rol DISTRIBUTOR + nodo depth 5 + línea aprobada
  … clientes, solicitudes y cartera por el journey real
+ … 100 beneficiarios: KYC capturado por su distribuidora + evaluación + colocación
  … documentos del expediente
  … ciclo de vida: devengo, pagos, mora, promesas, reestructuras y quebrantos
+     (extendido: cortes de revolvente, pagos mínimos y mora de línea)
  … navegación por nivel comercial para la bitácora
  … verificación de identidad en la bitácora
+ … verificación de la siembra de distribuidoras
```

- **`scripts/seed-distribuidoras.py`** (nuevo) — las 10 distribuidoras y sus 100 beneficiarios,
  repartidas entre ejecutivos de sucursales distintas para que el alcance por subárbol se pueda
  probar de verdad (una región sin ninguna, para que se vea el cero legítimo).
- **`scripts/seed-ciclo-credito.py`** (extendido) — genera cortes, aplica pagos mínimos y deja las
  líneas en los estados del plano 1.
- **`scripts/verifica-distribuidoras.py`** (nuevo) — mismo patrón que
  `verifica-identidad-auditoria.py`: comprueba contra la API que quedó lo que se quería, y falla
  ruidosamente si no. Una siembra que no se verifica es una siembra en la que no se puede confiar.

Parámetros: `--distribuidoras 10 --beneficiarios 10`, con los mismos defaults que el pedido.

---

## 7 · Pruebas

Escritas como pruebas, no como intenciones. **Las marcadas ✅ ya deberían pasar hoy** y sólo hay que
escribirlas; el resto necesita su entregable.

### 7.1 · Aceptación de dominio

| # | Prueba | Servicio | Depende de |
|---|---|---|---|
| **A1** | Una persona física con rol `DISTRIBUTOR` conserva `partyType = INDIVIDUAL` y su expediente KYC | party | ✅ |
| **A2** | Revocar el rol deja el histórico: se puede responder quién distribuía en una fecha pasada | party | ✅ |
| **A3** | Un nodo `DISTRIBUTOR` sólo cuelga de un `EXECUTIVE` — colgarlo de una sucursal es 422 | sales-org | ✅ |
| **A4** | La cartera de una distribuidora se atribuye a la **sucursal de su ejecutivo**, sin regla nueva | accounting | D0-G4 |
| **A5** | Una distribuidora **no** puede consultar ni colocar sobre beneficiarios de otra: 403, no lista vacía | channel-mobile | D3 |
| **A6** | Una disposición a beneficiario reduce el disponible de la línea y **no** crea una cuenta nueva | credit-portfolio | ✅ |
| **A7** | La comisión se atribuye al party de la distribuidora vía `promoterCode` | commission | D0-G3 |
| **A8** | Una colocación con cuotas vencidas acumula DPD en la línea; cubiertas, vuelve a 0 | credit-portfolio | ✅ **escrita** — `CreditAccountServiceTest`, calendario por disposición |
| **A23** | Una colocación genera su calendario a su plazo; sin plazo, cae al del producto | credit-portfolio | ✅ **escrita** |
| **A24** | El beneficiario **no puede ser** el propio distribuidor: la disposición se rechaza | wallet · credit-portfolio | ✅ **escrita** |
| **A9** | El quebranto de una distribuidora consume su estimación antes que resultados, igual que el resto | accounting | D5 |
| **A10** | La balanza **no cambia de forma**: mismas cuentas, mismo cuadre, con y sin distribuidoras | accounting | D6 |
| **A11** | Colocar a un beneficiario **no** crea cuenta de crédito: reduce el disponible de la única línea | credit-portfolio | ✅ |
| **A12** | La comisión se devenga al **aplicarse el pago**, no al colocar: una colocación sin cobro no genera gasto | commission · accounting | ✅ |
| **A13** | El beneficiario queda con expediente KYC completo y con **rastro de qué distribuidora lo capturó** | party | ✅ **escrita** — `PartyRelationshipServiceTest`, 7 casos |
| **A14** | La ECL se calcula sobre la distribuidora, no sobre sus beneficiarios: una sola evaluación | risk | D5 |
| **A15** | Un beneficiario **no** tiene cuenta de crédito, ni DPD, ni ECL, ni reporte a buró | party · credit-portfolio · risk | ✅ |
| **A16** | Un party `INDIVIDUAL` o `BUSINESS` **es elegible** para `DISTRIBUTOR_LINE` | credit-product | pendiente de escribir |
| **A17** | Una solicitud de `DISTRIBUTOR_LINE` **recibe decisión de scoring** — no se omite por falta de política | scoring | pendiente de escribir |
| **A18** | `promoterCode` enviado por REST llega al comando (con y sin promotor) | origination | ✅ **escrita** — `CreditApplicationControllerTest`, 2 casos |
| **A19** | `originUnitCode` es un **código de sucursal**, nunca el `promoterCode` | credit-portfolio | ✅ **escrita** — `CreditAccountServiceTest`, 2 casos |
| **A22** | `BUSINESS_REVOLVING_LINE` también recibe decisión — la política que faltaba | scoring | pendiente de escribir |
| **A20** | El beneficiario queda **evaluado** contra `DISTRIBUTOR_LINE` y el resultado se consulta desde la ficha | scoring · consola | D3 · D4 |
| **A21** | Un beneficiario evaluado con rechazo **puede recibir colocación igual** — la evaluación informa, no bloquea | channel-mobile | D3 |

**A10 es la que protege la convivencia.** Si al meter distribuidoras aparece una cuenta nueva o el
cuadre cambia de naturaleza, el producto se bifurcó y hay que volver atrás.

### 7.2 · Pruebas de la siembra

No son pruebas de dominio: son las que impiden que la consola enseñe una base a medias y parezca un
bug del front. Van en `verifica-distribuidoras.py` y corren al final del reinicio.

| # | Prueba |
|---|---|
| **S1** | Hay exactamente 10 nodos `DISTRIBUTOR`, todos con `party_ref` resoluble a un party con rol vigente |
| **S2** | Cada distribuidora tiene **una** cuenta `DISTRIBUTOR_LINE` con `product_behavior = REVOLVING` |
| **S3** | Hay 100 beneficiarios, cada uno con KYC completo, rol `BENEFICIARY` y relación con **una** distribuidora |
| **S4** | Ningún beneficiario tiene cuenta de crédito, perfil de riesgo ni caso de cobranza |
| **S5** | Los 10 estados del plano 1 están representados, uno por distribuidora |
| **S6** | `distributorCartera` del BFF devuelve datos para al menos tres subárboles distintos |
| **S7** | Toda cuenta de distribuidora tiene `origin_unit_code` resoluble a una sucursal real |
| **S8** | La suma de colocaciones de cada línea ≤ su límite, y el disponible cuadra |
| **S9** | Al menos una distribuidora tiene comisión devengada, y ninguna la tiene sin pago aplicado |

### 7.3 · Cobertura por servicio

| Servicio | Qué se agrega |
|---|---|
| `party` | `PartyRelationshipServiceTest` + `…ControllerTest` (G7); A1/A2 ya tienen `PartyRoleServiceTest` — verificar que cubren la vigencia |
| `sales-org` | A3 como test de aceptación sobre el invariante de profundidad |
| `credit-product` | A16 sobre la elegibilidad corregida |
| `scoring` | A17 y la precalificación del beneficiario (A20) |
| `origination` | A18 — `promoterCode` por REST, hoy imposible |
| `credit-portfolio` | A8 (DPD por corte), A19 (`originUnitCode`), `StatementGenerationJobTest` |
| `commission` | A7 y A12 — A12 con la colocación sin cobro, que hoy no está probada |
| `risk` | A14/A15 — que el beneficiario no aparezca en `risk_profiles` |
| `accounting` | A4, A9, A10 — A10 comparando la balanza con y sin distribuidoras |
| `channel-mobile` | A5 (alcance, 403) y A21 — el journey completo con Testcontainers |
| consola | La pestaña «Distribuidores» contra el BFF real, no contra el mock (G9) |

---

## 8 · Lo que sigue abierto

- ~~**¿La evaluación del beneficiario bloquea o informa?**~~ **Cerrado el 2026-08-14: informa, no
  bloquea** (A21). Es lo coherente con «la distribuidora responde por el saldo íntegro»: si quien
  debe es ella, ella decide a quién coloca. La evaluación queda como información y rastro, y la
  consola la enseña en la ficha del beneficiario sin impedir la colocación.
- **Sellar la sucursal en el alta, no en la reconciliación.** §3.5 deja `originUnitCode` separado de
  `promoterCode`, pero ningún crédito —de distribuidora o no— nace hoy con su sucursal: la rellena
  un trabajo posterior. Cerrarlo exige un `GET /units/by-party/{partyRef}` en sales-org y que
  origination lo resuelva antes de publicar el alta. **Sin verificar** cuántas pólizas de alta
  existentes quedaron sin atribuir por esto.
- **Consentimiento del beneficiario para consulta de buró.** Evaluar exige buró, y buró exige
  consentimiento firmado del evaluado. La distribuidora lo recaba, la institución responde.
  **Bloqueante de cumplimiento para D3.**
- **Qué pasa si la distribuidora deja de serlo.** Los expedientes que capturó siguen siendo válidos;
  su rastro de captura, también. Pero si además gestionaba beneficiarios, hay que reasignarlos.
- **Tope de exposición por beneficiario.** Con el saldo íntegro a cargo de la distribuidora, nada
  impide hoy que concentre toda su línea en un solo beneficiario. Es una regla de producto que no
  existe y probablemente debería.
- **Unificar la identidad de una persona, o tiparla.** §2.ter: `prospectId` y `partyId` conviven,
  cada dominio usa uno, y confundirlos devuelve vacío en vez de error. Es la causa más probable del
  próximo bug silencioso de este repo.
- **`DL-DIST-STD-V1` no está disponible en `MOBILE_APP`.** Sus canales sembrados son `BRANCH` y
  `API_PARTNER`, pero D3 sitúa el journey de la distribuidora en el canal móvil, y por ahí lo
  origina la siembra. **Nadie hace cumplir la disponibilidad por canal** —origination no consulta el
  catálogo al abrir la solicitud—, así que no rompe nada: simplemente el producto dice una cosa y el
  dato dice otra, igual que pasaba con la elegibilidad (G1). Añadir `MOBILE_APP` es una decisión de
  producto, no de ingeniería: hay que confirmar si la distribuidora se da de alta desde una app o
  sólo en sucursal y por integración.
- **Pago mínimo: fórmula.** D5 necesita una — % del saldo, interés + % de capital, o piso absoluto.
  Es una decisión de producto, no de ingeniería. **Sin verificar** si `configuration-service` tiene
  dónde parametrizarla.

---

## 9 · Orden de ejecución propuesto

| Paso | Qué | Riesgo | Estado |
|---|---|---|---|
| **1** | **D0** — G1, G2, G3, G4 | Bajo | ✅ hecho |
| **2** | **D1-G7** — API de `party_relationships` | Bajo | ✅ hecho |
| **3** | **D4-G9** — `/distributors` en el BFF | Bajo | ✅ hecho |
| **4** | **D5** — cortes, pago mínimo y DPD de revolvente | **Alto** | ✅ hecho — pago mínimo = interés + 5 % de capital, piso $200, 20 días de gracia, todo parametrizable |
| **5** | **D3** — el journey B2B2C en `channel-mobile` | **Alto** | ⏳ **pendiente.** Es lo único grande que queda |
| **6** | **D6** — reinicio y siembra | Medio | ✅ hecho, **rodeando D3** (ver abajo) |
| **7** | **D7** — pruebas | Medio | Parcial: A8 y A13 escritas; el resto sigue en §7.1 |

### Cómo se sembró sin D3, y qué queda debiendo

La siembra necesitaba el journey de distribuidora que D3 no ha construido. En vez de esperar, el
script **orquesta los endpoints que sí existen** en el orden en que el journey los llamaría: alta por
el canal móvil, rol por party, nodo por sales-org, solicitud y comité por origination, colocación por
`/credit/dispose`. Ninguna inserción directa; cada paso es una llamada que la app haría.

Lo que eso **no** demuestra, y conviene no confundir:

- **La regla de alcance (A5) sigue sin existir.** El script coloca como la distribuidora dueña de la
  línea porque él mismo elige a quién, no porque el canal se lo impida. Hoy una distribuidora
  autenticada **sí** podría disponer a nombre del beneficiario de otra. Es el riesgo abierto más
  serio de este trabajo y lo cierra D3.
- **La evaluación del beneficiario todavía no se dispara** en el alta: el script deja expediente y
  vínculo, no precalificación. A20 sigue pendiente.
- **No hay pantalla para nada de esto.** Lo que la siembra produce se ve en la consola; darlo de alta
  desde la app es D3.

**Lo que no se puede empezar sin una decisión humana:** D3, por el consentimiento de buró (§8).
