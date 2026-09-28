---
coyote: 1
repo: fintech-backoffice-web
type: web
stack: [nx, node]
---
purpose|Consola operativa para originar, seguir y cobrar crédito, sobre el backend fintech-services.
run|./run-dev.sh
dep|fintech-services|llama 92 endpoints de channel-backoffice-service
mod|api-client|llama 94 endpoints|libs/api-client
mod|mfe-accounting|Cuatro pantallas sobre un mismo período: Resumen general, Pólizas, Facturas y Balanza.|apps/mfe-accounting
mod|mfe-applications|Dos colas con dueños distintos que comparten remote:|apps/mfe-applications
mod|mfe-audit|Bitácora regulatoria, para revisarse como se revisa un acta.|apps/mfe-audit
mod|mfe-clients|Directorio de contrapartes en tres pestañas: personas, negocios y distribuidores.|apps/mfe-clients
mod|mfe-collections|Cinco pantallas: Bandeja de casos, Promesas de pago, Contacto y gestión, Convenios por autorizar y Reportes a buró.|apps/mfe-collections
mod|mfe-dashboard|La primera pantalla de cada sesión: cuánto se colocó, cuánto está en riesgo, cómo va el cobro del período …|apps/mfe-dashboard
mod|mfe-portfolio|Seguimiento de préstamos: saldo, morosidad, salud IFRS-9 y la ficha con calendario, pagos y disposiciones.|apps/mfe-portfolio
