import { useState } from 'react';
import {
  collectionsQueueApi,
  type ContactChannel, type ContactResult, type DelinquencyBucket,
  type GestionEnCola, type PromesaEnCola, type PromiseStatus, type VentanaContacto,
} from '@bo/api-client';
import {
  useAsync, Badge, Block, Button, CardTitled, Chip, DataTable, Field, Footnote,
  Select, StatCard, Stats, Toolbar, count, date, dateTime, money,
  type Column, type Tone,
} from '@bo/design-system';
import { BUCKET_LABEL, RESULTADO_CONTACTO, bucketTono } from './lenguaje';

const ESTADO_PROMESA: Record<PromiseStatus, { texto: string; tono: Tone }> = {
  ACTIVE: { texto: 'Vigente', tono: 'ok' },
  KEPT: { texto: 'Cumplida', tono: 'ok' },
  BROKEN: { texto: 'Rota', tono: 'bad' },
  EXPIRED: { texto: 'Vencida', tono: 'warn' },
};

const CANAL: Record<string, string> = {
  PHONE: 'Teléfono', SMS: 'SMS', WHATSAPP: 'WhatsApp', EMAIL: 'Correo',
  PUSH: 'Notificación', FIELD_VISIT: 'Visita', LETTER: 'Carta',
};

/**
 * Por qué no se puede llamar ahora, dicho antes de intentarlo.
 *
 * La ventana de contacto y el tope de intentos los manda el servidor con la respuesta: son reglas,
 * no sugerencias visuales. Traducirlas aquí es lo que evita que el gestor descubra el límite
 * recibiendo un 422 después de haber redactado la gestión.
 */
function porQueNo(p: PromesaEnCola, v: VentanaContacto): string | null {
  if (p.contactable) return null;
  if (p.contactCapReached) return `Ya se intentó ${p.attemptsToday} ${p.attemptsToday === 1 ? 'vez' : 'veces'} hoy — tope ${v.maxAttemptsPerDay}`;
  if (!v.withinWindowNow) return `Fuera de ventana — se puede de ${v.startHour}:00 a ${v.endHour}:00`;
  return 'No contactable ahora';
}

/**
 * Promesas de pago cruzando casos.
 *
 * <p>Sólo se veían abriendo un caso, así que «qué vence hoy» exigía abrirlos uno por uno. La
 * consulta la resuelve `collections` con su índice; aquí sólo se lee.
 *
 * <p>Una promesa **no cambia el tramo ni la reserva**: suspende la escalada mientras esté vigente.
 * Al romperse, el caso retoma la estrategia que le tocaba por días de atraso — por eso el tramo se
 * muestra al lado del estado y no en su lugar.
 */
