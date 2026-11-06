import { useState } from 'react';
import { receiptsApi } from '@bo/api-client';
import { Can } from '@bo/auth';
import {
  useAsync, Badge, Button, Collapsible, EmptyState, Field, Select, Spinner, TextInput, money, date,
} from '@bo/design-system';
import {
  CLIENT_TYPE_LABELS, RED_LIST_REASON_LABELS, REPORT_REASON_LABELS,
  type RedListMark, type ReportReason,
} from '@bo/shared-types';

/**
 * A distributor's client as the portfolio sees him: his type (nuevo / revolvente, which decides his limits) and the
 * red list. A mark is a warning — he did not pay, or his distributor is behind, or a distributor reported him — and a
 * rule: with any mark, no distributor can lend to him. The derived marks lift themselves the day he is current; a
 * report is cleared with a comment. Marking and clearing need collections' management.
 */
export function CreditProfileSection({ partyId }: { partyId: string }) {
  const { data, loading, error, reload } = useAsync(() => receiptsApi.creditProfile(partyId), [partyId]);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [comment, setComment] = useState('');
  const [clearing, setClearing] = useState<{ flagId: string; comment: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function mark() {
    if (!reason || !comment.trim()) return;
    setBusy(true); setFailure(null);
    try {
      await receiptsApi.markRedList(partyId, reason, comment.trim());
      setReason(''); setComment('');
      reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo marcar al cliente');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!clearing || !clearing.comment.trim()) return;
    setBusy(true); setFailure(null);
    try {
      await receiptsApi.clearRedList(partyId, clearing.flagId, clearing.comment.trim());
      setClearing(null);
      reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo levantar la marca');
    } finally {
      setBusy(false);
    }
  }

  const subtitle = loading && !data ? 'cargando…'
    : error ? 'no se pudo leer'
      : data ? `${CLIENT_TYPE_LABELS[data.type]}${data.redListed ? ' · en lista roja' : ''}` : '';

  return (
    <Collapsible title="Crédito con distribuidoras" ariaLabel="Crédito con distribuidoras" subtitle={subtitle}>
      {error ? <EmptyState message={`No se pudo leer el perfil: ${error}`} />
        : loading && !data ? <Spinner />
          : data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone={data.type === 'REVOLVENTE' ? 'ok' : 'muted'}>{CLIENT_TYPE_LABELS[data.type]}</Badge>
                <span className="bo-sub">
                  {data.loansGranted} otorgados · {data.loansPaid} pagados · {data.activeLoans} vigentes · debe {money(data.outstanding, true)}
                </span>
              </div>

              {data.redListed ? (
                <div className="bo-alert bo-huerfanos">
                  <b>En lista roja: ninguna distribuidora puede prestarle mientras siga alguna marca.</b>
                  <ul style={{ margin: '6px 0 0 18px' }}>
                    {data.flags.map((f, i) => <li key={f.flagId ?? `${f.reason}-${i}`}><MarkLine f={f} /></li>)}
                  </ul>
                </div>
              ) : <p className="bo-sub">Sin marcas: puede recibir préstamos dentro de los límites de su tipo.</p>}

              <Can capability="collections.manage">
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200 }}>
                    <Field label="Marcar en lista roja">
                      <Select value={reason} onChange={(v) => setReason(v as ReportReason | '')} placeholder="Motivo…"
                        options={(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((r) => ({ value: r, label: REPORT_REASON_LABELS[r] }))} />
                    </Field>
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <Field label="Comentarios">
                      <TextInput value={comment} onChange={setComment} placeholder="Qué pasó, con quién se habló…" />
                    </Field>
                  </div>
                  <Button variant="primary" disabled={busy || !reason || !comment.trim()} onClick={() => void mark()}>Marcar</Button>
                </div>
              </Can>

              {data.history.length > 0 && (
                <div>
                  <div className="bo-field-label" style={{ marginBottom: 6 }}>Historial de reportes</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {data.history.map((h) => (
                      <li key={h.flagId} style={{ fontSize: 12.5 }}>
                        {date(h.raisedAt)} · {h.detail ? REPORT_REASON_LABELS[h.detail as ReportReason] ?? h.detail : RED_LIST_REASON_LABELS[h.reason]}
                        {h.comment && <> · «{h.comment}»</>}
                        {h.active ? (
                          <Can capability="collections.manage">
                            {clearing?.flagId === h.flagId ? (
                              <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
                                <TextInput value={clearing.comment} onChange={(v) => setClearing({ flagId: h.flagId, comment: v })} placeholder="Por qué se levanta" />
                                <Button disabled={busy || !clearing.comment.trim()} onClick={() => void clear()}>Levantar</Button>
                              </span>
                            ) : (
                              <button type="button" style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--bo-primary)', cursor: 'pointer' }}
                                onClick={() => setClearing({ flagId: h.flagId, comment: '' })}>levantar</button>
                            )}
                          </Can>
                        ) : <span className="bo-sub"> · levantada el {date(h.clearedAt)}{h.clearComment ? `: «${h.clearComment}»` : ''}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {failure && <p style={{ color: 'var(--bo-bad)', fontSize: 12.5 }}>{failure}</p>}
            </div>
          )}
    </Collapsible>
  );
}

function MarkLine({ f }: { f: RedListMark }) {
  const what = f.reason === 'DISTRIBUTOR_REPORT' && f.detail
    ? `${RED_LIST_REASON_LABELS[f.reason]}: ${REPORT_REASON_LABELS[f.detail as ReportReason] ?? f.detail}`
    : RED_LIST_REASON_LABELS[f.reason];
  return (
    <span>
      {what}{f.since ? ` · desde ${date(f.since)}` : ''}{f.comment && f.reason === 'DISTRIBUTOR_REPORT' ? ` · «${f.comment}»` : ''}
      {f.source === 'SYSTEM' ? ' · se levanta sola al ponerse al día' : ''}
    </span>
  );
}
