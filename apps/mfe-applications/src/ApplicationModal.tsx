import { useState } from 'react';
import { applicationsApi, type ApplicationDetail, type RuleDetail } from '@bo/api-client';
import { useAsync, Block, Button, Field, Modal, TextArea, date, dateTime } from '@bo/design-system';
import { Can, useCapabilities } from '@bo/auth';
import { Expediente, notaDeRechazados, type Dictamen, type Veredicto } from './Expediente';
import { StatusPill, decisionLabel, label, money } from './App';

/**
 * Qué se puede hacer con una solicitud, según dónde está.
 *
 * El desenlace lo decide el backend; esta función sólo lo lee. Es la traducción
 * literal de la regla de negocio: el motor auto-aprueba o auto-rechaza y ahí no
 * hay nada que decidir; manda a revisión y entonces —y sólo entonces— aparecen
 * los botones. Calcularlo en el cliente sería duplicar la política de crédito
 * en un lugar donde nadie la mantiene.
 */
export function actionsFor(status: string): 'decide' | 'documents-received' | 'none' {
  if (status === 'UNDER_MANUAL_REVIEW' || status === 'COMMITTEE_REVIEW') return 'decide';
  if (status === 'PENDING_DOCUMENTS') return 'documents-received';
  return 'none';
}