export function Promesas() {
  const [status, setStatus] = useState<PromiseStatus | ''>('');
  const [bucket, setBucket] = useState<DelinquencyBucket | ''>('');
  const [hoy, setHoy] = useState(false);

  const state = useAsync(() => collectionsQueueApi.promises({
    status: status ? [status] : undefined,
    bucket: bucket ? [bucket] : undefined,
    dueToday: hoy || undefined,
    size: 100,
  }), [status, bucket, hoy]);

  const filas = state.data?.content ?? [];
  const ventana = state.data?.contactWindow;
  const vigentes = filas.filter((p) => p.status === 'ACTIVE');

  const columns: Array<Column<PromesaEnCola>> = [
    {
      key: 'quien', header: 'Deudor',
      render: (p) => (
        <div>
          <b>{p.obligorName ?? 'Sin nombre resuelto'}</b>
          <div className="bo-sub">{p.productType ?? '—'}</div>
        </div>
      ),
    },
    { key: 'monto', header: 'Prometió', align: 'right', render: (p) => money(p.amount) },
    {
      key: 'cuando', header: 'Para el',
      render: (p) => (
        <div>
          <span style={{ fontSize: 12.5 }}>{date(p.promisedDate)}</span>
          {p.dueToday && <div className="bo-sub" style={{ color: 'var(--bo-warn)' }}>vence hoy</div>}
          {p.overdue && <div className="bo-sub" style={{ color: 'var(--bo-bad)' }}>ya se pasó</div>}
        </div>
      ),
    },
    {
      key: 'estado', header: 'Estado',
      render: (p) => {
        const e = ESTADO_PROMESA[p.status] ?? { texto: p.status, tono: 'muted' as Tone };
        return <Badge tone={e.tono}>{e.texto}</Badge>;
      },
    },
    {
      key: 'tramo', header: 'Tramo',
      render: (p) => (
        <div>
          <Badge tone={bucketTono(p.currentBucket)}>{BUCKET_LABEL[p.currentBucket]}</Badge>
          <div className="bo-sub">{p.daysDelinquent} días</div>
        </div>
      ),
    },
    {
      key: 'contacto', header: '¿Se puede llamar?',
      render: (p) => {
        if (!ventana) return <span className="bo-sub">—</span>;
        const razon = porQueNo(p, ventana);
        return razon
          ? <div><Badge tone="muted">No ahora</Badge><div className="bo-sub">{razon}</div></div>
          : <div><Badge tone="ok">Sí</Badge><div className="bo-sub">{p.attemptsToday} intentos hoy</div></div>;
      },
    },
    {
      key: 'ultimo', header: 'Último resultado',
      render: (p) => (p.lastContactResult
        ? <Chip>{RESULTADO_CONTACTO[p.lastContactResult] ?? p.lastContactResult}</Chip>
        : <span className="bo-sub">sin contacto</span>),
    },
  ];

  return (
    <>
      <Stats>
        <StatCard label="Promesas vigentes" value={count(vigentes.length)}
                  sub="suspenden la escalada mientras duran" />
        <StatCard label="Vencen hoy" value={count(filas.filter((p) => p.dueToday).length)}
                  tone={filas.some((p) => p.dueToday) ? 'warn' : undefined} sub="hay que confirmarlas" />
        <StatCard label="Ya se pasaron" value={count(filas.filter((p) => p.overdue).length)}
                  tone={filas.some((p) => p.overdue) ? 'bad' : undefined} sub="vivas y fuera de fecha" />
        <StatCard label="Monto prometido" value={money(vigentes.reduce((s, p) => s + p.amount, 0))}
                  sub="de las vigentes" />
      </Stats>

      {ventana && !ventana.withinWindowNow && (
        <div className="bo-alert bo-huerfanos">
          <b>Fuera de ventana de contacto.</b> Se puede llamar de {ventana.startHour}:00 a{' '}
          {ventana.endHour}:00, con un tope de {ventana.maxAttemptsPerDay} intentos por día. La
          regla la aplica el servidor; aquí sólo se anticipa.
        </div>
      )}

      <Toolbar>
        <Field label="Estado">
          <Select value={status} onChange={(v) => setStatus(v as PromiseStatus | '')}
                  placeholder="Todos los estados" ariaLabel="Estado de la promesa"
                  options={(Object.keys(ESTADO_PROMESA) as PromiseStatus[])
                    .map((s) => ({ value: s, label: ESTADO_PROMESA[s].texto }))} />
        </Field>
        <Field label="Tramo">
          <Select value={bucket} onChange={(v) => setBucket(v as DelinquencyBucket | '')}
                  placeholder="Todos los tramos" ariaLabel="Tramo de mora"
                  options={(Object.keys(BUCKET_LABEL) as DelinquencyBucket[])
                    .map((b) => ({ value: b, label: BUCKET_LABEL[b] }))} />
        </Field>
        <Button selected={hoy} onClick={() => setHoy((v) => !v)}>Sólo las que vencen hoy</Button>
      </Toolbar>

      <CardTitled
        title={`Promesas${state.data ? ` · ${count(state.data.totalElements)}` : ''}`}
        action={<span className="bo-page-sub">Cruzando todos los casos, no dentro de uno</span>}
      >
        <Block state={state} emptyLabel="No hay promesas registradas.">
          {() => (
            <DataTable columns={columns} rows={filas} rowKey={(p) => p.promiseId}
                       emptyMessage="Ninguna promesa con esos filtros." />
          )}
        </Block>
      </CardTitled>

      <Footnote>
        Una promesa <b>no</b> cambia el tramo ni libera estimación: sólo suspende la escalada
        mientras esté vigente. Al romperse, el caso retoma la estrategia que le tocaba por días de
        atraso. Registrar una promesa nueva se hace desde el caso, que es donde están los topes
        contra los que se valida.
      </Footnote>
    </>
  );
}

/**
 * Intentos de contacto cruzando casos.
 *
 * <p>Es el registro de qué se intentó y con qué resultado. No se captura desde aquí —eso ocurre en
 * el caso, con sus límites a la vista—: esta pantalla existe para ver la cobertura de la gestión,
 * que es una pregunta de supervisión y no de captura.
 */
