# Estrategia de cobranza — diseño completo

> Reconciliado con el código el 2026-08-14. Cubre: cadencia de recordatorios, registro único de
> gestión, freno por promesa, oferta y aceptación de convenios, asignación a gestor y despacho
> externo, y el tratamiento contable del quebranto con recuperación posterior.
>
> **Fases 1 a 3 implementadas y verificadas** — ver §11. La cadencia quedó como un ciclo acotado
> de cinco días, no como una escalada indefinida: es el cambio de fondo respecto del primer diseño.

---

## 1. De dónde partimos

Lo que ya existe y funciona:

| Pieza | Estado |
|---|---|
| Casos de mora con 7 tramos y estrategia derivada | ✅ |
| Contacto manual con ventana CONDUSEF y tope 3/día | ✅ |
| Promesas de pago; se cumplen solas con el pago | ✅ |
| Convenios (quita / reestructura) con maker-checker | ✅ parcial — ver §6 |
| Quebranto con acta inmutable y reporte a buró | ✅ |
| **Recuperación post-quebranto asentada en contabilidad** | ✅ `4104 RECUPERACION_CASTIGADA` |
| notifications-service con 6 canales y políticas por evento | ✅ |

Y los huecos que impiden la estrategia que se pide:

1. **notifications-service no escucha ni un solo evento de cobranza.** Sus 7 `EventType`
   (`OFFER_PRESENTED`, `WELCOME_ACTIVATED`, `DISBURSEMENT_COMPLETED`, `PAYMENT_REMINDER`,
   `PAYMENT_OVERDUE`, `INSTALLMENT_PAID`, `LOAN_SETTLED`) no incluyen ninguno de los 13 tópicos que
   cobranza publica. Un caso puede escalar de `B1_30` a `B181_PLUS` sin que salga un solo mensaje.
2. **Lo que se envía no llega a la gestión.** notifications guarda su `NotificationRecord`; cobranza
   guarda su `ContactAttempt`. Son dos historiales que nadie cruza: la bitácora de gestión del caso
   sólo tiene lo que un agente capturó a mano.
3. **No hay cadencia.** `PAYMENT_OVERDUE` existe como tipo de evento, pero nada lo dispara con
   frecuencia creciente según el tramo.
4. **No hay freno.** Una promesa vigente no calla nada: si hubiera cadencia, seguiría disparando.
5. **El convenio no se le ofrece a nadie.** Se propone desde el backoffice y se «acepta» con un
   `PUT` que hace el propio agente. El deudor nunca lo ve.
6. **`assignAgent()` y `escalateToAgency()` existen en el dominio y nadie los invoca.**

---

## 2. La cadencia: cinco días y se acaba

**Implementado.** El ciclo cubre los primeros cinco días de mora, con un mensaje diario y el tono
subiendo escalón por escalón. Después no se manda nada más de forma automática: la gestión la lleva
una persona.

| Día | Escalón | Qué dice | Qué **no** dice |
|---|---|---|---|
| 1 | `RECORDATORIO` | «Parece que se te pasó» | Nada de consecuencias |
| 2 | `COMO_PAGAR` | Mismo tono, con las formas de pago a la mano | — |
| 3 | `ATRASO` | Nombra el atraso y lo que se acumula si sigue | — |
| 4 | `HISTORIAL` | Ponerse al corriente protege tu historial | No promete evitar el reporte |
| 5 | `OFRECER_AYUDA` | Cierra ofreciendo hablar y buscar opciones | — |

**Por qué cinco y no una escalada indefinida.** El primer diseño proponía una cadencia creciente
hasta el quebranto. Es el instinto equivocado: el recordatorio funciona en los primeros días porque
la causa más probable es el olvido, y a partir de ahí el que no pagó no es que no se haya enterado.
Escribirle solo durante seis meses no cobra más — satura el canal, entrena a ignorarlo y acumula
quejas. El esfuerzo tardío rinde con una persona, no con un job.

