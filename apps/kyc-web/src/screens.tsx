import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONSENT_TEXT_VERSION, KycError, type Invite, type PersonalData } from './api';
import { Cta, DevHint, ErrorLine, ICON, Icon, OtpInput, money } from './ui';
import {
  clabeError, curpError, dateOfBirthError, parseIncome, postalCodeError, rfcError,
} from './validate';

/** El texto que se le enseña a ella por cada error conocido. El `message` del servidor es la reserva. */
export function mensaje(e: unknown): string {
  if (e instanceof KycError) {
    if (e.code === 'CODIGO_INCORRECTO') {
      const left = e.body.attemptsLeft;
      return typeof left === 'number'
        ? `Ese código no es. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.`
        : 'Ese código no es. Revísalo y vuelve a escribirlo.';
    }
    if (e.status === 429) return 'Por seguridad pausamos los intentos. Espera unos minutos y vuelve a probar.';
    return e.message;
  }
  return 'Algo salió mal. Intenta de nuevo.';
}

// ── 0 · Bienvenida ──────────────────────────────────────────────────────────────────────────

export function Bienvenida({ invite, onStart }: { invite: Invite; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lender = invite.lenderName;

  const start = async () => {
    setBusy(true); setError(null);
    try { await onStart(); } catch (e) { setError(mensaje(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="k-hero">
        <div className="k-pill">PRÉSTAMO PREAPROBADO PARA TI</div>
        <h1>{lender} te envió un préstamo de {money(invite.amount)}</h1>
        <p>
          {invite.beneficiaryFirstName ? `Hola, ${invite.beneficiaryFirstName}. ` : ''}
          Para recibirlo necesitamos comprobar que eres tú. Son cinco minutos desde este celular y
          el dinero se deposita directo a tu cuenta, a tu nombre.
        </p>
        <div className="k-facts">
          <div><div className="v">{money(invite.amount)}</div><div className="k">Monto que recibes</div></div>
          <div><div className="v">{money(invite.fortnightlyPayment)}</div><div className="k">Pago quincenal</div></div>
          <div><div className="v">{invite.termFortnights}</div><div className="k">Quincenas</div></div>
        </div>
      </div>

      <div className="k-card soft">
        <h2>Ten a mano</h2>
        <div className="k-needs">
          <Need icon={ICON.ine} title="Tu INE vigente" desc="La credencial física, no una copia ni una foto de otra foto." />
          <Need icon={ICON.phone} title="Este celular" desc="Te mandamos un código para confirmar que el número es tuyo." />
          <Need icon={ICON.clock} title="Cinco minutos" desc="Si te interrumpen, la liga sigue viva 7 días y retomas donde quedaste." />
        </div>

        <div className="k-note amber">
          <span>
            Este crédito queda <b>a tu nombre</b>: tú lo pagas y le pagas a {lender}. Si algo de esto
            no lo pediste, cierra esta página y repórtanos.
          </span>
        </div>

        <ErrorLine>{error}</ErrorLine>
        <Cta onClick={start} busy={busy}>Empezar</Cta>
      </div>
    </>
  );
}

function Need({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="k-need">
      <div className="k-need-ico"><Icon d={icon} /></div>
      <div><b>{title}</b><span>{desc}</span></div>
    </div>
  );
}

// ── 1 · Celular ─────────────────────────────────────────────────────────────────────────────

export function Celular({ phoneMask, resendAt, note, onResend, onVerify }: {
  phoneMask: string;
  /** Cuándo se puede pedir otro código (epoch ms). `null` = ya se puede. */
  resendAt: number | null;
  /** Lo que hay que decirle al entrar —sesión vencida, demasiados envíos—. */
  note: string | null;
  onResend: () => Promise<void>;
  onVerify: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noEsMio, setNoEsMio] = useState(false);
  const faltan = useCountdown(resendAt);

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true); setError(null);
    try { await onVerify(code); } catch (e) { setError(mensaje(e)); setCode(''); } finally { setBusy(false); }
  };

  const resend = async () => {
    setError(null);
    try { await onResend(); } catch (e) { setError(mensaje(e)); }
  };

  return (
    <div className="k-card">
      <div className="k-kicker">PASO 1 DE 5</div>
      <h1>Confirma que este celular es tuyo</h1>
      <p className="k-lead">
        Le mandamos un código de 6 dígitos al <b>{phoneMask}</b>, el número que tu distribuidora
        registró. Si no es tu número, no continúes.
      </p>
      {note && <div className="k-note amber"><span>{note}</span></div>}

      <OtpInput value={code} onChange={setCode} autoFocus disabled={busy} />

      <div className="k-otp-row">
        <span>{faltan > 0 ? `Reenviar en ${mmss(faltan)}` : '¿No te llegó?'}</span>
        <button type="button" className="k-link" disabled={faltan > 0} onClick={resend}>Reenviar código</button>
        <button type="button" className="k-link" onClick={() => setNoEsMio(true)}>No es mi número</button>
      </div>
      <DevHint />

      {noEsMio && (
        <div className="k-note amber">
          <span>
            Entonces no sigas: el crédito tiene que quedar con el celular de quien lo recibe.
            Pídele a tu distribuidora que corrija tu número y te mande una liga nueva.
          </span>
        </div>
      )}

      <div className="k-note shield">
        <Icon d={ICON.shield} size={17} />
        <span>Nadie de Kredius ni tu distribuidora te va a pedir este código. Si alguien te lo pide, es un fraude.</span>
      </div>

      <ErrorLine>{error}</ErrorLine>
      <Cta onClick={verify} disabled={code.length !== 6} busy={busy}>Verificar mi celular</Cta>
    </div>
  );
}

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Una foto elegida, con su vista previa. La URL `blob:` se revoca al cambiarla o al salir. */
function usePhoto() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const pick = (f: File | null) => {
    setFile(f);
    setUrl(f ? URL.createObjectURL(f) : null);
  };
  return { file, url, pick };
}

// ── 2 · INE ─────────────────────────────────────────────────────────────────────────────────

export function Ine({ onSubmit }: { onSubmit: (front: File, back: File) => Promise<void> }) {
  const front = usePhoto();
  const back = usePhoto();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listas = !!front.file && !!back.file;

  const submit = async () => {
    if (!front.file || !back.file) return;
    setBusy(true); setError(null);
    try { await onSubmit(front.file, back.file); } catch (e) { setError(mensaje(e)); } finally { setBusy(false); }
  };

  return (
    <div className="k-card">
      <div className="k-kicker">PASO 2 DE 5</div>
      <h1>Fotografía tu INE</h1>
      <p className="k-lead">
        Necesitamos los dos lados. Ponla sobre una superficie plana, sin fundas ni reflejos, y que se
        lean todas las letras.
      </p>

      <div className="k-slots">
        <Slot titulo="Frente" ayuda="Donde está tu foto y tu nombre" icon={ICON.ine}
              aria="Frente de tu INE" photo={front} />
        <Slot titulo="Reverso" ayuda="Donde está el código de barras" icon={ICON.ineBack}
              aria="Reverso de tu INE" photo={back} />
      </div>

      <div className="k-tips">
        <div className="k-tip">Que quepa completa en el recuadro, sin dedos encima de los datos.</div>
        <div className="k-tip">Sin flash directo: el reflejo borra el nombre y hay que repetirla.</div>
        <div className="k-tip">Si tu INE está vencida o maltratada, háblale a tu distribuidora antes de seguir.</div>
      </div>

      <ErrorLine>{error}</ErrorLine>
      <Cta onClick={submit} disabled={!listas} busy={busy}>
        {busy ? 'Leyendo tu INE…' : listas ? 'Continuar' : 'Faltan fotos de tu INE'}
      </Cta>
    </div>
  );
}

/**
 * Un lado de la INE. Todo el recuadro es la `<label>` del campo de archivo, así que tocar en
 * cualquier parte abre la cámara trasera (`capture="environment"`) en el celular, y en una
 * computadora abre el selector de archivos.
 */
function Slot({ titulo, ayuda, icon, aria, photo }: {
  titulo: string; ayuda: string; icon: string; aria: string;
  photo: ReturnType<typeof usePhoto>;
}) {
  const done = !!photo.file;
  return (
    <label className={`k-slot${done ? ' done' : ''}`}>
      {photo.url && <img className="k-slot-thumb" src={photo.url} alt="" />}
      <input
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={aria}
        onChange={(e) => photo.pick(e.target.files?.[0] ?? null)}
      />
      <div className="k-slot-ico"><Icon d={icon} size={24} stroke={1.7} /></div>
      <b>{titulo}</b>
      <small>{ayuda}</small>
      <span className="k-chip">{done ? 'LISTO' : 'TOMAR FOTO'}</span>
    </label>
  );
}

// ── 3 · Tu cara ─────────────────────────────────────────────────────────────────────────────

export function Selfie({ onSubmit }: { onSubmit: (selfie: File) => Promise<void> }) {
  const photo = usePhoto();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    if (!photo.file) { input.current?.click(); return; }
    setBusy(true); setError(null);
    try { await onSubmit(photo.file); } catch (e) { setError(mensaje(e)); } finally { setBusy(false); }
  };

  return (
    <div className="k-card">
      <div className="k-kicker">PASO 3 DE 5</div>
      <h1>Ahora tu cara</h1>
      {/* El diseño prometía comparar un video contra la INE en automático. No hay proveedor que lo
          haga: la compara una persona. Decirle otra cosa sería prometerle una validación que no
          ocurre, y explicaría mal por qué tarda. */}
      <p className="k-lead">
        Tómate una selfie con la cámara de enfrente. Una persona de nuestro equipo la compara contra
        la foto de tu INE para confirmar que eres tú.
      </p>

      <div className="k-live">
        <label className={`k-live-frame${photo.file ? ' done' : ''}`}>
          {photo.url && <img src={photo.url} alt="Tu selfie" />}
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="user"
            aria-label="Tu selfie"
            onChange={(e) => photo.pick(e.target.files?.[0] ?? null)}
          />
          {!photo.url && (
            <>
              <div className="k-live-ico"><Icon d={ICON.face} size={30} stroke={1.7} /></div>
              <span className="k-live-label">Aquí se abre tu cámara frontal</span>
            </>
          )}
        </label>
        <div className="k-live-steps">
          <LiveStep n="1" title="Quítate lentes y gorra" desc="Nada que tape tus ojos o tu frente." />
          <LiveStep n="2" title="Busca buena luz" desc="De frente, no a contraluz de una ventana." />
          <LiveStep n="3" title="Mira a la cámara" desc="Toda tu cara dentro del recuadro, sin filtros ni efectos." />
          <LiveStep n="4" title="Hazlo tú" desc="Tiene que ser tu cara, en este momento: nadie puede hacerlo por ti." />
        </div>
      </div>

      {photo.file && (
        <button type="button" className="k-link" style={{ marginTop: 16 }} onClick={() => input.current?.click()}>
          Tomarla otra vez
        </button>
      )}
      <ErrorLine>{error}</ErrorLine>
      <Cta onClick={next} busy={busy}>{busy ? 'Enviando…' : photo.file ? 'Continuar' : 'Abrir mi cámara'}</Cta>
    </div>
  );
}

