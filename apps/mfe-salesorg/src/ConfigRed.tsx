import { useMemo, useState } from 'react';
import { salesOrgApi, type SalesLevel, type SalesUnit } from '@bo/api-client';
import type { ClientLimits, PlacementLimitsByType } from '@bo/shared-types';
import {
  Badge, Button, Field, Modal, NumberInput, Select, Spinner, Tabs, TextInput,
  useAsync, percent,
} from '@bo/design-system';

/**
 * Cómo está armada la red: sus escalones y el IVA que traslada cada rama.
 *
 * <p>Las dos cosas las publica el backend desde que existe `sales-org-service` y ninguna tenía
 * pantalla: la escalera de niveles se veía —está en cada selector de ruta— pero no se podía tocar,
 * y el IVA por unidad no se veía en absoluto. Quedaban para quien supiera llamar al endpoint a
 * mano, que es la peor forma de gobernar un parámetro que cambia lo que se le cobra a cada crédito.
 *
 * <p>Van juntas y aparte del árbol porque son <b>configuración de la estructura</b>, no operación
 * sobre ella: mover una sucursal se hace decenas de veces al mes; insertar un escalón, una vez al
 * año. Mezclarlas en la misma tabla haría que lo raro y lo peligroso estuviera al lado de lo
 * cotidiano.
 */