**Sobre el escalón 4 y el buró.** Se menciona el historial crediticio una sola vez, como
consecuencia que se puede evitar, nunca como amenaza. La diferencia no es de estilo: el atraso se
reporta a las sociedades de información crediticia porque es un hecho del crédito, no una decisión
de cobranza, así que **no hay nada que ofrecer a cambio de no reportar**. Un «si no pagas hoy te
reportamos» promete algo que cobranza no controla, y es la clase de práctica que se sanciona.

Tres reglas que acotan el ciclo, todas implementadas:

- **La ventana 08:00–20:00 aplica a todo, no sólo a las llamadas.** El job comprueba la hora antes
  de publicar nada; fuera de ventana no manda y lo registra.
- **El tope de 3 por día cuenta sólo los intentos de agente.** Ver §9, decisión 1.
- **Cualquier freno vivo detiene el ciclo** — promesa, convenio en curso, despacho asignado, pausa
  manual. Ver §4.

`dunning-enabled` apaga la cadencia entera sin tocar el resto del módulo.

---

## 3. Registro único de gestión

**Todo mensaje que sale queda en la gestión del caso, lo mande quien lo mande.** Es el requisito
regulatorio y también el operativo: un agente que llama sin ver que el sistema ya mandó tres
WhatsApps ese día está quemando el cupo y la paciencia del cliente.

```
collections ──publica──> collections.dunning-requested
                              │
                         notifications  (elige canal según política y preferencias)
                              │
                    notification.delivered / .failed
                              │
                         collections ──escribe──> ContactAttempt(origin=AUTOMATIC)
```

La decisión de fondo: **cobranza no envía, pide que se envíe.** Mantener a notifications como el
único que habla con los proveedores evita duplicar plantillas, preferencias y opt-outs. Pero la
**prueba de que se envió** vive en el caso, porque es ahí donde se audita.

Cambios que exige:

- `ContactAttempt.origin` — `MANUAL` | `AUTOMATIC`. Hoy todo intento tiene un `agentId`; los
  automáticos no tienen agente y necesitan distinguirse sin inventar un usuario «SISTEMA».
- `ContactAttempt.notificationId` — el enlace al `NotificationRecord`, para poder ir del caso al
  contenido exacto que se envió.
- `ContactResult` gana `DELIVERED`, `READ` y `FAILED`. Los cuatro valores actuales
  (`ANSWERED`, `NO_ANSWER`, `WRONG_NUMBER`, `PROMISE_MADE`) describen una llamada; un WhatsApp
  entregado no es «contestó».
- **Sólo los `MANUAL` cuentan contra el tope de 3/día.** Ver §9, decisión abierta 1.
- `channel` pasa a catálogo cerrado en el dominio: `PHONE`, `SMS`, `EMAIL`, `WHATSAPP`,
  `PUSH`, `VISIT`, `IVR`. Hoy es texto libre y el reporte de gestión no agrupa.

La llamada telefónica sigue siendo manual: no hay integración de telefonía, y capturarla es lo que
hace el agente después de colgar.

---

## 4. El freno por promesa

**Una promesa viva calla la cobranza automática.** Seguir mandando recordatorios a quien acaba de
comprometerse a pagar el viernes destruye el compromiso que se acaba de conseguir.

```
Promesa registrada (ACTIVE)
   └─> CommunicationHold hasta promisedDate + gracia (default 2 días)
          ├─ Pago que cubre el importe  → KEPT  → hold hasta que el caso cierre o reabra
          ├─ Llega promisedDate + gracia sin pago → BROKEN → hold se levanta,
          │                                          y la cadencia **sube un escalón**
          └─ El agente puede levantar el hold a mano, con motivo
```

Precisiones:

- **El freno es sólo para lo automático.** El agente puede seguir llamando: puede haber una razón
  para hacerlo, y quitarle esa opción convierte el freno en un escondite.
