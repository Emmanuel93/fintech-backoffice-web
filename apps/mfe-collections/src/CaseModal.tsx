import { useState } from 'react';
import {
  collectionsApi, CONTACT_CHANNELS,
  type CaseDetail, type CollectionsConfig, type ContactChannel, type ContactResult,
} from '@bo/api-client';
import {
  useAsync, Modal, Badge, Button, Field, Select, TextInput, Spinner, EmptyState,
  Tabs, Defs, DefRow, DataTable, money, rate, dateTime, date,
} from '@bo/design-system';
import {
  BUCKET_LABEL, CANAL_CONTACTO, ESCALON_TONO, ESTADO_CASO, ESTADO_CONVENIO, ESTADO_PROMESA,
  MOTIVO_FRENO, MOTIVO_QUEBRANTO, RESULTADOS_MANUALES, RESULTADO_CONTACTO, TIPO_CONVENIO,
  bloqueoContacto, bucketTono, convenioTono, diasParaExpirar, esTerminal, estrategiaLabel,
  frenoVigente, maximoCondonable, promesaTono,
} from './lenguaje';

type Pestana = 'resumen' | 'gestion' | 'convenios' | 'quebranto';

/**
 * El expediente de un caso: lo que se sabe, lo que ya se hizo y lo que se puede hacer.
 *
 * <p>Cada acción recarga el caso completo en vez de parchear el estado local. Es una llamada de
 * más, y a cambio la pantalla nunca miente: registrar un contacto mueve el contador de intentos del
 * día, aceptar un convenio cambia qué botones existen, y un caso puede haber cambiado por un job
 * nocturno mientras estaba abierto. Reconstruir eso en el cliente es reimplementar las reglas del
 * dominio en el lugar donde nadie las mantiene.
 */