function LiveStep({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="k-live-step">
      <span className="n">{n}</span>
      <div><b>{title}</b><span>{desc}</span></div>
    </div>
  );
}

// ── 4 · Tus datos ───────────────────────────────────────────────────────────────────────────

export type FormKey = keyof PersonalData;
export type FormState = Record<FormKey, string>;

export const EMPTY_FORM: FormState = {
  firstName: '', lastName1: '', lastName2: '', curp: '', rfc: '', dateOfBirth: '',
  occupation: '', monthlyIncome: '', street: '', exteriorNumber: '', neighborhood: '',
  municipality: '', city: '', state: '', postalCode: '', clabe: '',
};

interface FieldDef {
  k: FormKey;
  label: string;
  wide?: boolean;
  /** Lo que nunca viene de la INE: siempre lo escribe ella. */
  suyo?: boolean;
  optional?: boolean;
  type?: string;
  ph?: string;
  numeric?: boolean;
  upper?: boolean;
  hint?: string;
  /** Encabezado que se pinta antes del campo. */
  section?: string;
}

/**
 * Los campos van separados —nombre, primer y segundo apellido; calle, número, colonia…— aunque el
 * diseño los juntaba: así los pide el expediente, y partir «Rosa Elena Díaz Fuentes» en el servidor
 * es adivinar dónde termina el nombre y empieza el apellido.
 */