- **Una promesa rota endurece, no sólo restaura.** El caso vuelve a la cadencia del tramo siguiente
  al suyo, porque una promesa incumplida es información: el deudor ya dijo que iba a pagar y no lo
  hizo.
- **Un pago parcial no cumple la promesa.** Hoy sólo se registra en log
  (`PromiseService.onPaymentApplied`) y es correcto que no la cumpla — pero **sí debería extender el
  hold**: alguien que abonó la mitad no merece el mismo trato que quien ignoró.

Modelo nuevo: `CommunicationHold` con `caseId`, `reason` (`ACTIVE_PROMISE`, `AGREEMENT_IN_FLIGHT`,
`AGENCY_ASSIGNED`, `MANUAL`), `heldUntil`, `releasedAt`, `releasedBy`.

Los otros dos motivos de freno importan tanto como la promesa: **un convenio propuesto o aceptado
también calla la cadencia** —no se puede estar negociando y presionando a la vez— y **un caso en
despacho externo lo calla del todo**, porque quien gestiona ya no somos nosotros y dos cobradores
sobre la misma persona es exactamente la queja que llega a CONDUSEF.

---

## 5. Cómo se ofrecen hoy los convenios, y cómo deberían ofrecerse

**Hoy:** un agente arma la propuesta en el backoffice (`POST /cases/{id}/agreements`), y luego el
mismo agente registra que el deudor aceptó (`PUT /agreements/{id}/accept`). El deudor nunca ve nada:
lo que se guarda es el dicho del agente de que hubo una conversación.

Eso sirve para una negociación telefónica y no sirve para nada más. No hay constancia de la oferta,
no hay aceptación del deudor, y `EXPIRED` a los 5 días cuenta desde una propuesta que quizá nunca
salió de la pantalla.

**Propuesta:**

```
Agente propone  →  AgreementProposed
                        │
                   notifications: oferta formal por WHATSAPP + EMAIL
                   (importe, plazo, vigencia, y liga firmada de aceptación)
                        │
              ┌─────────┴──────────┐
     El deudor acepta        El agente registra
     desde la liga           la aceptación telefónica
     (canal móvil)           (como hoy)
              └─────────┬──────────┘
                        │
                    ACCEPTED  → autorización (cuatro ojos) → EXECUTED
```

Lo que se gana: constancia de la oferta con su fecha, aceptación atribuible al deudor y no al
agente, y un `EXPIRED` que cuenta desde que la oferta salió de verdad.

Lo que exige:
- Endpoint de aceptación en **channel-mobile-service** (`POST /me/agreements/{id}/accept`),
  autenticado como el deudor.
- `CollectionAgreement.offeredAt`, `acceptedVia` (`MOBILE` | `AGENT`), `offerNotificationId`.
- Plantillas de convenio en notifications, con dos `EventType` nuevos:
  `COLLECTION_AGREEMENT_OFFERED` y `COLLECTION_AGREEMENT_EXECUTED`.
- El reloj de `agreementResponseDays` arranca en `offeredAt`, no en `proposedAt`.

**Qué se ofrece en cada tramo** (§2): reestructura en `B31_60`–`B91_120`, quita en `B121_180`. Una
quita ofrecida a los 40 días entrena al cliente a no pagar; una reestructura ofrecida a los 150
llega tarde.

---

## 6. Asignación: gestor interno y despacho externo

Hoy `assignedAgentId` y `externalAgencyId` son siempre nulos, y `assignAgent()` /
`escalateToAgency()` no los invoca nadie. Sin eso no hay reparto de trabajo, no hay filtro «mis
casos», y la comisión del despacho no tiene contra qué calcularse.

### Asignación interna

- Automática al entrar a `B31_60` (es lo que dice `AGENT_ASSIGNED_RESTRUCTURE_OFFER`), por carga:
  al gestor con menos casos activos de esa sucursal.
