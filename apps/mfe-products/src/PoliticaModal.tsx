import { useMemo, useState } from 'react';
import {
  scoringApi, type NuevaPolitica, type VariableScoring,
} from '@bo/api-client';
import {
  useAsync, Block, Modal, Button, Checkbox, Field, TextInput, NumberInput, Select, Badge, Spinner,
} from '@bo/design-system';
import { PRODUCT_TYPE_LABELS } from '@bo/shared-types';

/**
 * Alta de una política de riesgo: qué se mira del buró, cuánto pesa y qué se decide.
 *
 * <p>Antes esto sólo existía en la base: las políticas se sembraban con SQL y cambiar un umbral
 * era un changeset. Eso convierte una decisión de negocio —a quién le prestamos— en un despliegue,
 * y en la práctica significa que nunca se ajusta.
 *
 * <p>El formulario se construye desde el <b>catálogo del motor</b>, no desde una lista escrita
 * aquí. Cada variable trae qué mide, en qué unidad y si acepta tipo de crédito o ventana de
 * meses, así que agregar una variable al motor la hace configurable sin tocar esta pantalla — y,
 * más importante, la consola nunca puede ofrecer una regla que el motor no sepa evaluar.
 *
 * <p>La matriz de riesgo va abajo y es obligatoria: sin ella el score es un número sin
 * consecuencia. Es la que traduce puntos en aprobación automática, revisión manual o rechazo.
 */

const OPERADORES = [
  { value: 'GTE', label: '≥  mayor o igual' },
  { value: 'GT', label: '>  mayor que' },
  { value: 'LTE', label: '≤  menor o igual' },
  { value: 'LT', label: '<  menor que' },
  { value: 'EQ', label: '=  igual a' },
];

const TIPOS_PROSPECTO = [
  { value: 'INDIVIDUAL', label: 'Persona física' },
  { value: 'BUSINESS', label: 'Empresa' },
  { value: 'DISTRIBUTOR', label: 'Distribuidor' },
];

/** Los tipos de crédito del buró (claves CDC). Sólo se ofrecen donde la variable los acepta. */
const TIPOS_CREDITO = [
  { value: '', label: 'Todos los créditos' },
  { value: 'TC', label: 'TC · tarjeta de crédito' },
  { value: 'FM', label: 'FM · financiera' },
  { value: 'PP', label: 'PP · préstamo personal' },
  { value: 'HI', label: 'HI · hipotecario' },
  { value: 'AU', label: 'AU · automotriz' },
];

interface ReglaBorrador {
  id: number;
  ruleType: string;
  operator: string;
  thresholdValue: string;
  scoreContribution: string;
  disqualifying: boolean;
  creditType: string;
  periodMonths: string;
}

let siguienteId = 1;