const FIELDS: FieldDef[] = [
  { k: 'firstName', label: 'Nombre(s)', wide: true },
  { k: 'lastName1', label: 'Primer apellido' },
  { k: 'lastName2', label: 'Segundo apellido', optional: true, hint: 'Déjalo vacío si tu INE no trae segundo apellido.' },
  { k: 'curp', label: 'CURP', upper: true },
  { k: 'rfc', label: 'RFC', upper: true },
  { k: 'dateOfBirth', label: 'Fecha de nacimiento', type: 'date' },
  { k: 'occupation', label: 'Ocupación', suyo: true, ph: 'A qué te dedicas' },
  { k: 'monthlyIncome', label: 'Ingreso mensual', suyo: true, ph: '$14,000', numeric: true },
  { k: 'street', label: 'Calle', wide: true, section: 'TU DOMICILIO' },
  { k: 'exteriorNumber', label: 'Número', ph: '44, int. 3' },
  { k: 'neighborhood', label: 'Colonia' },
  { k: 'municipality', label: 'Alcaldía o municipio' },
  { k: 'city', label: 'Ciudad' },
  { k: 'state', label: 'Estado' },
  { k: 'postalCode', label: 'Código postal', numeric: true },
  {
    k: 'clabe', label: 'CLABE interbancaria', wide: true, suyo: true, numeric: true,
    ph: '18 dígitos', section: 'DÓNDE TE DEPOSITAMOS',
    hint: 'De una cuenta a tu nombre: el depósito no puede ir a la cuenta de otra persona.',
  },
];