- Reasignable a mano desde el backoffice, con motivo.
- El filtro «mis casos» de la bandeja ya está implementado de punta a punta y empieza a servir el
  día que esto exista.

### Despacho externo — la distinción que importa

> **Mandar a despacho y quebrantar son dos decisiones distintas, y conviene no fundirlas.**

Es tentador tratarlas como una sola —«ya se fue a despacho, ya no es cartera»— y es un error caro:
la cuenta puede estar en despacho a los 130 días y seguir viva en balance, generando intereses
moratorios y provisionándose como corresponde. El castigo contable ocurre a los 181 por política,
lo mande quien lo mande.

| | Asignación a despacho | Quebranto (write-off) |
|---|---|---|
| Qué es | Decisión **operativa**: quién gestiona | Decisión **contable**: la cuenta sale del balance |
| Cuándo | Desde `B121_180` | `daysDelinquent ≥ 181` |
| Efecto en cartera | Ninguno — sigue viva y devengando | Saldos a cero, caso `WRITTEN_OFF` |
| Reversible | Sí, se puede retirar del despacho | No |
| Comunicación propia | Se detiene (`AGENCY_ASSIGNED`) | Se detiene |

Las dos coexisten: lo normal es que una cuenta se asigne a despacho **antes** de quebrantarse, y
que siga en el despacho **después**. El despacho cobra su comisión sobre lo recuperado en ambos
casos; lo que cambia es el asiento contable de lo que entra.

Modelo nuevo, `AgencyAssignment`: `assignmentId`, `caseId`, `creditAccountId`, `agencyId`,
`assignedAt`, `withdrawnAt`, `commissionPct`, `mandate` (`EXTRAJUDICIAL` | `LEGAL`).

---

## 7. Quebranto y recuperación: el tratamiento contable

Esto ya está resuelto en el código y conviene decirlo con precisión, porque es exactamente la duda
planteada — «contablemente ya no representa nada, pero pueden entrar ingresos».

**Al quebrantar** (`GL-10`: consumir reserva antes de P&L):

```
Consume la estimación ya constituida:   1290 ESTIMACION_PREVENTIVA  →  1210 CARTERA_CASTIGADA
Lo no provisionado va a resultados:     5102 GASTO_QUEBRANTO        →  1210 CARTERA_CASTIGADA
```

La cuenta sale del balance. En cartera queda `WRITTEN_OFF`, no devenga, no se revive: un pago
posterior **no reabre el caso** — `PromiseService.onPaymentApplied` lo trata explícitamente como
recuperación y lo dice en su comentario (RR-01).

**Al recuperar después** (`PostingService.onRecoveryPayment`, ya implementado):

```
1101 BANCOS  →  4104 RECUPERACION_CASTIGADA
```

Es **ingreso del periodo**, no reversión del quebranto. Por eso puede entrar dinero de una cuenta
que «ya no existe»: el derecho de cobro no se extingue con el castigo contable — se extingue con el
pago, la prescripción o el convenio judicial. El castigo es reconocimiento de pérdida esperada, no
renuncia al cobro.

**Lo que falta instrumentar:**

1. **Cuentas de orden.** El derecho de cobro castigado debería quedar en cuentas de orden
   (`7101 CARTERA_CASTIGADA_ORDEN` / `7102 CONTRA_CARTERA_CASTIGADA`) para saber cuánto se sigue
   persiguiendo. Hoy, después del castigo, no hay dónde leer el saldo vivo del despacho.
2. **Comisión del despacho.** La recuperación entra bruta. La comisión —típicamente 20–35% de lo
   recuperado, y más en vía legal— necesita su propio asiento
   (`5103 GASTO_COMISION_COBRANZA` → `2101 PROVEEDORES`) disparado por la recuperación, con el
   `commissionPct` del `AgencyAssignment`.
3. **Vía legal.** Un convenio judicial (`LEGAL_SETTLEMENT`, que ya existe como `WriteOffReason`)
   suele implicar quita adicional y costas. Necesita distinguirse de la recuperación extrajudicial
   para no mezclar márgenes: lo recuperado en juicio cuesta mucho más que lo recuperado por teléfono.