export function PoliticaModal({ tipoProductoInicial, onClose, onCreada }: {
  /** Preseleccionado cuando se llega desde un producto recién creado. */
  tipoProductoInicial?: string;
  onClose: () => void;
  onCreada: () => void;
}) {
  const catalogo = useAsync(() => scoringApi.variables(), []);
  const requisitos = useAsync(() => scoringApi.requisitosSinHistorial(), []);

  const [prospectType, setProspectType] = useState('INDIVIDUAL');
  const [productTypeIntent, setProductTypeIntent] = useState(tipoProductoInicial ?? 'PERSONAL_LOAN');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [reglas, setReglas] = useState<ReglaBorrador[]>([]);
  // La matriz arranca con los tres niveles porque los tres son obligatorios: una política que
  // sólo define BAJO deja sin destino a todo lo que no alcance ese score.
  const [umbrales, setUmbrales] = useState({ bajo: '200', medio: '100' });
  // Quien no tiene historial en buró: score 0 por defecto, que con estas bandas es rechazo.
  const [scoreSinHistorial, setScoreSinHistorial] = useState('0');
  const [pideSinHistorial, setPideSinHistorial] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const porDimension = useMemo(() => {
    const m = new Map<string, VariableScoring[]>();
    (catalogo.data ?? []).forEach((v) => m.set(v.dimension, [...(m.get(v.dimension) ?? []), v]));
    return m;
  }, [catalogo.data]);

  const variablePorTipo = useMemo(
    () => new Map((catalogo.data ?? []).map((v) => [v.tipo, v])),
    [catalogo.data],
  );

  const agregar = (tipo: string) => setReglas((r) => [...r, {
    id: siguienteId++, ruleType: tipo, operator: 'GTE', thresholdValue: '',
    scoreContribution: '', disqualifying: false, creditType: '', periodMonths: '12',
  }]);

  const cambiar = (id: number, campo: keyof ReglaBorrador, valor: string | boolean) =>
    setReglas((rs) => rs.map((r) => (r.id === id ? { ...r, [campo]: valor } : r)));

  const quitar = (id: number) => setReglas((rs) => rs.filter((r) => r.id !== id));

  /** Qué falta para poder guardar. Se dice antes de intentarlo, no como error del servidor. */
  const faltan = useMemo(() => {
    const f: string[] = [];
    if (!name.trim()) f.push('un nombre para la política');
    if (reglas.length === 0) f.push('al menos una regla');
    if (reglas.some((r) => r.thresholdValue === '' || Number.isNaN(Number(r.thresholdValue)))) {
      f.push('el umbral de todas las reglas');
    }
    if (reglas.some((r) => !r.disqualifying
        && (r.scoreContribution === '' || Number.isNaN(Number(r.scoreContribution))))) {
      f.push('los puntos de las reglas que no descalifican');
    }
    const bajo = Number(umbrales.bajo);
    const medio = Number(umbrales.medio);
    if (Number.isNaN(bajo) || Number.isNaN(medio)) f.push('los cortes de la matriz de riesgo');
    // Un corte de riesgo bajo por debajo del medio invierte la escala en silencio: todo caería en
    // BAJO y la revisión manual dejaría de ocurrir sin que nada falle.
    else if (bajo <= medio) f.push('que el corte de riesgo BAJO sea mayor que el de MEDIO');
    // Lo mismo que valida el motor al publicar, dicho antes de intentarlo.
    const banda = bandaSinHistorial(scoreSinHistorial, umbrales);
    if (banda === null) f.push('el score sin historial');
    else if (banda === 'BAJO') f.push('que el score sin historial no caiga en BAJO: sin historial no se aprueba en automático');
    else if (banda === 'ALTO' && pideSinHistorial.length > 0) {
      f.push('subir el score sin historial a MEDIO o quitar los datos adicionales: en rechazo nadie los revisa');
    }
    return f;
  }, [name, reglas, umbrales, scoreSinHistorial, pideSinHistorial]);

  const bandaSH = bandaSinHistorial(scoreSinHistorial, umbrales);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      const body: NuevaPolitica = {
        prospectType,
        productTypeIntent,
        name: name.trim(),
        description: description.trim() || undefined,
        rules: reglas.map((r) => {
          const v = variablePorTipo.get(r.ruleType);
          return {
            ruleType: r.ruleType,
            creditType: v?.aplicaTipoCredito && r.creditType ? r.creditType : null,
            operator: r.operator,
            thresholdValue: Number(r.thresholdValue),
            // Una regla que descalifica no necesita puntos: su efecto es cortar la evaluación.
            // Se manda un castigo grande igualmente para que el score refleje lo ocurrido si
            // alguien mira el detalle.
            scoreContribution: r.disqualifying ? -500 : Number(r.scoreContribution),
            disqualifying: r.disqualifying,
            periodMonths: v?.aplicaPeriodo && r.periodMonths ? Number(r.periodMonths) : null,
            description: descripcionRegla(v, r),
          };
        }),
        thresholds: [
          { riskLevel: 'BAJO', minScore: Number(umbrales.bajo), decision: 'AUTO_APPROVED' },
          { riskLevel: 'MEDIO', minScore: Number(umbrales.medio), decision: 'MANUAL_REVIEW' },
          // El piso es deliberadamente inalcanzable: ALTO es el destino de todo lo que no llegó
          // a los otros dos, no una banda con su propio corte.
          { riskLevel: 'ALTO', minScore: -9999, decision: 'REJECTED' },
        ],
        noHistory: { score: Number(scoreSinHistorial), requirements: pideSinHistorial },
      };
      await scoringApi.crearPolitica(body);
      onCreada();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la política');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      title="Nueva política de riesgo"
      subtitle="Qué se mira del buró, cuánto pesa cada cosa y qué se decide con el resultado"
      onClose={onClose}
      size="wide"
      actions={
        <Button variant="primary" onClick={() => void guardar()}
                disabled={faltan.length > 0 || guardando}>
          {guardando ? 'Creando…' : 'Crear política'}
        </Button>
      }
    >
      {guardando ? <Spinner /> : (
        <div style={{ display: 'grid', gap: 20 }}>
          <section>
            <div className="bo-grupo-cap">A quién y a qué aplica</div>
            <div className="bo-defs cols-3">
              <Field label="Tipo de prospecto">
                <Select value={prospectType} onChange={setProspectType} options={TIPOS_PROSPECTO} />
              </Field>
              <Field label="Tipo de producto">
                <Select value={productTypeIntent} onChange={setProductTypeIntent}
                        options={Object.entries(PRODUCT_TYPE_LABELS)
                          .map(([value, label]) => ({ value, label }))} />
              </Field>
              <Field label="Nombre">
                <TextInput value={name} onChange={setName}
                           placeholder="Crédito personal — persona física v2" />
              </Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Descripción (opcional)">
                <TextInput value={description} onChange={setDescription}
                           grow placeholder="Qué cambia respecto de la política vigente y por qué" />
              </Field>
            </div>
            <p className="bo-page-sub" style={{ marginTop: 8 }}>
              Sólo puede haber una política activa por combinación de prospecto y producto. Si ya
              existe una, ésta la sustituye y sube de versión — la anterior queda registrada.
            </p>
          </section>

          <section>
            <div className="bo-grupo-cap">Variables del buró</div>
            <Block state={catalogo} emptyLabel="El motor no publicó su catálogo de variables.">
              {(vars) => (
                <>
                  {vars.length === 0 && <p className="bo-page-sub">Sin variables disponibles.</p>}
                  {[...porDimension.entries()].map(([dim, lista]) => (
                    <div key={dim} style={{ marginBottom: 10 }}>
                      <div className="bo-page-sub" style={{ marginBottom: 4 }}>{dimensionLabel(dim)}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {lista.map((v) => (
                          <button key={v.tipo} type="button" className="bo-cap-chip"
                                  style={{ cursor: 'pointer' }}
                                  title={v.explicacion}
                                  onClick={() => agregar(v.tipo)}>
                            + {v.etiqueta}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </Block>
          </section>

          <section>
            <div className="bo-grupo-cap">Reglas · {reglas.length}</div>
            {reglas.length === 0 ? (
              <p className="bo-page-sub">
                Agrega variables de arriba. Cada regla compara una variable contra un umbral y suma
                o resta puntos; las que descalifican mandan a rechazo sin evaluar el resto.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {reglas.map((r) => {
                  const v = variablePorTipo.get(r.ruleType);
                  return (
                    <div key={r.id} className="bo-regla-edit">
                      <div className="bo-regla-edit-nombre">
                        <b>{v?.etiqueta ?? r.ruleType}</b>
                        <div className="bo-tree-code">{unidadLabel(v?.unidad)}</div>
                      </div>
                      <Select value={r.operator} onChange={(x) => cambiar(r.id, 'operator', x)}
                              options={OPERADORES} />
                      <NumberInput value={r.thresholdValue}
                                   onChange={(x) => cambiar(r.id, 'thresholdValue', x)}
                                   placeholder="umbral" />
                      {v?.aplicaTipoCredito && (
                        <Select value={r.creditType} onChange={(x) => cambiar(r.id, 'creditType', x)}
                                options={TIPOS_CREDITO} />
                      )}
                      {v?.aplicaPeriodo && (
                        <NumberInput value={r.periodMonths}
                                     onChange={(x) => cambiar(r.id, 'periodMonths', x)}
                                     placeholder="meses" />
                      )}
                      {r.disqualifying ? (
                        <Badge tone="bad">descalifica</Badge>
                      ) : (
                        <NumberInput value={r.scoreContribution}
                                     onChange={(x) => cambiar(r.id, 'scoreContribution', x)}
                                     placeholder="± puntos" />
                      )}
                      <Checkbox
                        checked={r.disqualifying}
                        onChange={(v) => cambiar(r.id, 'disqualifying', v)}
                        label={<span className="bo-page-sub">descalifica</span>}
                        title="Por sí sola tumba la solicitud, sin evaluar el resto"
                      />
                      <button type="button" className="bo-crumb" onClick={() => quitar(r.id)}>quitar</button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="bo-grupo-cap">Matriz de riesgo · qué se decide con el score</div>
            <div className="bo-umbrales">
              <div className="bo-umbral n-bajo">
                <div className="bo-umbral-n">BAJO</div>
                <Field label="score ≥">
                  <NumberInput value={umbrales.bajo}
                               onChange={(x) => setUmbrales((u) => ({ ...u, bajo: x }))} />
                </Field>
                <div className="bo-umbral-d">aprobación automática</div>
              </div>
              <div className="bo-umbral n-medio">
                <div className="bo-umbral-n">MEDIO</div>
                <Field label="score ≥">
                  <NumberInput value={umbrales.medio}
                               onChange={(x) => setUmbrales((u) => ({ ...u, medio: x }))} />
                </Field>
                <div className="bo-umbral-d">a revisión manual</div>
              </div>
              <div className="bo-umbral n-alto">
                <div className="bo-umbral-n">ALTO</div>
                <div className="bo-umbral-s">todo lo demás</div>
                <div className="bo-umbral-d">rechazo automático</div>
              </div>
            </div>
            <p className="bo-page-sub" style={{ marginTop: 8 }}>
              ALTO no lleva corte propio: es el destino de lo que no alcanzó los otros dos. Así
              ninguna solicitud puede quedarse sin decisión.
            </p>
          </section>

          <section>
            <div className="bo-grupo-cap">Sin historial en buró · qué se hace con quien no tiene</div>
            <p className="bo-page-sub" style={{ margin: '0 0 8px' }}>
              Sin historial no hay reglas que evaluar. Se le asigna este score y pasa por la misma
              matriz de arriba. Si cae en revisión, se le pueden pedir datos adicionales —por ejemplo,
              constancia de estudios en un producto para estudiantes—.
            </p>
            <div className="bo-defs cols-3">
              <Field label="Score sin historial">
                <NumberInput value={scoreSinHistorial} onChange={setScoreSinHistorial} />
              </Field>
              <div>
                <div className="bo-def-k">Cae en</div>
                <div className="bo-def-v">
                  {bandaSH === null ? '—'
                    : bandaSH === 'BAJO' ? <Badge tone="bad">BAJO · no permitido sin historial</Badge>
                    : bandaSH === 'MEDIO' ? <Badge tone="warn">MEDIO · a revisión manual</Badge>
                    : <Badge tone="muted">ALTO · rechazo</Badge>}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="bo-def-k" style={{ marginBottom: 4 }}>Datos adicionales que se piden</div>
              <Block state={requisitos} emptyLabel="El motor no publicó qué se puede pedir.">
                {(lista) => (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {lista.map((r) => (
                      <Checkbox
                        key={r.code}
                        checked={pideSinHistorial.includes(r.code)}
                        onChange={(on) => setPideSinHistorial((xs) =>
                          on ? [...xs, r.code] : xs.filter((x) => x !== r.code))}
                        label={<span className="bo-page-sub">{r.label}</span>}
                        title={bandaSH === 'MEDIO' ? undefined : 'Sólo se piden cuando la solicitud va a revisión'}
                      />
                    ))}
                  </div>
                )}
              </Block>
            </div>
          </section>

          {faltan.length > 0 && (
            <div className="bo-alert">
              Falta {faltan.join(', ')}.
            </div>
          )}
          {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13 }}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * En qué banda cae el score sin historial, con los cortes que se están editando. Misma regla que el
 * motor: la de mayor corte que se alcanza; ALTO es todo lo demás.
 */
function bandaSinHistorial(score: string, umbrales: { bajo: string; medio: string }): 'BAJO' | 'MEDIO' | 'ALTO' | null {
  const s = Number(score);
  if (score.trim() === '' || Number.isNaN(s)) return null;
  if (s >= Number(umbrales.bajo)) return 'BAJO';
  if (s >= Number(umbrales.medio)) return 'MEDIO';
  return 'ALTO';
}

/** La regla dicha en una línea, para que quede legible en la ficha del producto. */
function descripcionRegla(v: VariableScoring | undefined, r: ReglaBorrador): string {
  const op = { GTE: '≥', GT: '>', LTE: '≤', LT: '<', EQ: '=' }[r.operator] ?? r.operator;
  const efecto = r.disqualifying ? 'descalifica'
    : `${Number(r.scoreContribution) > 0 ? '+' : ''}${r.scoreContribution} pts`;
  const tipo = v?.aplicaTipoCredito && r.creditType ? ` (${r.creditType})` : '';
  return `${v?.etiqueta ?? r.ruleType}${tipo} ${op} ${r.thresholdValue} → ${efecto}`;
}

function dimensionLabel(d: string): string {
  const map: Record<string, string> = {
    COMPORTAMIENTO: 'Comportamiento de pago',
    EXPOSICION: 'Exposición y capacidad de pago',
    PERFIL: 'Perfil crediticio',
    PERSONA: 'Perfil de la persona',
  };
  return map[d] ?? d;
}

function unidadLabel(u: string | undefined): string {
  const map: Record<string, string> = {
    DIAS: 'días', MESES: 'meses', ANIOS: 'años', PESOS: 'pesos', PORCENTAJE: '%',
    PUNTOS: 'puntos', CUENTAS: 'cuentas', PAGOS: 'pagos', CONSULTAS: 'consultas',
    PERSONAS: 'personas',
  };
  return u ? map[u] ?? u.toLowerCase() : '';
}
