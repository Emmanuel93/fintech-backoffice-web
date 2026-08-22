#!/usr/bin/env bash
# Levanta el shell + los 10 remotes en dev (Vite), y los mantiene arriba.
#
# Los vigila en vez de sólo lanzarlos porque un remote caído no se nota hasta que
# alguien abre ese módulo y recibe «Failed to load script resources» — un error de
# federación que parece un problema de código y es un proceso que ya no está. La
# consola sigue funcionando alrededor, así que el hueco puede durar horas.
#
# Sin arreglos asociativos a propósito: macOS trae bash 3.2 y `declare -A` no
# existe ahí. El script muere en la primera línea y deja todo abajo.
#
# Ctrl-C detiene todos.
set -uo pipefail
cd "$(dirname "$0")"

NOMBRES=(shell mfe-dashboard mfe-portfolio mfe-clients mfe-products
         mfe-applications mfe-salesorg mfe-audit mfe-rbac mfe-collections mfe-accounting)
PUERTOS=(4200  5101          5102          5103        5104
         5105             5106         5107      5108     5109           5110)

PIDS=()
VIVO=1

cleanup() {
  VIVO=0
  echo; echo "deteniendo…"
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

arranca() { # índice
  local i=$1
  ( cd "apps/${NOMBRES[$i]}" && exec npx vite --port "${PUERTOS[$i]}" --strictPort ) &
  PIDS[$i]=$!
}

echo "Backoffice dev servers:"
for i in "${!NOMBRES[@]}"; do
  arranca "$i"
  echo "  ${NOMBRES[$i]} → http://localhost:${PUERTOS[$i]}"
done
echo
echo "Abre http://localhost:4200  (Ctrl-C para detener)"

# Supervisión: si un servidor se cae, se vuelve a levantar y se dice en pantalla.
# Reiniciar en silencio escondería un proceso que muere en bucle; el aviso es lo
# que distingue «se cayó una vez» de «no arranca».
while [ "$VIVO" = 1 ]; do
  sleep 5
  for i in "${!NOMBRES[@]}"; do
    if ! kill -0 "${PIDS[$i]}" 2>/dev/null; then
      echo "  ⟳ ${NOMBRES[$i]} (:${PUERTOS[$i]}) se cayó — reiniciando"
      arranca "$i"
    fi
  done
done