4. **Prescripción.** Nada marca cuándo el derecho de cobro se extingue. Es el único momento en que
   la cuenta debe salir de cuentas de orden.

---

## 8. Track de implementación

Cinco fases, ordenadas por lo que desbloquean. Cada una es entregable por su cuenta.

### Fase 1 — El registro único *(sin ella, nada de lo demás es auditable)*

- `ContactAttempt`: `origin`, `notificationId`, `channel` como catálogo cerrado, `ContactResult`
  con `DELIVERED`/`READ`/`FAILED`. Migración Liquibase, todas las columnas nulables.
- notifications publica `notification.delivered` y `notification.failed`.
- collections los consume y escribe el `ContactAttempt` automático.
- El tope de 3/día pasa a contar sólo `MANUAL`.
- **Frontend:** el timeline del caso ya existe; distinguir automático de manual y mostrar el canal.

### Fase 2 — La cadencia

- `EventType` gana `COLLECTION_DUNNING` con severidad por tramo; plantillas por tramo y canal.
- `DunningScheduleJob` en collections: recorre casos activos, decide a quién toca hoy según la
  cadencia configurada, respeta ventana CONDUSEF y publica `collections.dunning-requested`.
- notifications lo consume y elige canal por política + preferencias del cliente.
- Cadencia en `application.yml`, no en código.

### Fase 3 — El freno

- `CommunicationHold` con sus cuatro motivos.
- La promesa registrada abre hold; el pago parcial lo extiende; el rompimiento lo levanta y sube un
  escalón de cadencia.
- `DunningScheduleJob` consulta el hold antes de publicar.
- **Frontend:** mostrar el freno vigente y su motivo en la ficha del caso, con la opción de
  levantarlo a mano.

### Fase 4 — La oferta de convenio

- `offeredAt`, `acceptedVia`, `offerNotificationId`.
- `EventType` `COLLECTION_AGREEMENT_OFFERED` / `_EXECUTED` con plantillas.
- Endpoint de aceptación en channel-mobile-service.
- `agreementResponseDays` cuenta desde `offeredAt`.
- **Cerrar el maker-checker en servidor** — hoy nadie compara `authorizedBy` contra quien propuso.

### Fase 5 — Asignación y despacho

- `assignAgent()` invocado al entrar a `B31_60`, con reparto por carga.
- `AgencyAssignment` con mandato y comisión.
- Cuentas de orden al quebrantar; comisión asentada sobre la recuperación.
- **Frontend:** el filtro «mis casos» empieza a devolver resultados; ficha de despacho con lo
  recuperado y lo comisionado.

---

## 9. Decisiones: resueltas y abiertas

### 1. El tope CONDUSEF cuenta sólo los intentos de agente — **decidido, implementado**

`countManualByCaseIdAndAttemptedAtAfter` filtra por `origin = MANUAL`, y el mismo filtro se usa
para el contador que ve el gestor. Los mensajes automáticos se registran en el expediente pero no
consumen cupo.

El razonamiento: si contaran, la corrida de las 10:00 dejaría al gestor sin intentos disponibles
por mensajes que él no mandó, y un límite pensado para proteger al cliente acabaría impidiendo la
única llamada capaz de resolverle el problema.

> ⚠️ **Esto sigue siendo una interpretación, no una certeza legal.** Hay regulación mexicana
> aplicable a la cobranza —las disposiciones sobre despachos de cobranza, el registro REDECO de
> CONDUSEF, y las prohibiciones de amenaza, hostigamiento, contacto en horarios indebidos y uso de
> documentos con apariencia oficial— pero **no puedo afirmar con precisión cómo trata un límite
> numérico de contactos a los mensajes automáticos frente a las llamadas**. La implementación deja
> la decisión en un solo punto (`ContactOrigin`) y el parámetro es configurable, así que invertir
> el criterio es cambiar una consulta, no rehacer el módulo. **Que lo valide cumplimiento antes de
> encender la cadencia en producción.**