export function CaseModal({ caseId, config, onClose }: {
  caseId: string;
  config: CollectionsConfig | null;
  onClose: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [version, setVersion] = useState(0);
  const state = useAsync(() => collectionsApi.caseById(caseId), [caseId, version]);
  const recargar = () => setVersion((v) => v + 1);

  const detail = state.data;

  return (
    <Modal
      title={detail?.obligorName ?? 'Caso de cobranza'}
      subtitle={detail ? `${ESTADO_CASO[detail.status]} · ${BUCKET_LABEL[detail.currentBucket]} · ${detail.daysDelinquent} días` : undefined}
      onClose={onClose}
      size="wide"
    >
      {state.loading && <Spinner />}
      {state.error && <EmptyState message={`No se pudo cargar el caso: ${state.error}`} />}

      {detail && (
        <>
          {esTerminal(detail.status) && (
            <div className="bo-acta" style={{ marginBottom: 12 }}>
              Caso {ESTADO_CASO[detail.status].toLowerCase()}: el expediente queda en sólo lectura.
            </div>
          )}

          <Tabs
            value={pestana}
            onChange={setPestana}
            tabs={[
              { value: 'resumen', label: 'Resumen' },
              { value: 'gestion', label: 'Gestión', count: (detail.contactAttempts?.length ?? 0) + (detail.paymentPromises?.length ?? 0) },
              { value: 'convenios', label: 'Convenios', count: detail.agreements?.length ?? 0 },
              { value: 'quebranto', label: 'Quebranto' },
            ]}
          />

          <div style={{ marginTop: 14 }}>
            {pestana === 'resumen' && <Resumen detail={detail} />}
            {pestana === 'gestion' && <Gestion detail={detail} config={config} onCambio={recargar} />}
            {pestana === 'convenios' && <Convenios detail={detail} config={config} onCambio={recargar} />}
            {pestana === 'quebranto' && <Quebranto detail={detail} config={config} onCambio={recargar} />}
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Resumen ────────────────────────────────────────────────────────────────

function Resumen({ detail }: { detail: CaseDetail }) {
  const a = detail.account;
  return (
    <>
      <section>
        <div className="bo-grupo-cap">El crédito</div>
        <Defs className="cols-3">
          <DefRow k="Contrato" v={a?.contractNumber ?? '—'} />
          <DefRow k="Producto" v={a?.productType ?? detail.productType ?? '—'} />
          <DefRow k="Estatus en cartera" v={a?.status ?? '—'} />
          {/* El saldo bueno es el de cartera. El del caso es una proyección por eventos y va un
              instante por detrás; mostrar los dos sólo produce la pregunta de cuál vale. */}
          <DefRow k="Saldo total" v={money(a?.totalDebt)} />
          <DefRow k="Capital" v={money(a?.principalBalance)} />
          <DefRow k="Tasa" v={a?.nominalRate != null ? rate(a.nominalRate) : '—'} />
        </Defs>
      </section>

      <section style={{ marginTop: 16 }}>
        <div className="bo-grupo-cap">La mora</div>
        <Defs className="cols-3">
          <DefRow k="Tramo" v={<Badge tone={bucketTono(detail.currentBucket)}>{BUCKET_LABEL[detail.currentBucket]}</Badge>} />
          <DefRow k="Días de atraso" v={String(detail.daysDelinquent)} />
          <DefRow k="Qué toca" v={estrategiaLabel(detail.strategy)} />
          <DefRow k="Gestor asignado" v={detail.assignedAgentId ?? 'Sin asignar'} />
          <DefRow k="Despacho externo" v={detail.externalAgencyId ?? 'Ninguno'} />
          <DefRow k="Caso abierto" v={detail.openedAt ? dateTime(detail.openedAt) : '—'} />
        </Defs>
      </section>
    </>
  );
}

// ── Gestión: contactos y promesas ──────────────────────────────────────────

function Gestion({ detail, config, onCambio }: {
  detail: CaseDetail; config: CollectionsConfig | null; onCambio: () => void;
}) {
  const bloqueo = bloqueoContacto(detail, config);
  const hoy = detail.contactAttemptsToday ?? 0;
  const tope = detail.maxContactAttemptsPerDay ?? config?.maxContactAttemptsPerDay ?? 3;
  const promesaVigente = (detail.paymentPromises ?? []).find((p) => p.status === 'ACTIVE');
  const freno = frenoVigente(detail);

  return (
    <>
      {/* El freno se anuncia arriba y no escondido en una pestaña: un gestor que no lo ve concluye
          que el sistema dejó de trabajar el caso y empieza a llamar encima de una promesa que él
          mismo concedió. Y se aclara que a él no lo frena, porque no lo frena. */}
      {freno && (
        <div className="bo-acta" style={{ marginBottom: 14 }}>
          <b>Cobranza automática en pausa — {MOTIVO_FRENO[freno.reason]}.</b>{' '}
          Hasta {dateTime(freno.heldUntil)}. Sólo se detienen los mensajes automáticos; puedes
          llamar y registrar el contacto igual.
        </div>
      )}

      <section>
        <div className="bo-grupo-cap">Registrar un contacto</div>
        <div className="bo-sub" style={{ marginBottom: 8 }}>
          {hoy} de {tope} intentos de agente hoy. Los mensajes automáticos no consumen este cupo.
        </div>
        {bloqueo
          ? <EmptyState message={bloqueo} />
          : <FormContacto caseId={detail.caseId} onHecho={onCambio} />}
      </section>

      <section style={{ marginTop: 18 }}>
        <div className="bo-grupo-cap">Contactos registrados</div>
        <DataTable
          columns={[
            { key: 'cuando', header: 'Cuándo', render: (c) => dateTime(c.attemptedAt) },
            { key: 'canal', header: 'Canal', render: (c) => CANAL_CONTACTO[c.channel] ?? c.channel },
            {
              key: 'quien', header: 'Origen',
              render: (c) => c.origin === 'AUTOMATIC'
                ? (
                  <div>
                    <Badge tone="muted">Automático</Badge>
                    {c.dunningStep != null && (
                      <div className="bo-sub">{ESCALON_TONO[c.dunningStep] ?? `Paso ${c.dunningStep}`}</div>
                    )}
                  </div>
                )
                : (
                  <div>
                    <Badge tone="info">Agente</Badge>
                    <div className="bo-sub">{c.agentId ?? '—'}</div>
                  </div>
                ),
            },
            { key: 'resultado', header: 'Resultado', render: (c) => RESULTADO_CONTACTO[c.result] ?? c.result },
          ]}
          rows={detail.contactAttempts ?? []}
          rowKey={(c) => c.attemptId}
          emptyMessage="Todavía no se ha registrado ningún contacto."
        />
      </section>

      <section style={{ marginTop: 18 }}>
        <div className="bo-grupo-cap">Promesa de pago</div>
        {promesaVigente ? (
          <Defs className="cols-3">
            <DefRow k="Importe" v={money(promesaVigente.amount)} />
            <DefRow k="Prometido para" v={date(promesaVigente.promisedDate)} />
            <DefRow k="Estado" v={<Badge tone={promesaTono(promesaVigente.status)}>{ESTADO_PROMESA[promesaVigente.status]}</Badge>} />
          </Defs>
        ) : esTerminal(detail.status) ? (
          <EmptyState message="El caso ya no admite promesas." />
        ) : (
          <FormPromesa caseId={detail.caseId} onHecho={onCambio} />
        )}

        {(detail.paymentPromises ?? []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <DataTable
              columns={[
                { key: 'importe', header: 'Importe', align: 'right', render: (p) => money(p.amount) },
                { key: 'fecha', header: 'Prometido para', render: (p) => date(p.promisedDate) },
                { key: 'estado', header: 'Estado', render: (p) => <Badge tone={promesaTono(p.status)}>{ESTADO_PROMESA[p.status]}</Badge> },
                { key: 'quien', header: 'Registró', render: (p) => p.recordedBy ?? '—' },
              ]}
              rows={detail.paymentPromises ?? []}
              rowKey={(p) => p.promiseId}
              emptyMessage="Sin promesas."
            />
          </div>
        )}
        <div className="bo-sub" style={{ marginTop: 8 }}>
          Una promesa se marca cumplida sola cuando entra un pago que cubre el importe. Un pago
          parcial no la mueve.
        </div>
      </section>
    </>
  );
}

function FormContacto({ caseId, onHecho }: { caseId: string; onHecho: () => void }) {
  const [canal, setCanal] = useState<ContactChannel>('PHONE');
  const [resultado, setResultado] = useState<ContactResult>('ANSWERED');
  const { enviar, enviando, error } = useAccion(onHecho);

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Field label="Canal">
        <Select
          value={canal}
          onChange={(v) => setCanal(v as ContactChannel)}
          options={CONTACT_CHANNELS.map((c) => ({ value: c, label: CANAL_CONTACTO[c] }))}
        />
      </Field>
      <Field label="Resultado">
        <Select
          value={resultado}
          onChange={(v) => setResultado(v as ContactResult)}
          options={RESULTADOS_MANUALES.map((r) => ({ value: r, label: RESULTADO_CONTACTO[r] }))}
        />
      </Field>
      <Button
        variant="primary"
        disabled={enviando}
        onClick={() => enviar(() => collectionsApi.recordContact(caseId, { channel: canal, result: resultado }))}
      >
        {enviando ? 'Registrando…' : 'Registrar contacto'}
      </Button>
      {error && <span className="bo-sub" style={{ color: 'var(--bo-bad)' }}>{error}</span>}
    </div>
  );
}

function FormPromesa({ caseId, onHecho }: { caseId: string; onHecho: () => void }) {
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState('');
  const { enviar, enviando, error } = useAccion(onHecho);

  const monto = Number(importe);
  // El backend no valida que la fecha sea futura: una promesa para ayer nace rota, porque el job de
  // las 08:00 la marca así al día siguiente. Se impide aquí, que es donde todavía se puede corregir.
  const hoy = new Date().toISOString().slice(0, 10);
  const invalido = !Number.isFinite(monto) || monto < 0.01 || !fecha || fecha < hoy;

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Field label="Importe prometido">
        <TextInput value={importe} onChange={setImporte} placeholder="3500.00" />
      </Field>
      <Field label="Fecha prometida">
        <TextInput type="date" value={fecha} onChange={setFecha} />
      </Field>
      <Button
        variant="primary"
        disabled={invalido || enviando}
        onClick={() => enviar(() => collectionsApi.createPromise(caseId, { amount: monto, promisedDate: fecha }))}
      >
        {enviando ? 'Registrando…' : 'Registrar promesa'}
      </Button>
      {fecha && fecha < hoy && (
        <span className="bo-sub" style={{ color: 'var(--bo-bad)' }}>La fecha no puede estar en el pasado.</span>
      )}
      {error && <span className="bo-sub" style={{ color: 'var(--bo-bad)' }}>{error}</span>}
    </div>
  );
}

// ── Convenios ──────────────────────────────────────────────────────────────

function Convenios({ detail, config, onCambio }: {
  detail: CaseDetail; config: CollectionsConfig | null; onCambio: () => void;
}) {
  const agreements = detail.agreements ?? [];
  const activo = agreements.find((a) => a.status === 'PROPOSED' || a.status === 'ACCEPTED');
  const puedeProponer = (detail.status === 'MANAGED' || detail.status === 'LEGAL') && !activo;

  return (
    <>
      {!puedeProponer && !activo && (
        <EmptyState message={
          detail.status === 'OPEN'
            ? 'Un caso recién abierto todavía no admite convenios: pasa a gestión al escalar de tramo.'
            : `El caso está ${ESTADO_CASO[detail.status].toLowerCase()} y no admite convenios nuevos.`
        } />
      )}

      {puedeProponer && <FormConvenio detail={detail} config={config} onHecho={onCambio} />}

      {activo && <ConvenioActivo detail={detail} config={config} onCambio={onCambio} />}

      <section style={{ marginTop: 18 }}>
        <div className="bo-grupo-cap">Historial de convenios</div>
        <DataTable
          columns={[
            { key: 'tipo', header: 'Tipo', render: (a) => TIPO_CONVENIO[a.type] },
            {
              key: 'estado', header: 'Estado',
              render: (a) => <Badge tone={convenioTono(a.status)}>{ESTADO_CONVENIO[a.status]}</Badge>,
            },
            {
              key: 'importe', header: 'Condonado / plazo', align: 'right',
              render: (a) => a.type === 'QUITA_PARCIAL'
                ? money(a.forgivenAmount)
                : `${a.newTerms?.newTermMonths ?? '—'} meses`,
            },
            { key: 'propuesto', header: 'Propuesto', render: (a) => dateTime(a.proposedAt) },
            { key: 'ejecutado', header: 'Ejecutado', render: (a) => a.executedAt ? dateTime(a.executedAt) : '—' },
          ]}
          rows={agreements}
          rowKey={(a) => a.agreementId}
          emptyMessage="Este caso no tiene convenios."
        />
      </section>
    </>
  );
}

function ConvenioActivo({ detail, config, onCambio }: {
  detail: CaseDetail; config: CollectionsConfig | null; onCambio: () => void;
}) {
  const a = (detail.agreements ?? []).find((x) => x.status === 'PROPOSED' || x.status === 'ACCEPTED')!;
  const { enviar, enviando, error } = useAccion(onCambio);
  const [autorizadoPor, setAutorizadoPor] = useState('');
  const [referencia, setReferencia] = useState('');
  const dias = diasParaExpirar(a.proposedAt, config);

  return (
    <section>
      <div className="bo-grupo-cap">Convenio en curso</div>
      <Defs className="cols-3">
        <DefRow k="Tipo" v={TIPO_CONVENIO[a.type]} />
        <DefRow k="Estado" v={<Badge tone={convenioTono(a.status)}>{ESTADO_CONVENIO[a.status]}</Badge>} />
        <DefRow k="Deuda original" v={money(a.originalDebt)} />
        {a.type === 'QUITA_PARCIAL'
          ? <DefRow k="Condonado" v={money(a.forgivenAmount)} />
          : <DefRow k="Nuevo plazo" v={`${a.newTerms?.newTermMonths ?? '—'} meses`} />}
        <DefRow k="Propuesto" v={dateTime(a.proposedAt)} />
        {a.status === 'PROPOSED' && dias != null && (
          <DefRow k="Expira en" v={dias === 0 ? 'Hoy' : `${dias} días`} />
        )}
      </Defs>

      {a.status === 'PROPOSED' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button disabled={enviando} onClick={() => enviar(() => collectionsApi.acceptAgreement(a.agreementId))}>
            El deudor acepta
          </Button>
          <Button disabled={enviando}
                  onClick={() => enviar(() => collectionsApi.rejectAgreement(a.agreementId))}>
            El deudor rechaza
          </Button>
        </div>
      )}

      {a.status === 'ACCEPTED' && (
        <div style={{ marginTop: 12 }}>
          {/* Quien propone y quien autoriza tienen que ser distintos, y el dominio no lo comprueba:
              no compara authorizedBy contra quien propuso. Se pide explícito para que quede el
              rastro de quién firmó, aunque el control real siga pendiente en el servidor. */}
          <div className="bo-sub" style={{ marginBottom: 8 }}>
            Autorizar ejecuta el convenio en un solo paso. El saldo lo aplica cartera al recibir el
            evento, así que no cambia al instante.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Autoriza">
              <TextInput value={autorizadoPor} onChange={setAutorizadoPor} placeholder="ana.ruiz" />
            </Field>
            <Field label="Referencia del acta">
              <TextInput value={referencia} onChange={setReferencia} placeholder="COM-2026-0814" />
            </Field>
            <Button
              disabled={!autorizadoPor.trim() || !referencia.trim() || enviando}
              onClick={() => enviar(() => collectionsApi.authorizeAgreement(a.agreementId, {
                authorizedBy: autorizadoPor.trim(), authorizationRef: referencia.trim(),
              }))}
            >
              {enviando ? 'Autorizando…' : 'Autorizar y ejecutar'}
            </Button>
          </div>
        </div>
      )}

      {error && <div className="bo-sub" style={{ color: 'var(--bo-bad)', marginTop: 8 }}>{error}</div>}
    </section>
  );
}

function FormConvenio({ detail, config, onHecho }: {
  detail: CaseDetail; config: CollectionsConfig | null; onHecho: () => void;
}) {
  const [tipo, setTipo] = useState<'QUITA_PARCIAL' | 'RESTRUCTURE'>('QUITA_PARCIAL');
  const [condonado, setCondonado] = useState('');
  const [meses, setMeses] = useState('');
  const [tasa, setTasa] = useState('');
  const { enviar, enviando, error } = useAccion(onHecho);

  const maximo = maximoCondonable(detail, config);
  const montoCondonado = Number(condonado);
  const nMeses = Number(meses);
  const topeMeses = config?.maxTermExtensionMonths ?? 12;

  const invalido = tipo === 'QUITA_PARCIAL'
    ? !Number.isFinite(montoCondonado) || montoCondonado <= 0 || (maximo > 0 && montoCondonado > maximo)
    : !Number.isFinite(nMeses) || nMeses <= 0 || nMeses > topeMeses;

  return (
    <section>
      <div className="bo-grupo-cap">Proponer un convenio</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Tipo">
          <Select
            value={tipo}
            onChange={(v) => setTipo(v as 'QUITA_PARCIAL' | 'RESTRUCTURE')}
            options={[
              { value: 'QUITA_PARCIAL', label: 'Quita parcial' },
              { value: 'RESTRUCTURE', label: 'Reestructura' },
            ]}
          />
        </Field>

        {tipo === 'QUITA_PARCIAL' ? (
          <Field label="Importe a condonar">
            <TextInput value={condonado} onChange={setCondonado} placeholder="4200.00" />
          </Field>
        ) : (
          <>
            <Field label={`Nuevo plazo (máx. ${topeMeses} meses)`}>
              <TextInput value={meses} onChange={setMeses} placeholder="12" />
            </Field>
            <Field label="Nueva tasa (opcional)">
              <TextInput value={tasa} onChange={setTasa} placeholder="0.28" />
            </Field>
          </>
        )}

        <Button
          disabled={invalido || enviando}
          onClick={() => enviar(() => collectionsApi.proposeAgreement(detail.caseId,
            tipo === 'QUITA_PARCIAL'
              ? { type: 'QUITA_PARCIAL', forgivenAmount: montoCondonado }
              : {
                  type: 'RESTRUCTURE',
                  newTerms: {
                    newNominalRate: tasa.trim() ? Number(tasa) : null,
                    newTermMonths: nMeses,
                    newAmortizationType: 'FRENCH',
                  },
                },
          ))}
        >
          {enviando ? 'Proponiendo…' : 'Proponer convenio'}
        </Button>
      </div>

      {/* El máximo se dice en pesos y no en porcentaje: nadie decide una quita calculando el 30% de
          la deuda de cabeza, y el backend rechaza por el importe, no por la proporción. */}
      {tipo === 'QUITA_PARCIAL' && maximo > 0 && (
        <div className="bo-sub" style={{ marginTop: 8 }}>
          Máximo condonable para esta deuda: {money(maximo)}.
          {montoCondonado > maximo && ' El importe capturado lo excede.'}
        </div>
      )}
      {error && <div className="bo-sub" style={{ color: 'var(--bo-bad)', marginTop: 8 }}>{error}</div>}
    </section>
  );
}

// ── Quebranto ──────────────────────────────────────────────────────────────

function Quebranto({ detail, config, onCambio }: {
  detail: CaseDetail; config: CollectionsConfig | null; onCambio: () => void;
}) {
  const [motivo, setMotivo] = useState<'UNRECOVERABLE' | 'REGULATORY' | 'LEGAL_SETTLEMENT'>('UNRECOVERABLE');
  const [autorizadoPor, setAutorizadoPor] = useState('');
  const [referencia, setReferencia] = useState('');
  const [solicitado, setSolicitado] = useState(false);
  const { enviar, enviando, error } = useAccion(onCambio);

  const umbral = config?.writeOffThresholdDays ?? 181;
  const alcanzaUmbral = detail.daysDelinquent >= umbral;
  const wo = detail.writeOff;

  if (wo) {
    return (
      <section>
        <div className="bo-grupo-cap">Quebranto ejecutado</div>
        <Defs className="cols-3">
          <DefRow k="Motivo" v={MOTIVO_QUEBRANTO[wo.reason]} />
          <DefRow k="Autorizó" v={wo.authorizedBy ?? '—'} />
          <DefRow k="Acta" v={wo.authorizationRef ?? '—'} />
          <DefRow k="Capital" v={money(wo.principalWrittenOff)} />
          <DefRow k="Intereses" v={money(wo.interestWrittenOff)} />
          <DefRow k="Moratorios" v={money(wo.penaltyWrittenOff)} />
          <DefRow k="Total quebrantado" v={money(wo.totalWrittenOff)} />
          <DefRow k="Fecha" v={date(wo.writeOffDate)} />
          <DefRow k="Reportado a buró" v={wo.bureauReported ? 'Sí' : 'Todavía no'} />
        </Defs>
        <div className="bo-sub" style={{ marginTop: 8 }}>
          El desglose se congela al aprobar: es la cifra del acta, no el saldo de hoy.
        </div>
      </section>
    );
  }

  if (!alcanzaUmbral) {
    return <EmptyState message={`El quebranto se habilita a partir de ${umbral} días de mora. Este caso lleva ${detail.daysDelinquent}.`} />;
  }

  if (esTerminal(detail.status)) {
    return <EmptyState message="El caso ya está cerrado." />;
  }

  return (
    <>
      <section>
        <div className="bo-grupo-cap">Solicitar quebranto</div>
        <div className="bo-sub" style={{ marginBottom: 8 }}>
          La solicitud sólo avisa al comité: no queda registrada en ninguna pantalla ni se puede
          consultar después. Viaja como evento.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Motivo">
            <Select
              value={motivo}
              onChange={(v) => setMotivo(v as typeof motivo)}
              options={(Object.keys(MOTIVO_QUEBRANTO) as Array<keyof typeof MOTIVO_QUEBRANTO>)
                .map((m) => ({ value: m, label: MOTIVO_QUEBRANTO[m] }))}
            />
          </Field>
          <Button
            disabled={enviando || solicitado}
            onClick={() => enviar(async () => {
              await collectionsApi.requestWriteOff(detail.caseId, { reason: motivo });
              setSolicitado(true);
            })}
          >
            {solicitado ? 'Solicitud enviada' : 'Solicitar'}
          </Button>
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div className="bo-grupo-cap">Aprobar y ejecutar</div>
        <div className="bo-sub" style={{ marginBottom: 8 }}>
          Cierra el caso, congela el desglose en un acta inmutable y genera el reporte a buró. Los
          saldos no llegan a cero al instante: los aplica cartera al recibir el evento.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Autoriza">
            <TextInput value={autorizadoPor} onChange={setAutorizadoPor} placeholder="ana.ruiz" />
          </Field>
          <Field label="Referencia del acta">
            <TextInput value={referencia} onChange={setReferencia} placeholder="ACTA-2026-19" />
          </Field>
          <Button
            disabled={!autorizadoPor.trim() || !referencia.trim() || enviando}
            onClick={() => enviar(() => collectionsApi.approveWriteOff(detail.caseId, {
              reason: motivo, authorizedBy: autorizadoPor.trim(), authorizationRef: referencia.trim(),
            }))}
          >
            {enviando ? 'Ejecutando…' : 'Aprobar quebranto'}
          </Button>
        </div>
        {error && <div className="bo-sub" style={{ color: 'var(--bo-bad)', marginTop: 8 }}>{error}</div>}
      </section>
    </>
  );
}

// ── Envío de acciones ──────────────────────────────────────────────────────

/**
 * Ejecuta una acción y recarga el caso.
 *
 * <p>El mensaje de error sale tal cual del BFF. El dominio contesta un solo código —
 * `COLLECTIONS_INVALID_CASE_STATE`— para seis situaciones distintas (horario, tope de intentos,
 * promesa duplicada, convenio duplicado, caso terminal, umbral de quebranto), y lo único que
 * distingue una de otra es el `detail`, que trae el motivo y el número. Traducirlo a una frase
 * propia perdería precisamente eso.
 */
function useAccion(onHecho: () => void) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (accion: () => Promise<unknown>) => {
    setEnviando(true);
    setError(null);
    try {
      await accion();
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    } finally {
      setEnviando(false);
    }
  };

  return { enviar, enviando, error };
}