export function ApplicationModal({
  applicationId, onClose, onChanged,
}: {
  applicationId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const state = useAsync(() => applicationsApi.detail(applicationId), [applicationId]);
  const { can } = useCapabilities();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  /**
   * El dictamen del analista sobre cada documento.
   *
   * Vive aquí y no en `Expediente` porque es lo que alimenta las dos acciones de abajo: sin
   * Incode conectado, la verificación de identidad la hace una persona mirando los archivos, y lo
   * que marque tiene que acabar en el motivo del rechazo o en la petición de documentos. Si el
   * veredicto se quedara dentro del visor, habría que volver a escribirlo aquí — y transcribir es
   * donde se cuela el documento equivocado.
   */
  const [dictamen, setDictamen] = useState<Dictamen>({});

  const dictaminar = (tipo: string, v: Veredicto | undefined) =>
    setDictamen((d) => ({ ...d, [tipo]: v }));

  const rechazados = Object.values(dictamen).filter((v) => v && !v.ok).length;
  const sinMotivo = Object.values(dictamen).some((v) => v && !v.ok && !v.motivo.trim());
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setFailure(null);
    try { await fn(); onChanged(); }
    catch (e) { setFailure(e instanceof Error ? e.message : 'No se pudo completar'); }
    finally { setBusy(false); }
  };

  const p = state.data?.prospect;
  const nombre = p
    ? [p.firstName, p.lastName1, p.lastName2].filter(Boolean).join(' ')
    : state.data?.application?.prospectName ?? 'Solicitud';

  return (
    <Modal
      title={nombre}
      subtitle={state.data?.application?.folio ?? applicationId}
      onClose={onClose}
      size="wide"
    >
      <Block state={state} emptyLabel="No se encontró la solicitud.">
        {(d: ApplicationDetail) => {
          const app = d.application;
          const mode = actionsFor(app.status);
          return (
            <div style={{ display: 'grid', gap: 20 }}>
              {/* ── Resolución ────────────────────────────────────────── */}
              <section>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <StatusPill status={app.status} />
                  <Tag>{decisionLabel(app.decision)}</Tag>
                  <Tag>{label(app.productType)}</Tag>
                  {app.approvalFlow && <Tag>Flujo {app.approvalFlow}</Tag>}
                </div>
                <Facts rows={[
                  ['Monto solicitado', money(app.requestedAmount)],
                  ['Plazo', app.requestedTerm ? `${app.requestedTerm} meses` : '—'],
                  ['Oferta', money(app.offeredAmount ?? app.offeredLine)],
                  ['Tasa', app.nominalRate != null ? `${(app.nominalRate * 100).toFixed(1)}%` : '—'],
                  ['Decidió', app.decidedBy ?? '—'],
                  ['Alta', dateTime(app.createdAt)],
                ]} />
                {app.rejectionReason && (
                  <p style={rejectStyle}>Motivo del rechazo: {app.rejectionReason}</p>
                )}
              </section>

              {/* ── Evaluación de riesgo ──────────────────────────────── */}
              <section>
                <h4 style={h4Style}>Evaluación</h4>
                {!d.evaluation ? (
                  <Muted>Sin evaluación registrada.</Muted>
                ) : (
                  <>
                    <Facts rows={[
                      ['Score', String(d.evaluation.totalScore ?? '—')],
                      ['Riesgo', d.evaluation.riskLevel ?? '—'],
                      ['Decisión', decisionLabel(d.evaluation.decision)],
                      ['Evaluado', dateTime(d.evaluation.evaluatedAt)],
                    ]} />
                    <RuleTable rules={d.evaluation.ruleDetails ?? []} />
                  </>
                )}
              </section>

              {/* ── Lo que capturó el sujeto ──────────────────────────── */}
              <section>
                <h4 style={h4Style}>Capturado por el solicitante</h4>
                {!d.prospect ? (
                  // El BFF devuelve null cuando el prospecto no tiene captura.
                  // No es un fallo de la consola y no debe leerse como tal.
                  <Muted>Sin datos capturados para este prospecto.</Muted>
                ) : (
                  <>
                    <Facts rows={[
                      ['CURP', d.prospect.curp ?? '—'],
                      ['RFC', d.prospect.rfc ?? '—'],
                      ['Nacimiento', date(d.prospect.dateOfBirth)],
                      ['Teléfono', d.prospect.phone ?? '—'],
                      ['Correo', d.prospect.email ?? '—'],
                      ['Estado de nacimiento', d.prospect.stateOfBirth ?? '—'],
                    ]} />
                    <Facts rows={[
                      ['Aviso de privacidad', consent(d.prospect.privacyNoticeAccepted, d.prospect.privacyNoticeAcceptedAt)],
                      ['Consulta a SIC', consent(d.prospect.circuloConsentAccepted, d.prospect.circuloConsentAcceptedAt)],
                    ]} />
                    <h5 style={h5Style}>Expediente</h5>
                    <Expediente
                      applicationId={applicationId}
                      dictamen={mode === 'decide' ? dictamen : undefined}
                      onDictaminar={mode === 'decide' ? dictaminar : undefined}
                    />
                  </>
                )}
              </section>

              {/* ── Buró: sólo para quien analiza ─────────────────────── */}
              <Can
                capability="applications.analyze"
                fallback={<Muted>El reporte de buró sólo lo ve un rol de análisis.</Muted>}
              >
                <section>
                  <h4 style={h4Style}>Buró de crédito</h4>
                  {!d.bureauReport
                    ? <Muted>Sin reporte disponible.</Muted>
                    : <pre className="bo-payload">{JSON.stringify(d.bureauReport, null, 2)}</pre>}
                </section>
              </Can>

              {/* ── Créditos vigentes ─────────────────────────────────── */}
              <section>
                <h4 style={h4Style}>Créditos vigentes</h4>
                {(d.existingCredits ?? []).length === 0 ? (
                  <Muted>No tiene créditos vigentes.</Muted>
                ) : (
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <tbody>
                      {d.existingCredits!.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--bo-border)' }}>
                          <td style={{ padding: '6px 0' }}><code>{String(c['contractNumber'] ?? '—')}</code></td>
                          <td>{label(String(c['productType'] ?? ''))}</td>
                          <td>{money(Number(c['principalBalance'] ?? 0))}</td>
                          <td>pago {String(c['paidInstallments'] ?? '—')}/{String(c['totalInstallments'] ?? '—')}</td>
                          <td>{Number(c['daysDelinquent'] ?? 0) > 0
                            ? <span style={{ color: 'var(--bo-bad)' }}>{String(c['daysDelinquent'])} d mora</span>
                            : 'al corriente'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* ── Acciones, sólo donde el estado las permite ────────── */}
              {mode === 'decide' && (
                <Can
                  capability="applications.decide"
                  fallback={<Muted>Tu rol puede analizar esta solicitud, pero no decidirla.</Muted>}
                >
                  <section style={actionsBoxStyle}>
                    <h4 style={h4Style}>Decisión</h4>
                    {rechazados > 0 && (
                      <div className="bo-alert bo-huerfanos">
                        <b>{rechazados} {rechazados === 1 ? 'documento no cumple' : 'documentos no cumplen'}.</b>{' '}
                        Lo normal aquí es <b>pedirlos de nuevo</b>, no rechazar la solicitud: un
                        comprobante ilegible no es un crédito negado. Rechazar cierra el expediente.
                      </div>
                    )}
                    <Field
                      label="Motivo"
                      hint="Obligatorio para rechazar: queda en el acta y es lo que lee el cliente."
                    >
                      <TextArea
                        value={reason}
                        onChange={setReason}
                        rows={3}
                        placeholder="Por qué se aprueba o se rechaza"
                      />
                    </Field>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => run(() => applicationsApi.decide(applicationId, true))}
                      >
                        Aprobar
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy || !reason.trim()}
                        title={!reason.trim() ? 'Escribe el motivo para poder rechazar' : undefined}
                        onClick={() => run(() => applicationsApi.decide(applicationId, false, reason.trim()))}
                      >
                        Rechazar
                      </Button>
                      {rechazados > 0 && !reason.trim() && (
                        <Button
                          disabled={busy || sinMotivo}
                          title="Compone el motivo con los documentos que marcaste"
                          onClick={() => setReason(notaDeRechazados(dictamen))}
                        >
                          Usar el dictamen como motivo
                        </Button>
                      )}
                    </div>

                    <Can capability="applications.request-documents">
                      <div style={{ marginTop: 16 }}>
                        <Field
                          label="Documentación pendiente"
                          hint={rechazados > 0
                            ? `Hay ${rechazados} ${rechazados === 1 ? 'documento rechazado' : 'documentos rechazados'} en el expediente: se pueden pasar aquí con un clic.`
                            : 'Qué documento hace falta y por qué. Es el texto que recibe el cliente.'}
                        >
                          <TextArea
                            value={note}
                            onChange={setNote}
                            rows={rechazados > 0 ? 3 : 2}
                            placeholder="Qué documento hace falta y por qué"
                          />
                        </Field>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          {/* Compone la petición con lo dictaminado arriba en vez de pedir que se
                              vuelva a escribir. Se rellena, no se manda: quien pide los documentos
                              es quien lee el texto antes de que salga. */}
                          {rechazados > 0 && (
                            <Button
                              disabled={busy || sinMotivo}
                              title={sinMotivo
                                ? 'Falta el motivo de algún documento rechazado'
                                : 'Pasa los documentos rechazados al texto de la petición'}
                              onClick={() => setNote(notaDeRechazados(dictamen))}
                            >
                              Usar los {rechazados} rechazados
                            </Button>
                          )}
                          <Button
                            disabled={busy || !note.trim()}
                            onClick={() => run(() => applicationsApi.requestDocuments(applicationId, note.trim()))}
                          >
                            Pedir documentos
                          </Button>
                        </div>
                      </div>
                    </Can>
                  </section>
                </Can>
              )}

              {mode === 'documents-received' && (
                <Can capability="applications.request-documents">
                  <section style={actionsBoxStyle}>
                    <h4 style={h4Style}>Documentos solicitados</h4>
                    <Muted>Esta solicitud espera documentación del cliente.</Muted>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => run(() => applicationsApi.documentsReceived(applicationId))}
                    >
                      Documentos recibidos
                    </Button>
                  </section>
                </Can>
              )}

              {mode === 'none' && (
                <Muted>
                  {app.decision === 'AUTO_APPROVED'
                    ? 'Aprobada automáticamente por el motor: no requiere revisión.'
                    : app.decision === 'REJECTED'
                      ? 'Rechazada automáticamente por el motor.'
                      : 'Expediente en seguimiento; no hay decisión pendiente.'}
                </Muted>
              )}

              {failure && <p style={rejectStyle}>{failure}</p>}
            </div>
          );
        }}
      </Block>
    </Modal>
  );
}