### 2. La promesa cumplida calla, y luego se le recomienda — **decidido, implementado**

Tres frenos distintos, porque son tres situaciones distintas:

| Situación | Freno | Duración |
|---|---|---|
| Promesa registrada | `ACTIVE_PROMISE` | Hasta la fecha prometida + 2 días de gracia |
| Promesa **cumplida** | `PROMISE_KEPT` | 7 días desde el pago |
| Abono parcial | extiende `ACTIVE_PROMISE` | +3 días |

La gracia de 2 días existe porque un pago hecho el día prometido puede tardar en aplicarse: sin
ella el job de las 08:00 rompería promesas que sí se cumplieron.

**El silencio post-cumplimiento dura 7 días y no «hasta que cierre el caso».** Si la mora se limpió
del todo, el caso cierra solo y el freno da igual. Si quedó saldo —el caso frecuente, porque la
promesa suele cubrir una parte— hay que volver a hablarle, y hacerlo al día siguiente con el mismo
recordatorio que antes de pagar enseña que cumplir no cambia nada. Siete días reconoce el esfuerzo
sin perder el caso.

**Y se le agradece.** `collections.payment-thanks` es el único mensaje del módulo que no pide nada.
Va por un tópico aparte a propósito: si fuera parte de la cadencia, el freno que abre el propio
cumplimiento silenciaría justo el mensaje que hay que mandar. La plantilla distingue si quedó saldo
o no, porque decirle «quedaste al corriente» a quien sigue debiendo hace que el siguiente aviso
parezca un error del banco.

**Lo que falta:** recomendar el siguiente paso según días y etapa. Hoy el mensaje agradece; la
recomendación —reestructura si va a 40 días, convenio si va a 130— necesita las plantillas de la
Fase 4.

### 3. Reestructura y quita no son lo mismo — **aclarado, pendiente de modelar**

La pregunta era si reestructurar es una quita. **No, y el modelo actual las trata como excluyentes,
que es el problema.**

- **Quita (condonación):** se perdona algo **ya devengado**. Baja el saldo exigible hoy.
- **Reestructura:** cambia **cómo se paga lo que se debe** — plazo, tasa hacia adelante, calendario.
  El saldo no baja; se reparte distinto.

Bajar la tasa **hacia adelante** no es quita: es menos ingreso futuro, no perdón de un saldo. Pero
condonar los **moratorios ya acumulados** sí lo es, aunque se pacte dentro de una reestructura.

Y ahí está el hueco: `AgreementType` es `RESTRUCTURE | QUITA_PARCIAL`, mutuamente excluyentes, con
`forgivenAmount` sólo en la quita. **El convenio más común del mundo real —«te reestructuro a 12
meses y te condono los moratorios»— no se puede expresar.** Hoy hay que partirlo en dos convenios,
y la regla de «uno activo por caso» lo impide.

Propuesta: permitir `forgivenAmount` también en `RESTRUCTURE`, con un `forgivenConcept`
(`MORATORIOS` | `INTERESES` | `CAPITAL`). El concepto no es cosmético — determina el asiento:
condonar capital es pérdida realizada, condonar moratorios devengados no cobrados es ingreso que se
deja de percibir, y son cuentas distintas. El tope del 30% debería aplicar sobre lo que toca
capital, no sobre la suma indistinta.

**Sobre cuándo ofrecer cada uno:** reestructura temprano (31–120 días), quita tarde (121–180). Una
quita ofrecida a los 40 días entrena a no pagar; una reestructura a los 150 llega tarde.

### 4. Comisión del despacho: bruto o neto de costas — **abierta**

Sigue sin decidirse y cambia el asiento y el margen real del canal de recuperación. Con mandato
`LEGAL` las costas pueden ser una fracción grande de lo recuperado, así que la diferencia entre las
dos bases no es marginal.

