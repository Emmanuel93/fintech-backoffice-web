# mfe-dashboard — Panorama  ·  `:5101`

La primera pantalla de cada sesión: cuánto se colocó, cuánto está en riesgo, cómo va el cobro del
período y de qué se compone la red.

## Qué consume

`GET /dashboard/summary` · `GET /dashboard/commercial?unitId=` · `/sales-org/{levels,units,my-scope}`

## Decisiones

**La cartera vencida es sólo Stage 3 (90+).** El tramo 31-90 es atraso temprano (SICR) y va aparte.
Iban sumados, y por eso esta pantalla y estructura comercial daban dos moras distintas de la misma
cartera.

**Las barras de producto son proporción del producto más grande, no del total.** Con uno que se
lleva el 70%, contra el total los otros cinco quedan en dos pixeles indistinguibles y se pierde la
comparación para la que existe el panel.

**El pipeline sale vacío y se dice.** El BFF publica `body.put("pipeline", List.of())`: el embudo
por estatus vive en Originación, que lo calcula sobre la bandeja. La pantalla lo explica en vez de
mostrar un panel en blanco.

**La raíz del árbol sale de `my-scope`.** Antes se averiguaba pidiendo la cartera sin unidad y
cayéndose al `catch` con el 400 del BFF: funcionaba, pero usaba un error como vía normal y
cualquier fallo de red acababa mostrando la raíz como si fuera el alcance de esa persona.
