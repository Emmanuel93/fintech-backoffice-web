import { salesOrgApi, type RamaPorOrigen } from '@bo/api-client';
import {
  useAsync, Block, CardTitled, Chip, DataTable, Footnote, StatCard, Stats,
  count, money, moneyCompact, percent, type Column,
} from '@bo/design-system';

/**
 * La red vista por **quién colocó**, no por quién la lleva hoy.
 *
 * <p>Es la segunda lectura de la misma cartera y contesta una pregunta distinta. El árbol atribuye
 * por <b>ejecutivo actual</b>: si una cartera se reasigna, se mueve de rama. Esto atribuye por la
 * <b>unidad de origen sellada al activar el préstamo</b>, que no se mueve nunca. Para pagar una
 * comisión o evaluar a una sucursal por lo que colocó, la buena es ésta; para saber a quién
 * llamar hoy, la otra.
 *
 * <p>Las dos son correctas y van a dar cifras distintas. Por eso la pantalla lo dice antes de la
 * tabla: dos números distintos del mismo negocio, sin nada que los explique, se leen como que uno
 * está mal.
 *
 * <p>El total es exactamente la suma de las ramas —cada cuenta se atribuye a una sola unidad de
 * origen—, así que esta vista se puede cotejar contra sí misma a cualquier altura del árbol. Eso
 * no es cierto del árbol por ejecutivo, donde la cartera sin dueño queda fuera.
 */
export function PorOrigen({ unitId }: { unitId: string }) {
  const state = useAsync(() => salesOrgApi.commercialByOriginUnit(unitId), [unitId]);

  const columns: Array<Column<RamaPorOrigen>> = [
    {
      key: 'unidad', header: 'Unidad que colocó',
      render: (r) => (
        <div>
          <b>{r.unitName ?? r.unitCode}</b>
          <div className="bo-tree-code">{r.unitCode}</div>
        </div>
      ),
    },
    {
      key: 'cuentas', header: 'Cuentas', align: 'right',
      render: (r) => (
        <div>
          <b>{count(r.accounts)}</b>
          {r.delinquentAccounts > 0 && (
            <div className="bo-sub" style={{ color: 'var(--bo-bad)' }}>{count(r.delinquentAccounts)} con atraso</div>
          )}
        </div>
      ),
    },
    {
      key: 'capital', header: 'Capital colocado', align: 'right',
      render: (r) => (
        <div>
          <b>{money(r.principal)}</b>
          <div className="bo-sub">ticket {moneyCompact(r.accounts ? r.principal / r.accounts : 0)}</div>
        </div>
      ),
    },
    {
      key: 'vencida', header: 'Vencida 90+', align: 'right',
      render: (r) => (
        <div>
          <span style={{ color: r.carteraVencida > 0 ? 'var(--bo-bad)' : undefined }}>
            {money(r.carteraVencida)}
          </span>
          <div className="bo-sub">IMOR {percent(r.delinquencyRate)}</div>
        </div>
      ),
    },
    {
      key: 'temprano', header: 'Atraso 31-90', align: 'right',
      render: (r) => (
        <span style={{ color: r.atrasoTemprano > 0 ? 'var(--bo-warn)' : undefined }}>
          {money(r.atrasoTemprano)}
        </span>
      ),
    },
    { key: 'sana', header: 'Al corriente', align: 'right', render: (r) => money(r.alCorriente) },
    { key: 'provision', header: 'Provisión', align: 'right', render: (r) => money(r.provision) },
  ];

  return (
    <Block state={state} emptyLabel="Ninguna unidad de tu alcance ha colocado cartera todavía.">
      {(d) => (
        <>
          <div className="bo-scope" style={{ marginBottom: 14 }}>
            <Chip tone="info">Atribución por origen</Chip>
            <span>
              {d.attributionNote}{' '}
              <span className="bo-page-sub" style={{ display: 'inline' }}>
                El árbol de al lado atribuye por <b>ejecutivo actual</b>: las dos cifras son
                correctas y no tienen por qué coincidir.
              </span>
            </span>
          </div>

          <Stats>
            <StatCard label="Capital colocado" value={money(d.total.principal)}
                      sub={`${count(d.total.accounts)} cuentas · ${count(d.byUnit.length)} unidades`} />
            <StatCard label="Cartera vencida (90+)" value={money(d.total.carteraVencida)}
                      tone={d.total.carteraVencida > 0 ? 'bad' : undefined}
                      sub={`IMOR ${percent(d.total.delinquencyRate)}`} />
            <StatCard label="Atraso temprano (31-90)" value={money(d.total.atrasoTemprano)}
                      tone={d.total.atrasoTemprano > 0 ? 'warn' : undefined}
                      sub="SICR — todavía no es vencida" />
            <StatCard label="Provisión IFRS-9" value={money(d.total.provision)}
                      sub="estimación sobre esta cartera" />
          </Stats>

          <CardTitled
            title={`Colocación por unidad de origen · ${count(d.byUnit.length)}`}
            action={<span className="bo-page-sub">El total de arriba es la suma exacta de estas filas</span>}
          >
            <DataTable
              columns={columns}
              rows={[...d.byUnit].sort((a, b) => b.principal - a.principal)}
              rowKey={(r) => r.unitCode}
              emptyMessage="Ninguna unidad con cartera colocada."
            />
          </CardTitled>

          <Footnote>
            La sucursal de origen se sella al activar el préstamo y <b>no cambia</b> aunque la
            cartera se reasigne después. Los créditos anteriores al sellado aparecen sin unidad
            hasta que se corra la reconciliación desde <b>Contabilidad</b>. El agregado lo calcula
            credit-portfolio en la base: una consulta para todo el subárbol, no una por rama.
          </Footnote>
        </>
      )}
    </Block>
  );
}
