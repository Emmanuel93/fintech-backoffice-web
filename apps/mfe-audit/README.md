# mfe-audit — Auditoría  ·  `:5107`

Bitácora regulatoria, para revisarse como se revisa un acta.

## Qué consume

`GET /audit/entries?subject=&eventType=&from=&to=` · `GET /audit/entries/{id}`

## Decisiones

**Cada renglón es una oración, no una fila de identificadores.** Mostraba tipo de evento en
mayúsculas y prefijos de UUID para actor, sujeto y agregado; con eso no se contesta ninguna de las
preguntas con que llega una revisión —quién entró, desde dónde, era de la casa o un cliente, tuvo
éxito— sin cruzar cada identificador contra otras pantallas. Auditar se volvía transcribir.

**Los filtros son las preguntas de una revisión:** qué clase de persona, por qué canal, qué clase de
hecho, y si salió bien. Lo técnico —endpoint, payload, agente, correlación— vive en el detalle, que
es donde se necesita al documentar un hallazgo.

**El payload va tal como llegó.** Es evidencia, no un resumen; los secretos se enmascaran en origen.

**La hora nunca se rebana del ISO.** Sobre `2026-08-10T18:00:00Z`, un `slice(11)` da «18:00:00Z»:
seis horas corridas respecto del resto de la columna, y nadie que lea la bitácora tiene cómo
notarlo. Cuando falta la etiqueta del servicio se convierte a hora local y se marca el desfase.

**La identidad incompleta se explica sin inventar la causa.** Puede ser una entrada anterior a que
se capturara CURP, o alguien que no la tiene en su expediente, y desde aquí no se distinguen. Lo que
sí se puede afirmar es que ese hueco no se repara: la bitácora no se reescribe.