function RuleTable({ rules }: { rules: RuleDetail[] }) {
  if (rules.length === 0) return <Muted>Sin detalle de reglas.</Muted>;
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
      <thead>
        <tr>
          {['Regla', 'Aplicó', 'Puntos', ''].map((h) => (
            <th key={h} style={{ textAlign: 'left', padding: '4px 0', color: 'var(--bo-text-muted)', fontWeight: 500 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rules.map((r, i) => (
          <tr key={r.ruleId ?? i} style={{ borderBottom: '1px solid var(--bo-border)' }}>
            <td style={{ padding: '5px 0' }}>
              {r.ruleType}
              {r.detail && <div style={{ color: 'var(--bo-text-muted)' }}>{r.detail}</div>}
            </td>
            <td>{r.matched ? 'sí' : 'no'}</td>
            <td>{r.scoreApplied ?? '—'}</td>
            {/* Una regla descalificante no se lee igual que una que resta puntos:
                por sí sola tumba la solicitud. */}
            <td>{r.disqualifying && <span style={{ color: 'var(--bo-bad)' }}>descalifica</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function consent(accepted: boolean | null | undefined, at: string | null | undefined): string {
  if (!accepted) return 'No aceptado';
  return at ? `Aceptado · ${new Date(at).toLocaleString('es-MX')}` : 'Aceptado';
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', margin: '10px 0 0' }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt style={{ fontSize: 11, color: 'var(--bo-text-muted)' }}>{k}</dt>
          <dd style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// Los colores salen del tema, no de un hex escrito aquí: `var(--bo-muted, #94a3b8)` era un token
// que no existe, así que este modal se pintaba siempre con el gris de reserva y no seguía al tema.
const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="bo-page-sub" style={{ margin: '6px 0' }}>{children}</p>
);

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="bo-cap-chip">{children}</span>
);

const h4Style = { margin: '0 0 6px', fontSize: 13, fontWeight: 600 } as const;
const h5Style = { margin: '12px 0 4px', fontSize: 12, color: 'var(--bo-text-muted)' } as const;
const rejectStyle = { marginTop: 10, fontSize: 13, color: 'var(--bo-bad)' } as const;
const actionsBoxStyle = { padding: 14, borderRadius: 'var(--bo-radius)', border: '1px solid var(--bo-border)' } as const;