function validar(f: FormState): Partial<Record<FormKey, string>> {
  const e: Partial<Record<FormKey, string>> = {};
  for (const def of FIELDS) {
    if (!def.optional && !f[def.k].trim()) e[def.k] = 'Falta este dato.';
  }
  if (!e.curp && curpError(f.curp)) e.curp = curpError(f.curp)!;
  if (!e.rfc && rfcError(f.rfc)) e.rfc = rfcError(f.rfc)!;
  if (!e.dateOfBirth && dateOfBirthError(f.dateOfBirth)) e.dateOfBirth = dateOfBirthError(f.dateOfBirth)!;
  if (!e.monthlyIncome && parseIncome(f.monthlyIncome) == null) e.monthlyIncome = 'Escribe una cantidad, como 14000.';
  if (!e.postalCode && postalCodeError(f.postalCode)) e.postalCode = postalCodeError(f.postalCode)!;
  if (!e.clabe && clabeError(f.clabe)) e.clabe = clabeError(f.clabe)!;
  return e;
}

export function Datos({ initial, fromIne, onSubmit }: {
  initial: FormState;
  /** Qué campos llegaron leídos de la INE, para marcarlos como tales. */
  fromIne: Set<FormKey>;
  onSubmit: (data: PersonalData) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: FormKey, upper?: boolean) => (v: string) => {
    const next = { ...form, [k]: upper ? v.toUpperCase() : v };
    setForm(next);
    // Corrige en vivo sólo después del primer intento: marcar en rojo mientras todavía escribe la
    // CURP es regañarla por no haber terminado.
    if (tried) setErrors(validar(next));
  };

  const submit = async () => {
    setTried(true);
    const e = validar(form);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setError('Revisa los datos marcados en rojo.');
      return;
    }
    setBusy(true); setError(null);
    try {
      await onSubmit({
        ...form,
        curp: form.curp.trim().toUpperCase(),
        rfc: form.rfc.trim().toUpperCase(),
        clabe: form.clabe.replace(/\s/g, ''),
        monthlyIncome: parseIncome(form.monthlyIncome)!,
      });
    } catch (err) {
      // El servidor valida igual y contesta por campo: se pinta donde corresponde, no en un
      // mensaje general que obligue a adivinar cuál de los dieciséis está mal.
      if (err instanceof KycError && err.code === 'DATOS_INVALIDOS' && err.body.fields
          && typeof err.body.fields === 'object') {
        setErrors(err.body.fields as Partial<Record<FormKey, string>>);
        setError('Revisa los datos marcados en rojo.');
      } else {
        setError(mensaje(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="k-kicker">PASO 4 DE 5</div>
        {fromIne.size > 0 && <span className="k-tag">LEÍMOS TU INE</span>}
      </div>
      <h1>Revisa que esté bien escrito</h1>
      <p className="k-lead">
        {fromIne.size > 0
          ? 'Sacamos esto de tu credencial. Corrige lo que esté mal: un dato equivocado detiene tu solicitud.'
          : 'Escríbelos como vienen en tu INE: un dato equivocado detiene tu solicitud.'}
      </p>

      <div className="k-fields">
        {FIELDS.map((def) => {
          const id = `f-${def.k}`;
          const msg = errors[def.k];
          const src = def.suyo || !fromIne.has(def.k) ? 'Dinos tú' : def.k === 'rfc' ? 'Calculado' : 'De tu INE';
          return (
            <FieldBlock key={def.k} def={def}>
              <div className="k-field-head">
                <label htmlFor={id}>{def.label}{def.optional ? ' (opcional)' : ''}</label>
                <span className={`k-src${src === 'Dinos tú' ? ' yours' : ''}`} aria-hidden="true">{src}</span>
              </div>
              <input
                id={id}
                className="k-input"
                type={def.type ?? 'text'}
                inputMode={def.numeric ? 'numeric' : undefined}
                autoCapitalize={def.upper ? 'characters' : undefined}
                maxLength={def.k === 'clabe' ? 18 : def.k === 'curp' ? 18 : undefined}
                placeholder={def.ph}
                value={form[def.k]}
                aria-invalid={msg ? true : undefined}
                aria-describedby={msg || def.hint ? `${id}-msg` : undefined}
                onChange={(e) => set(def.k, def.upper)(
                  def.k === 'clabe' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              />
              {(msg || def.hint) && (
                <div id={`${id}-msg`} className={`k-field-msg${msg ? ' bad' : ''}`}>{msg ?? def.hint}</div>
              )}
            </FieldBlock>
          );
        })}
      </div>

      <ErrorLine>{error}</ErrorLine>
      <Cta onClick={submit} busy={busy}>Mis datos son correctos</Cta>
    </div>
  );
}

function FieldBlock({ def, children }: { def: FieldDef; children: ReactNode }) {
  return (
    <>
      {def.section && <div className="k-section k-cap">{def.section}</div>}
      <div className={`k-field${def.wide ? ' wide' : ''}`}>{children}</div>
    </>
  );
}

// ── 5 · Autorización ────────────────────────────────────────────────────────────────────────

const CONSENTS = [
  {
    title: 'Acepto el aviso de privacidad',
    desc: 'Cómo guardamos y usamos tus datos, y por cuánto tiempo.',
    link: 'Leer el aviso completo',
    text: 'Kredius SAPI de CV SOFOM ENR es responsable de tus datos personales. Los usamos para identificarte, evaluar y administrar este crédito y cumplir con la ley. Los guardamos mientras el crédito exista y diez años después, como lo exige la regulación. Puedes ejercer tus derechos ARCO escribiendo a privacidad@kredius.mx.',
  },
  {
    title: 'Autorizo la consulta a buró y círculo de crédito',
    desc: 'Kredius puede pedir tu historial a las sociedades de información crediticia para evaluar esta solicitud. Vale por 6 meses.',
    link: 'Ver el texto de la autorización',
    text: 'Autorizo expresamente a Kredius SAPI de CV SOFOM ENR para que lleve a cabo investigaciones sobre mi comportamiento crediticio en las sociedades de información crediticia que estime conveniente. Conozco la naturaleza y alcance de la información que se solicitará y que esta autorización tiene vigencia de seis meses, o mientras mantenga una relación jurídica con Kredius.',
  },
  {
    title: 'Entiendo que este crédito es mío',
    desc: 'El contrato queda a mi nombre, el depósito llega a mi cuenta y yo soy quien debe pagarlo.',
    link: 'Ver contrato y tabla de pagos',
    text: 'El monto, el pago quincenal y el número de quincenas son los del resumen de abajo. El contrato completo y tu tabla de pagos te llegan por WhatsApp en cuanto se deposite, y los puedes consultar en la app Kredius.',
  },
];

export function Autorizacion({ invite, otpTail, consentsAccepted, onAccept, onSign }: {
  invite: Invite;
  /** Los dos últimos dígitos del código con que entró, si los tenemos en memoria. */
  otpTail: string | null;
  /** El servidor ya los registró: al retomar no se vuelven a mandar. */
  consentsAccepted: boolean;
  onAccept: () => Promise<void>;
  onSign: (code: string) => Promise<void>;
}) {
  const [checks, setChecks] = useState<boolean[]>(() => CONSENTS.map(() => consentsAccepted));
  const [open, setOpen] = useState<number | null>(null);
  const [signing, setSigning] = useState(consentsAccepted);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todos = checks.every(Boolean);

  /**
   * Firmar son dos tiempos: primero se registran las tres casillas, y luego se le pide el código
   * otra vez. El código es lo que convierte tres clics en una firma —prueba que quien aceptó es
   * quien tiene el celular— y por eso no basta con el que usó al entrar.
   */
  const cta = async () => {
    setError(null);
    if (!signing) {
      setBusy(true);
      try {
        if (!consentsAccepted) await onAccept();
        setSigning(true);
      } catch (e) { setError(mensaje(e)); } finally { setBusy(false); }
      return;
    }
    if (code.length !== 6) return;
    setBusy(true);
    try { await onSign(code); } catch (e) { setError(mensaje(e)); setCode(''); } finally { setBusy(false); }
  };

  return (
    <div className="k-card">
      <div className="k-kicker">PASO 5 DE 5</div>
      <h1>Tu autorización</h1>
      <p className="k-lead">
        Esto lo firmas tú, no tu distribuidora. Sin tu permiso no podemos consultar tu historial ni
        darte el crédito.
      </p>

      <div className="k-consents">
        {CONSENTS.map((c, i) => (
          <div key={c.title} className={`k-consent${checks[i] ? ' on' : ''}`}>
            <label>
              <input
                type="checkbox"
                className="sr-only"
                checked={checks[i]}
                disabled={signing}
                onChange={(e) => setChecks((cs) => cs.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              <span className="k-box" aria-hidden="true">✓</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="k-consent-title">{c.title}</span>
                <span className="k-consent-desc">{c.desc}</span>
              </span>
            </label>
            <button type="button" className="k-link" aria-expanded={open === i}
                    onClick={() => setOpen((o) => (o === i ? null : i))}>
              {c.link}
            </button>
            {open === i && <div className="k-consent-text">{c.text} <i>(versión {CONSENT_TEXT_VERSION})</i></div>}
          </div>
        ))}
      </div>

      <div className="k-summary">
        <div className="k-cap">RESUMEN DE LO QUE ACEPTAS</div>
        <div className="k-summary-grid">
          <div><div className="k">Recibes</div><div className="v good">{money(invite.amount)}</div></div>
          <div><div className="k">Pagas cada quincena</div><div className="v">{money(invite.fortnightlyPayment)}</div></div>
          <div><div className="k">Durante</div><div className="v">{invite.termFortnights} quincenas</div></div>
          <div><div className="k">Total a pagar</div><div className="v">{money(invite.totalToPay)}</div></div>
        </div>
        <div className="k-summary-foot">
          El monto y el plazo los definió tu distribuidora. Si no te acomodan, no firmes y háblale
          antes de continuar.
        </div>
      </div>

      {signing && (
        <div className="k-sign">
          <b>Escribe tu código para firmar</b>
          <p>El mismo que te mandamos al {invite.phoneMask}. Con él confirmas que quien acepta eres tú.</p>
          <OtpInput value={code} onChange={setCode} small autoFocus disabled={busy} />
          <DevHint />
        </div>
      )}

      <ErrorLine>{error}</ErrorLine>
      <Cta onClick={cta} disabled={!todos || (signing && code.length !== 6)} busy={busy}>
        Firmar con mi código{otpTail ? ` ••${otpTail}` : ''}
      </Cta>
    </div>
  );
}

// ── 6 · Listo ───────────────────────────────────────────────────────────────────────────────

export function Listo({ firstName, phoneMask }: { firstName: string | null; phoneMask: string }) {
  const pasos = [
    // Sin proveedor no hay «comparamos tu video en automático»: lo hace una persona, y eso es lo
    // que explica que no sea instantáneo.
    { title: 'Validamos tu identidad', desc: 'Una persona de nuestro equipo compara tu selfie contra tu INE: no tenemos un sistema automático que lo haga. Suele tardar unas horas en horario hábil.', tone: 'ok' },
    { title: 'Consultamos tu historial', desc: 'Con la autorización que acabas de firmar.', tone: 'ok' },
    { title: 'Tu distribuidora recibe la respuesta', desc: 'Ella decide si te coloca el préstamo con lo que encontremos.', tone: 'warn' },
    { title: 'Te depositamos', desc: 'Si todo sale bien, el mismo día por transferencia a tu cuenta.', tone: 'faint' },
  ];
  return (
    <>
      <div className="k-hero done">
        <div className="k-check"><Icon d={ICON.check} size={28} stroke={2} /></div>
        <h1>Listo{firstName ? `, ${firstName}` : ''}. Ya es nuestro turno.</h1>
        <p>
          Tu expediente quedó completo. Una persona de nuestro equipo valida tu identidad y te
          avisamos por WhatsApp al {phoneMask}. Ya puedes cerrar esta página.
        </p>
      </div>

      <div className="k-card soft">
        <div className="k-cap">QUÉ SIGUE</div>
        <div className="k-timeline">
          {pasos.map((p, i) => (
            <div className="k-tl" key={p.title}>
              <div className="k-tl-rail">
                <span className={`k-tl-dot ${p.tone}`} />
                {i < pasos.length - 1 && <span className="k-tl-line" />}
              </div>
              <div className="k-tl-body">
                <b className={p.tone === 'faint' ? 'faint' : undefined}>{p.title}</b>
                <span>{p.desc}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="k-note">
          <span>
            Descarga la app Kredius para ver tu contrato, tus pagos y tu saldo cuando quieras. Se
            entra con este mismo celular.
          </span>
        </div>
      </div>
    </>
  );
}

// ── Fuera del flujo ─────────────────────────────────────────────────────────────────────────

export function LigaInvalida({ detalle }: { detalle?: string | null }) {
  return (
    <div className="k-card">
      <div className="k-kicker">LIGA NO VÁLIDA</div>
      <h1>Esta liga ya no es válida</h1>
      <p className="k-lead">
        Puede que ya la hayas usado, que hayan pasado los 7 días que dura o que tu distribuidora la
        haya cancelado. Pídele que te mande una nueva: no necesitas empezar de cero con nadie más.
      </p>
      {detalle && <div className="k-note"><span>{detalle}</span></div>}
      <div className="k-note amber">
        <span>Si no pediste ningún préstamo, ignora este mensaje y no compartas tus datos.</span>
      </div>
    </div>
  );
}

export function SinConexion({ detalle, onRetry }: { detalle: string; onRetry: () => void }) {
  return (
    <div className="k-card">
      <div className="k-kicker">SIN CONEXIÓN</div>
      <h1>No pudimos abrir tu solicitud</h1>
      <p className="k-lead">{detalle}</p>
      <Cta onClick={onRetry}>Intentar de nuevo</Cta>
    </div>
  );
}
