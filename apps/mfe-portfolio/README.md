# mfe-portfolio — Cuentas de crédito  ·  `:5102`

Seguimiento de préstamos: saldo, morosidad, salud IFRS-9 y la ficha con calendario, pagos y
disposiciones.

## Qué consume

`GET /portfolio` · `GET /portfolio/{id}` · `GET /dashboard/stats?groupBy=dpdBucket`

## Decisiones

**El reparto por tramo lo agrega la base, no esta pantalla.** La lista trae 100 cuentas; sumar
sobre ellas daba un total que se lee como si fuera toda la cartera. `/dashboard/stats` lo resuelve
con un `GROUP BY`.

**Ese agregado exige `dashboard.view`**, que quien entra aquí con `portfolio.view` puede no tener.
No es un fallo, es alcance: la pantalla lo dice y la tabla sigue funcionando.

**El IVA tiene columna propia en el calendario.** No es ingreso de la institución: es del SAT.
Sumado dentro del interés, el plan diría que se gana más de lo que se gana; omitido, el «Pago» no
cuadraría contra capital + interés.

**Los pagos no son lo mismo que las mensualidades pagadas.** El calendario dice qué periodos
figuran cubiertos; la pestaña de pagos, con qué dinero. Un pago confirmado que aún no movió el
calendario es justo el caso que se investiga desde aquí.