---

## 10. Lo implementado y lo verificado

Fases 1 a 3 completas, con senders todavía no configurados — la instrumentación funciona y lo que
falta es el proveedor que entregue los mensajes.

### collections-service

| Pieza | Qué hace |
|---|---|
| `ContactChannel` | Catálogo cerrado. Un canal inválido devuelve **400**, ya no se guarda |
| `ContactOrigin` | `MANUAL` \| `AUTOMATIC` — lo que separa el cupo del registro |
| `ContactResult` | Suma `DELIVERED`, `READ`, `FAILED` a los cuatro de llamada |
| `CommunicationHold` + servicio | Los cinco motivos de silencio, con historial y liberación |
| `DunningStep` | Los cinco escalones de tono |
| `DunningService` + job (10:00) | La corrida diaria: ventana, frenos y ciclo de 5 días |
| `ContactLoggingService` | Escribe el contacto automático al confirmarse la entrega |
| Migración `010` | Columnas, tabla de frenos, índices y **constraints ampliados** |

`PromiseService` quedó enganchado a los tres momentos: promesa registrada abre freno, cumplida
agradece y concede 7 días, parcial extiende, rota lo levanta.

### notifications-service

Nueve `EventType` de cobranza, listeners de `collections.dunning-requested` y
`collections.payment-thanks`, y `sourceEventId` propagado en `notification-sent` / `-failed` — que
es lo que permite a cobranza reconocer su propio encargo sin que notifications conozca el concepto
de «caso».

### Verificado de punta a punta

- Migración aplicada: tres columnas nuevas + tabla `communication_holds`.
- Promesa registrada → freno `ACTIVE_PROMISE` hasta la fecha + 2 días de gracia. ✅
- El freno **no** bloquea al agente: el intento manual lo rechazó la ventana horaria (eran las
  23:00), no el freno. ✅
- Canal `"telefono"` → **400**; el catálogo cerrado funciona. ✅
- Entrega confirmada por Kafka → `AUTOMATIC / WHATSAPP / DELIVERED / paso 2` en el expediente. ✅
- Fallo de entrega → `AUTOMATIC / SMS / FAILED / paso 4`. ✅
- Un `notification-sent` de bienvenida **no** entra al expediente: el filtro por `sourceEventId`
  funciona. ✅
- Cupo del agente: **0 de 3** con dos contactos automáticos registrados. ✅

Dos defectos salieron en esta verificación y están corregidos:

1. **El `CHECK` de la migración 004** sólo admitía los cuatro resultados de llamada. El servicio
   registraba el contacto en el log y la inserción reventaba al hacer commit — la bitácora afirmaba
   que constaba algo que no constaba. Ampliado en `010`, más dos constraints nuevos que impiden un
   manual sin agente y un automático con agente.
2. **El contador del expediente** seguía sumando los automáticos, así que mostraba «2 de 3» a un
   gestor con el cupo intacto. Es justo la desincronización contra la que el propio código advertía.

### No verificado

- **La corrida real de la cadencia.** El job comprueba la ventana 08:00–20:00 y la verificación
  corrió a las 23:00, así que se probó la lógica con pruebas unitarias y el registro con eventos
  sintéticos, no una corrida completa a las 10:00.
- **La entrega real de mensajes.** No hay senders configurados, que era la premisa del encargo.

---

## 11. Lo que este diseño no toca

- **La decisión de quebrantar sigue siendo manual y con acta.** Automatizarla por umbral sería
  mover saldo sin firma.
- **El conector de buró sigue siendo un stub.** `BUREAU-STUB-XXXXXXXX` no es folio oficial.
- **No hay integración de telefonía.** La llamada se registra a mano, y así queda.
- **Las capacidades siguen siendo `portfolio.view`.** Separar `collections.authorize` es
  prerrequisito de la Fase 4, no parte de ella.