export function ConfigRed({ niveles, unidades, onCerrar, onCambio }: {
  niveles: SalesLevel[];
  /** Ya recortadas al alcance de quien mira: no se ofrece configurar lo que no gobierna. */
  unidades: SalesUnit[];
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [vista, setVista] = useState<'niveles' | 'iva' | 'colocacion'>('niveles');

  return (
    <Modal
      title="Configuración de la red"
      subtitle="Los escalones de la jerarquía, el IVA de cada rama y lo que sus distribuidoras pueden colocar"
      onClose={onCerrar}
    >
      <Tabs
        value={vista}
        onChange={setVista}
        tabs={[
          { value: 'niveles', label: 'Escalones', icon: '🪜' },
          { value: 'iva', label: 'IVA por unidad', icon: '🧾' },
          { value: 'colocacion', label: 'Política de colocación', icon: '🤝' },
        ]}
      />
      {vista === 'niveles'
        ? <Niveles niveles={niveles} onCambio={onCambio} />
        : vista === 'iva'
          ? <IvaPorUnidad unidades={unidades} onCambio={onCambio} />
          : <PoliticaColocacion unidades={unidades} />}
    </Modal>
  );
}

/**
 * La escalera de la jerarquía.
 *
 * <p>Los niveles son configurables por diseño —se puede meter «Plaza» entre Zona y Sucursal sin
 * migrar código— y los `depth` van con huecos a propósito para que insertar uno no obligue a
 * renumerar el árbol entero.
 */
function Niveles({ niveles, onCambio }: { niveles: SalesLevel[]; onCambio: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [depth, setDepth] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const escalera = useMemo(
    () => [...niveles].sort((a, b) => a.depth - b.depth),
    [niveles],
  );

  const profundidad = depth.trim() === '' ? null : Number(depth);
  const profundidadInvalida = profundidad != null && (!Number.isInteger(profundidad) || profundidad < 0);
  const listo = code.trim() !== '' && name.trim() !== '' && !profundidadInvalida;

  const crear = async () => {
    setGuardando(true); setError(null); setHecho(null);
    try {
      const l = await salesOrgApi.createLevel({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        depth: profundidad,
      });
      setHecho(`«${l.name}» queda en la posición ${l.depth}.`);
      setCode(''); setName(''); setDepth('');
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el nivel');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div className="bo-grupo-cap" style={{ marginTop: 4 }}>Escalones de hoy</div>
      <div style={{ display: 'grid', gap: 6, marginBottom: 20 }}>
        {escalera.map((l) => (
          <div key={l.levelId} className="bo-regla" style={{ gridTemplateColumns: '52px 1fr auto' }}>
            <span className="bo-regla-pts">{l.depth}</span>
            <span className="bo-regla-attr">
              {l.name}
              <span className="bo-tree-code"> {l.code}</span>
            </span>
            {!l.active && <Badge tone="muted">inactivo</Badge>}
          </div>
        ))}
      </div>

      <div className="bo-grupo-cap">Insertar un escalón</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Código" required hint="En mayúsculas, sin espacios. Es la clave estable.">
          <TextInput value={code} onChange={setCode} placeholder="PLAZA" />
        </Field>
        <Field label="Nombre" required>
          <TextInput value={name} onChange={setName} placeholder="Plaza" />
        </Field>
        <Field
          label="Posición"
          hint="Vacío lo anexa al fondo de la escalera."
          error={profundidadInvalida ? 'Tiene que ser un entero de 0 en adelante.' : undefined}
        >
          <NumberInput value={depth} onChange={setDepth} placeholder="al fondo" invalid={profundidadInvalida} />
        </Field>
      </div>

      <p className="bo-page-sub" style={{ marginTop: 10 }}>
        Con una posición, el nivel se <b>inserta</b> ahí y corre hacia abajo los que estaban en esa
        posición o más profundos. Las unidades que ya existen no se mueven: el escalón nuevo nace
        vacío y hay que colgarle unidades para que signifique algo.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <Button variant="primary" onClick={() => void crear()} disabled={!listo || guardando}>
          {guardando ? 'Creando…' : 'Crear escalón'}
        </Button>
        {hecho && <span style={{ color: 'var(--bo-ok)', fontSize: 12.5 }}>{hecho}</span>}
      </div>
      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </>
  );
}

/**
 * El IVA que traslada una rama.
 *
 * <p>La tasa se hereda hacia abajo, así que fijarla en una región la aplica a todas sus sucursales.
 * Vaciarla no es lo mismo que ponerla en cero: vaciar devuelve la unidad a heredar la de su padre;
 * cero declara la rama exenta. La distinción se dice en pantalla porque los dos casos existen y se
 * escriben casi igual.
 */
function IvaPorUnidad({ unidades, onCambio }: { unidades: SalesUnit[]; onCambio: () => void }) {
  const [unitId, setUnitId] = useState('');
  const [tasa, setTasa] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const elegida = unidades.find((u) => u.unitId === unitId);

  // La lista de unidades del árbol no trae la tasa; se pide la unidad al elegirla.
  const detalle = useAsync(
    () => (unitId ? salesOrgApi.unit(unitId) : Promise.resolve(null)),
    [unitId],
  );
  const actual = detalle.data?.vatRate;

  const numero = tasa.trim() === '' ? null : Number(tasa);
  const invalida = numero != null && (!Number.isFinite(numero) || numero < 0 || numero > 100);

  const guardar = async (limpiar: boolean) => {
    if (!elegida) return;
    setGuardando(true); setError(null); setHecho(null);
    try {
      // Se teclea en porcentaje —«16»— y el backend guarda la fracción. Pedir 0.16 es pedirle a
      // quien configura que haga la conversión, y ahí es donde aparece un IVA del 1600%.
      const r = await salesOrgApi.setVatRate(elegida.code, limpiar || numero == null ? null : numero / 100);
      setHecho(limpiar || r.vatRate == null
        ? `${elegida.name} vuelve a heredar el IVA de su rama superior.`
        : `${elegida.name} y su subárbol trasladan ${percent(r.vatRate * 100)}.`);
      setTasa('');
      detalle.reload();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo fijar el IVA');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Field label="Unidad" required hint="Sólo se ofrecen las que están dentro de tu alcance.">
        <Select
          value={unitId}
          onChange={setUnitId}
          placeholder="Elige una unidad…"
          options={[...unidades]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((u) => ({ value: u.unitId, label: `${u.name} · ${u.code}` }))}
        />
      </Field>

      {unitId && (
        <div className="bo-ruta" style={{ margin: '14px 0' }}>
          <div className="bo-def-k">IVA propio de esta unidad</div>
          <div className="bo-ruta-v">
            {detalle.loading ? 'Consultando…'
              : actual == null
                ? 'Sin tasa propia — hereda la de su rama superior'
                : percent(actual * 100)}
          </div>
        </div>
      )}

      <Field
        label="Nueva tasa"
        hint="Se teclea en porcentaje. Se aplica a la unidad y a todo lo que cuelga de ella."
        error={invalida ? 'Tiene que estar entre 0 y 100.' : undefined}
      >
        <NumberInput value={tasa} onChange={setTasa} suffix="%" placeholder="16" disabled={!unitId} invalid={invalida} />
      </Field>

      <p className="bo-page-sub" style={{ marginTop: 10 }}>
        Fijar <b>0%</b> declara la rama exenta. Para que vuelva a heredar la tasa de su rama
        superior hay que <b>quitarle</b> la suya, que no es lo mismo.
      </p>

      {/* Se dice porque no decirlo es peor: una pantalla de configuración que guarda y no surte
          efecto hace creer que la tasa cambió, y el error se descubre en un CFDI. La tasa que
          termina en el crédito la sella `credit-portfolio` al crearlo, y hoy recibe siempre `null`
          desde originación —que todavía no resuelve la sucursal—, así que cae al nacional. */}
      <div className="bo-alert bo-huerfanos" style={{ marginTop: 14 }}>
        <b>Todavía no surte efecto en los créditos nuevos.</b> La tasa se guarda en la unidad, pero
        quien la sella en el crédito es <b>credit-portfolio</b> al crearlo, y hoy originación no le
        resuelve la sucursal: cada crédito nace con el IVA nacional por defecto. Esto queda
        configurado y listo para cuando originación resuelva la plaza — no cambia lo que se factura
        hoy.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          onClick={() => void guardar(false)}
          disabled={!unitId || tasa.trim() === '' || invalida || guardando}
        >
          {guardando ? 'Guardando…' : 'Fijar IVA'}
        </Button>
        <Button
          onClick={() => void guardar(true)}
          disabled={!unitId || guardando || actual == null}
          title="Le quita la tasa propia; vuelve a heredar la de su rama superior"
        >
          Quitar tasa propia
        </Button>
        {hecho && <span style={{ color: 'var(--bo-ok)', fontSize: 12.5 }}>{hecho}</span>}
      </div>

      {detalle.loading && !detalle.data && <Spinner />}
      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </>
  );
}

const LIMITES: Array<{ key: keyof ClientLimits; label: string; suffix?: string; prefix?: string; hint: string }> = [
  { key: 'maxLoanAmount', label: 'Monto por préstamo', prefix: '$', hint: 'Lo más que puede ser una colocación' },
  { key: 'maxOutstanding', label: 'Saldo con la distribuidora', prefix: '$', hint: 'Lo que puede deber sumando sus préstamos vivos y el nuevo' },
  { key: 'maxActiveLoans', label: 'Préstamos vivos', hint: 'A la vez, contando el nuevo' },
  { key: 'maxTerm', label: 'Plazo', suffix: 'quincenas', hint: 'El más largo que se le puede dar' },
];

type Captura = Record<'nuevo' | 'revolvente', Record<keyof ClientLimits, string>>;

const vacia = (): Captura => ({
  nuevo: { maxLoanAmount: '', maxOutstanding: '', maxActiveLoans: '', maxTerm: '' },
  revolvente: { maxLoanAmount: '', maxOutstanding: '', maxActiveLoans: '', maxTerm: '' },
});

/**
 * Lo que las distribuidoras de una rama pueden colocarle a cada tipo de cliente.
 *
 * <p>Sólo existe para la línea de distribuidora: los créditos directos los acota el score. Se declara en la sucursal
 * (o más arriba) y la hereda todo lo que cuelga de ella; una distribuidora puede tener la suya, sólo más estricta. Un
 * límite que se deja vacío se hereda. sales-org la valida contra el producto (monto y plazo de la línea) al guardar.
 */
function PoliticaColocacion({ unidades }: { unidades: SalesUnit[] }) {
  const [unitId, setUnitId] = useState('');
  const [captura, setCaptura] = useState<Captura>(vacia());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const elegida = unidades.find((u) => u.unitId === unitId);
  const politica = useAsync(
    () => (elegida ? salesOrgApi.placementPolicy(elegida.code) : Promise.resolve(null)),
    [elegida?.code],
  );

  const numero = (v: string) => (v.trim() === '' ? null : Number(v));
  const invalido = (Object.values(captura) as Array<Record<keyof ClientLimits, string>>)
    .some((c) => Object.values(c).some((v) => v.trim() !== '' && (!Number.isFinite(Number(v)) || Number(v) <= 0)));

  const cuerpo = (): PlacementLimitsByType => {
    const uno = (c: Record<keyof ClientLimits, string>): ClientLimits | null => {
      const l: ClientLimits = {
        maxLoanAmount: numero(c.maxLoanAmount), maxOutstanding: numero(c.maxOutstanding),
        maxActiveLoans: numero(c.maxActiveLoans), maxTerm: numero(c.maxTerm),
      };
      return Object.values(l).every((v) => v == null) ? null : l;
    };
    return { nuevo: uno(captura.nuevo), revolvente: uno(captura.revolvente) };
  };

  const guardar = async (limpiar: boolean) => {
    if (!elegida) return;
    setGuardando(true); setError(null); setHecho(null);
    try {
      const r = limpiar ? await salesOrgApi.clearPlacementPolicy(elegida.code)
        : await salesOrgApi.setPlacementPolicy(elegida.code, cuerpo());
      setHecho(limpiar ? `${elegida.name} vuelve a heredar la política de su rama superior.`
        : `${elegida.name} y lo que cuelga de ella colocan con su política${r.inheritedFrom && r.inheritedFrom !== elegida.code ? ` (más lo que hereda de ${r.inheritedFrom})` : ''}.`);
      setCaptura(vacia());
      politica.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la política');
    } finally {
      setGuardando(false);
    }
  };

  const efectiva = politica.data?.effective;
  const declarada = politica.data?.declared;
  const valor = (l: ClientLimits | null | undefined, k: keyof ClientLimits) => {
    const v = l?.[k];
    if (v == null) return '—';
    return k === 'maxLoanAmount' || k === 'maxOutstanding' ? `$${v.toLocaleString('es-MX')}` : k === 'maxTerm' ? `${v} quincenas` : String(v);
  };

  return (
    <>
      <Field label="Unidad" required hint="La sucursal, o una distribuidora para darle su propia política (sólo más estricta).">
        <Select value={unitId} onChange={(v) => { setUnitId(v); setCaptura(vacia()); setHecho(null); setError(null); }}
          placeholder="Elige una unidad…"
          options={[...unidades].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.unitId, label: `${u.name} · ${u.code}` }))} />
      </Field>

      {unitId && (
        <div className="bo-ruta" style={{ margin: '14px 0' }}>
          <div className="bo-def-k">Lo que le aplica hoy</div>
          <div className="bo-ruta-v">
            {politica.loading ? 'Consultando…'
              : !politica.data?.configured ? 'Sin política: sus distribuidoras colocan dentro de lo que permite el producto'
                : `Viene de ${politica.data.inheritedFrom}${declarada ? ' (declara la suya)' : ''}`}
          </div>
          {efectiva && (
            <table style={{ marginTop: 8, fontSize: 12.5, borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ textAlign: 'left', paddingRight: 16 }}></th><th style={{ textAlign: 'right', paddingRight: 16 }}>Nuevo</th><th style={{ textAlign: 'right' }}>Revolvente</th></tr></thead>
              <tbody>
                {LIMITES.map((l) => (
                  <tr key={l.key}>
                    <td style={{ paddingRight: 16 }}>{l.label}</td>
                    <td style={{ textAlign: 'right', paddingRight: 16 }}>{valor(efectiva.nuevo, l.key)}</td>
                    <td style={{ textAlign: 'right' }}>{valor(efectiva.revolvente, l.key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(['nuevo', 'revolvente'] as const).map((tipo) => (
        <div key={tipo} style={{ marginTop: 10 }}>
          <div className="bo-field-label" style={{ marginBottom: 6 }}>
            Cliente {tipo} {tipo === 'revolvente' ? <Badge tone="ok">ya pagó un préstamo</Badge> : <Badge tone="muted">sin préstamo pagado</Badge>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {LIMITES.map((l) => (
              <Field key={l.key} label={l.label} hint={l.hint}>
                <NumberInput value={captura[tipo][l.key]} disabled={!unitId} suffix={l.suffix} placeholder={valor(efectiva?.[tipo], l.key)}
                  onChange={(v) => setCaptura((c) => ({ ...c, [tipo]: { ...c[tipo], [l.key]: v } }))} />
              </Field>
            ))}
          </div>
        </div>
      ))}

      <p className="bo-page-sub" style={{ marginTop: 10 }}>
        Lo que dejes vacío se hereda de la rama superior. Los créditos directos no la usan: su monto lo define el score.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={() => void guardar(false)} disabled={!unitId || guardando || invalido}>
          {guardando ? 'Guardando…' : 'Guardar política'}
        </Button>
        <Button onClick={() => void guardar(true)} disabled={!unitId || guardando || !declarada}
          title="Le quita su política propia; vuelve a heredar la de su rama superior">
          Quitar política propia
        </Button>
        {hecho && <span style={{ color: 'var(--bo-ok)', fontSize: 12.5 }}>{hecho}</span>}
      </div>
      {invalido && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 8 }}>Los límites son números mayores que cero.</p>}
      {politica.loading && !politica.data && <Spinner />}
      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </>
  );
}