export function Gestiones() {
  const [result, setResult] = useState<ContactResult | ''>('');
  const [channel, setChannel] = useState<ContactChannel | ''>('');
  const [bucket, setBucket] = useState<DelinquencyBucket | ''>('');

  const state = useAsync(() => collectionsQueueApi.contactAttempts({
    result: result ? [result] : undefined,
    channel: channel ? [channel] : undefined,
    bucket: bucket ? [bucket] : undefined,
    size: 100,
  }), [result, channel, bucket]);

  const filas = state.data?.content ?? [];
  const efectivos = filas.filter((g) => g.result === 'ANSWERED' || g.result === 'PROMISE_MADE').length;

  const columns: Array<Column<GestionEnCola>> = [
    {
      key: 'quien', header: 'Deudor',
      render: (g) => (
        <div>
          <b>{g.obligorName ?? 'Sin nombre resuelto'}</b>
          <div className="bo-sub">{g.productType ?? '—'}</div>
        </div>
      ),
    },
    { key: 'cuando', header: 'Cuándo', render: (g) => <span style={{ fontSize: 12.5 }}>{dateTime(g.attemptedAt)}</span> },
    { key: 'canal', header: 'Canal', render: (g) => <Chip>{CANAL[g.channel] ?? g.channel}</Chip> },
    {
      key: 'resultado', header: 'Resultado',
      render: (g) => {
        const bueno = g.result === 'ANSWERED' || g.result === 'PROMISE_MADE';
        const malo = g.result === 'WRONG_NUMBER' || g.result === 'NO_ANSWER';
        return <Badge tone={bueno ? 'ok' : malo ? 'bad' : 'muted'}>{RESULTADO_CONTACTO[g.result] ?? g.result}</Badge>;
      },
    },
    {
      key: 'tramo', header: 'Tramo',
      render: (g) => (
        <div>
          <Badge tone={bucketTono(g.currentBucket)}>{BUCKET_LABEL[g.currentBucket]}</Badge>
          <div className="bo-sub">{g.daysDelinquent} días</div>
        </div>
      ),
    },
    {
      key: 'paso', header: 'Paso',
      render: (g) => (g.dunningStep != null ? <span className="bo-mono-sm">#{g.dunningStep}</span> : <span className="bo-sub">—</span>),
    },
    { key: 'gestor', header: 'Gestor', render: (g) => g.agentId ?? <span className="bo-sub">automático</span> },
  ];

  return (
    <>
      <Stats>
        <StatCard label="Intentos en la vista" value={count(filas.length)} sub="cruzando todos los casos" />
        <StatCard label="Contacto efectivo" value={count(efectivos)}
                  tone={filas.length && efectivos === 0 ? 'bad' : undefined}
                  sub={filas.length ? `${Math.round((efectivos / filas.length) * 100)}% de los intentos` : 'sin intentos'} />
        <StatCard label="Sin respuesta" value={count(filas.filter((g) => g.result === 'NO_ANSWER').length)}
                  sub="no contestó" />
        <StatCard label="Número equivocado"
                  value={count(filas.filter((g) => g.result === 'WRONG_NUMBER').length)}
                  tone={filas.some((g) => g.result === 'WRONG_NUMBER') ? 'warn' : undefined}
                  sub="hay que corregir el dato de contacto" />
      </Stats>

      <Toolbar>
        <Field label="Resultado">
          <Select value={result} onChange={(v) => setResult(v as ContactResult | '')}
                  placeholder="Cualquier resultado" ariaLabel="Resultado del intento"
                  options={Object.entries(RESULTADO_CONTACTO).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Canal">
          <Select value={channel} onChange={(v) => setChannel(v as ContactChannel | '')}
                  placeholder="Cualquier canal" ariaLabel="Canal"
                  options={Object.entries(CANAL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Tramo">
          <Select value={bucket} onChange={(v) => setBucket(v as DelinquencyBucket | '')}
                  placeholder="Todos los tramos" ariaLabel="Tramo de mora"
                  options={(Object.keys(BUCKET_LABEL) as DelinquencyBucket[])
                    .map((b) => ({ value: b, label: BUCKET_LABEL[b] }))} />
        </Field>
      </Toolbar>

      <CardTitled
        title={`Gestiones${state.data ? ` · ${count(state.data.totalElements)}` : ''}`}
        action={<span className="bo-page-sub">Qué se intentó y con qué resultado</span>}
      >
        <Block state={state} emptyLabel="Todavía no se registran intentos de contacto.">
          {() => (
            <DataTable columns={columns} rows={filas} rowKey={(g) => g.attemptId}
                       emptyMessage="Ningún intento con esos filtros." />
          )}
        </Block>
      </CardTitled>

      <Footnote>
        La gestión se <b>captura desde el caso</b>, no desde aquí: es ahí donde están la ventana de
        contacto y el tope de intentos contra los que se valida. Esta pantalla es de supervisión —
        cuánta cobertura tiene la cartera en mora y con qué resultado.
      </Footnote>
    </>
  );
}
