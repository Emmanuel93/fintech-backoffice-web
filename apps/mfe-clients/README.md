# mfe-clients — Clientes y Distribuidores  ·  `:5103`

Directorio de contrapartes en tres pestañas: personas, negocios y distribuidores. Dos entradas de
menú (`/clientes`, `/clientes/distribuidores`) sobre el mismo remote.

## Qué consume

`/clients[/{id}]` · `/clients/{id}/assign-executive` · `/executives` · `/distributors[/{id}]`

## Decisiones

**Un distribuidor no es un tercer `partyType`:** es una persona o un negocio **con un rol
adicional**, y el mismo registro puede ser acreditado de su propio crédito y a la vez originar
créditos de terceros. Tiene pestaña propia porque la pregunta que se le hace —qué colocó, cuánto
comisionó— no se parece a la que se le hace a un acreditado, y mezclarlos obligaba a que ninguna
columna fuera la correcta.

**La consulta va del distribuidor hacia sus créditos, nunca al revés.** Quien pregunta llega con el
nombre o el código (`DIST-0042`), no con un número de contrato.

**El colaborador externo no recibe CURP, RFC ni buró.** El corte lo hace la proyección del BFF —el
dato no sale del dominio—; `isExternalCollaborator()` sólo evita pintar una columna condenada a «—».
