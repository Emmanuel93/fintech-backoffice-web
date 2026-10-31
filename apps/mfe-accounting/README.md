# mfe-accounting — Contabilidad  ·  `:5110`

Cuatro pantallas sobre un mismo período: **Resumen general**, **Pólizas**, **Facturas** y
**Balanza**; y una quinta, **Bancos y tesorería**, con su propia capacidad.

## Qué consume

`/accounting/{periods,summary,units,vouchers,loans,trial-balance}` · `/vouchers/{id}` ·
`/accounts/{id}/ledger` · `/invoices[/{id}]` · `POST /accounting/periods/{p}/{close,reopen}` ·
`POST /accounting/billing-runs` · `POST /accounting/backfill-origin-units` ·
`/treasury/{bank-accounts,payout-routes,disbursements[/{id}]}`

## Decisiones

**El período manda sobre todo y vive fuera de las pestañas.** Si cada vista llevara el suyo,
comparar el resumen contra la balanza obligaría a acordarse de mover dos selectores, y la primera
vez que se olvide uno la conclusión será que la contabilidad no cuadra. Por eso el shell pasa la
vista como prop y **no remonta** el módulo: cambiar de pantalla conserva el mes.

**La navegación es circular a propósito** —póliza → préstamo → póliza, factura → préstamo →
factura—, porque conciliar es ir y volver entre esas tres cosas.

**El cuadre va primero y en grande.** Una balanza descuadrada no es un número peor: es que ningún
número de la pantalla se puede usar. Al final, entre otras seis cifras, se lee como un detalle.

**Cerrar exige `accounting.close`, que un auditor no tiene.** Auditar no puede implicar poder mover
el corte de lo que se está auditando. Cerrar no rechaza lo que llegue después: se asienta en el
primer período abierto y queda marcado como extemporáneo.

**La reconciliación de sucursal corre en dos tiempos.** Primero en seco —no escribe nada— y sólo
después se aplica: reatribuir de qué sucursal es un ingreso se lee en los números de la gente. Lo
que no se resuelve se queda sin sucursal y se reporta contado; repartirlo con una heurística haría
que las sumas cerraran a costa de atribuirle ingreso a quien no lo colocó, y eso ya no se audita.

> El botón de reconciliar se ofrece con `accounting.close`, aunque el BFF hoy lo deja pasar con
> `accounting.view` (cae en el matcher genérico de `/accounting/**`). Es cortesía de la consola, no
> la puerta.

**Tesorería vive aquí, pero con `treasury.view`.** Se concilia contra la contabilidad —la póliza de
egreso dice que salieron $45,000; tesorería dice si de verdad salieron, por qué cuenta y con qué
clave de rastreo—, y cada cuenta bancaria enseña la cuenta del mayor a la que pega. La capacidad es
aparte porque operación contesta «¿ya le llegó?» sin leer el mayor: para quien no tiene
`accounting.view` el módulo ni siquiera pide los períodos, que serían un 403 en la bitácora.

**Aceptada no es liquidada.** STP acepta la orden en segundos; sólo `SETTLED` afirma que el banco
receptor abonó, y es cuando existe el CEP. El monto dispersado suma sólo lo liquidado. La ficha de
la dispersión compone tres fuentes —recorrido, orden en STP, rastro del dinero— y cada una se
degrada sola con un «sin dato de …». En modo simulado las dispersiones liquidadas se derivan de las
pólizas de egreso del dataset contable, así que tesorería y contabilidad cuentan el mismo dinero.
