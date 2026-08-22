import { useState } from 'react';
import { accountingApi, type BackfillResult } from '@bo/api-client';
import { Badge, Button, Modal, Spinner, StatCard, Stats, count } from '@bo/design-system';

/**
 * Reconciliación de la sucursal de origen.
 *
 * <p>La sucursal se sella al activar el préstamo, pero la cartera anterior a ese sellado —y
 * cualquier cartera migrada— no la trae, así que aparece bajo «Sin sucursal» y sus sucursales se
 * ven con menos colocación de la que hicieron. La nota al pie del módulo lo decía desde hace
 * tiempo y no había forma de corregirlo desde la consola: había que pedirle a alguien que llamara
 * al endpoint a mano.
 *
 * <p>Se corre en dos tiempos y no en uno: primero en seco, que no escribe nada, y sólo después se
 * aplica. Reatribuir de qué sucursal es un ingreso es un cambio que se lee en los números de la
 * gente, y merece verse antes de hacerse — sobre todo porque lo que no se resuelve se queda sin
 * sucursal a propósito, y ese número es el que decide si vale la pena aplicarlo o si primero hay
 * que asignar ejecutivos.
 */
export function Reconciliacion({ onCerrar, onAplicado }: {
  onCerrar: () => void;
  onAplicado: () => void;
}) {
  const [ensayo, setEnsayo] = useState<BackfillResult | null>(null);
  const [aplicado, setAplicado] = useState<BackfillResult | null>(null);
  const [corriendo, setCorriendo] = useState<'seco' | 'real' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const correr = async (dryRun: boolean) => {
    setCorriendo(dryRun ? 'seco' : 'real');
    setError(null);
    try {
      const r = await accountingApi.backfillOriginUnits({ dryRun });
      if (dryRun) setEnsayo(r); else { setAplicado(r); onAplicado(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo correr la reconciliación');
    } finally {
      setCorriendo(null);
    }
  };

  const r = aplicado ?? ensayo;
  const sinResolver = r ? r.sinEjecutivoAsignado + r.ejecutivoFueraDelArbol : 0;

  return (
    <Modal
      title="Reconciliar la sucursal de origen"
      subtitle="Cartera anterior al sellado y cartera migrada"
      onClose={onCerrar}
      actions={aplicado ? <Badge tone="ok">Aplicada</Badge> : undefined}
    >
      <p className="bo-page-sub" style={{ marginTop: 0 }}>
        Resuelve cada crédito por su cadena real —cliente → ejecutivo asignado → nodo del ejecutivo
        en el árbol comercial → su sucursal— y sella la sucursal que le corresponde. Lo que no se
        resuelve se queda <b>sin sucursal</b> y se reporta contado: repartirlo con una heurística
        haría que las sumas cerraran a costa de atribuirle ingreso a quien no lo colocó. Es
        idempotente: correrla dos veces no duplica nada.
      </p>

      {corriendo ? <Spinner /> : (
        <>
          {r && (
            <>
              <Stats>
                <StatCard
                  label={aplicado ? 'Créditos sellados' : 'Se sellarían'}
                  value={count(r.sellados)}
                  tone={r.sellados > 0 ? 'ok' : undefined}
                  sub={`de ${count(r.revisados)} revisados`}
                />
                <StatCard
                  label={aplicado ? 'Pólizas atribuidas' : 'Pólizas por atribuir'}
                  value={count(r.polizasAtribuidas)}
                  sub={`${count(r.polizasBarridas)} pólizas barridas`}
                />
                <StatCard
                  label="Ya tenían sucursal"
                  value={count(r.yaSellados)}
                  sub="no se tocan"
                />
                <StatCard
                  label="Quedan sin resolver"
                  value={count(sinResolver)}
                  tone={sinResolver > 0 ? 'warn' : undefined}
                  sub={sinResolver > 0
                    ? `${count(r.sinEjecutivoAsignado)} sin ejecutivo · ${count(r.ejecutivoFueraDelArbol)} fuera del árbol`
                    : 'toda la cartera quedó atribuida'}
                />
              </Stats>

              {sinResolver > 0 && (
                <div className="bo-alert bo-huerfanos" style={{ marginBottom: 16 }}>
                  <b>{count(sinResolver)}</b> créditos se quedan sin sucursal porque no hay de quién
                  colgarlos. Los de «sin ejecutivo» se arreglan asignando ejecutivo desde{' '}
                  <b>Clientes</b>; los de «fuera del árbol», adscribiendo a ese ejecutivo a una
                  unidad desde <b>Estructura comercial</b>. Correr la reconciliación otra vez
                  después los recogerá.
                </div>
              )}

              {r.muestra.length > 0 && (
                <details style={{ marginBottom: 16 }}>
                  <summary className="bo-page-sub" style={{ cursor: 'pointer' }}>
                    Muestra de lo resuelto ({count(r.muestra.length)})
                  </summary>
                  <pre className="bo-payload" style={{ marginTop: 8 }}>{r.muestra.join('\n')}</pre>
                </details>
              )}
            </>
          )}

          {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {!aplicado && (
              <Button onClick={() => void correr(true)}>
                {ensayo ? 'Volver a revisar en seco' : 'Revisar en seco'}
              </Button>
            )}
            {ensayo && !aplicado && (
              <Button
                variant="primary"
                disabled={ensayo.sellados === 0}
                title={ensayo.sellados === 0
                  ? 'No hay nada que sellar: o ya está todo atribuido, o lo que falta no se puede resolver'
                  : 'Escribe la sucursal de origen en los créditos resueltos'}
                onClick={() => void correr(false)}
              >
                Aplicar a {count(ensayo.sellados)} créditos
              </Button>
            )}
            <Button onClick={onCerrar}>{aplicado ? 'Cerrar' : 'Cancelar'}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
