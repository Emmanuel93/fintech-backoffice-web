import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  KycError, kycApi, readSession, writeSession,
  type Extracted, type Invite, type SessionState, type SessionStep,
} from './api';
import {
  Autorizacion, Bienvenida, Celular, Datos, EMPTY_FORM, Ine, LigaInvalida, Listo, Selfie,
  SinConexion, type FormKey, type FormState,
} from './screens';

const RAIL = ['Bienvenida', 'Tu celular', 'Tu INE', 'Tu cara', 'Tus datos', 'Tu autorización'];

/** Pantallas del flujo, en el orden del riel. `6` es «Listo», que ya no tiene paso propio. */
type Paso = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Dónde retomar según lo que el servidor dice que falta. Él manda: el cliente no lleva la cuenta. */
const PASO_DE: Record<SessionStep, Paso> = {
  INE: 2, LIVENESS: 3, DATA: 4, CONSENTS: 5, SUBMIT: 5, DONE: 6,
};

type Fase =
  | { tipo: 'cargando' }
  | { tipo: 'invalida'; detalle?: string | null }
  | { tipo: 'sin-red'; detalle: string }
  | { tipo: 'flujo' };

/**
 * La liga de la beneficiaria: de «tu distribuidora te mandó un préstamo» a «ya es nuestro turno».
 *
 * El estado del proceso vive en el servidor, no aquí. Al recargar —o al volver tres días después
 * con la misma liga— se pregunta `GET /session` y se salta al paso que falta; llevar la cuenta en el
 * cliente haría que una recarga a media captura la mandara a subir su INE otra vez.
 */
export function App() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('t')?.trim() ?? '');
  const [fase, setFase] = useState<Fase>({ tipo: 'cargando' });
  const [invite, setInvite] = useState<Invite | null>(null);
  const [paso, setPaso] = useState<Paso>(0);
  const [session, setSession] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fromIne, setFromIne] = useState<Set<FormKey>>(new Set());
  const [consentsAccepted, setConsentsAccepted] = useState(false);
  // El código vive sólo en memoria y sólo su cola: es lo que el botón de firmar le recuerda
  // («••37»), no algo que haya que poder recuperar.
  const [otpTail, setOtpTail] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [otpNote, setOtpNote] = useState<string | null>(null);
  const [phoneMask, setPhoneMask] = useState('');
  const [firstName, setFirstName] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  /** Lo que ya capturó, de vuelta en el formulario. Sólo cadenas: lo demás no es de este form. */
  const absorber = useCallback((data: Partial<Record<string, unknown>> | Extracted | null, deIne: boolean) => {
    if (!data) return;
    const llenos: FormKey[] = [];
    setForm((f) => {
      const next = { ...f };
      for (const k of Object.keys(EMPTY_FORM) as FormKey[]) {
        const v = (data as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.trim()) { next[k] = v; llenos.push(k); }
        else if (typeof v === 'number') { next[k] = String(v); llenos.push(k); }
      }
      return next;
    });
    if (deIne) setFromIne(new Set(llenos));
  }, []);

  const retomar = useCallback((s: SessionState) => {
    absorber(s.data, false);
    setConsentsAccepted(s.consentsAccepted);
    if (s.data && typeof s.data.firstName === 'string') setFirstName(s.data.firstName);
    setPaso(PASO_DE[s.step] ?? 2);
  }, [absorber]);

  // Carga inicial. Sólo lecturas: en StrictMode este efecto corre dos veces en desarrollo, y un
  // envío de OTP aquí mandaría dos SMS. El primer envío lo dispara «Empezar».
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!token) { setFase({ tipo: 'invalida' }); return; }
      setFase({ tipo: 'cargando' });
      try {
        const inv = await kycApi.invite(token);
        if (!vivo) return;
        setInvite(inv);
        setPhoneMask(inv.phoneMask);
        setFirstName((n) => n ?? inv.beneficiaryFirstName);

        const guardada = readSession(token);
        if (guardada) {
          try {
            const s = await kycApi.session(guardada);
            if (!vivo) return;
            setSession(guardada);
            retomar(s);
          } catch (e) {
            // Una sesión vieja no es un error para ella: se olvida y se empieza por el código.
            if (e instanceof KycError && e.status === 401) writeSession(token, null);
            else throw e;
          }
        }
        if (vivo) setFase({ tipo: 'flujo' });
      } catch (e) {
        if (!vivo) return;
        if (e instanceof KycError && (e.status === 404 || e.code === 'LIGA_NO_VALIDA' || e.status === 410)) {
          setFase({ tipo: 'invalida', detalle: e.code === 'LIGA_NO_VALIDA' ? e.message : null });
        } else {
          setFase({ tipo: 'sin-red', detalle: e instanceof KycError ? e.message : 'No pudimos abrir tu solicitud.' });
        }
      }
    })();
    return () => { vivo = false; };
  }, [token, intento, retomar]);

  // Cada pantalla sube arriba al entrar: en un celular, el botón del paso anterior quedaba abajo y
  // la siguiente pantalla se abría a media página.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [paso]);

  const enviarOtp = async () => {
    try {
      const r = await kycApi.sendOtp(token);
      setPhoneMask(r.phoneMask || phoneMask);
      setResendAt(Date.now() + (r.resendInSeconds ?? 60) * 1000);
    } catch (e) {
      // Demasiados envíos: el último código que le llegó sigue sirviendo, así que se la deja en el
      // paso del código en vez de detenerla en la bienvenida.
      if (e instanceof KycError && e.status === 429) {
        setOtpNote('Ya te mandamos varios códigos. Usa el último que te llegó o espera unos minutos para pedir otro.');
        setResendAt(Date.now() + 120_000);
        return;
      }
      throw e;
    }
  };

  /**
   * Toda llamada con sesión pasa por aquí. Un 401 es que la sesión venció a media captura: se le
   * manda un código nuevo y vuelve al paso del celular, sin perder lo que ya escribió.
   */
  const conSesion = async <T,>(fn: (s: string) => Promise<T>): Promise<T> => {
    if (!session) { await caducar(); throw new KycError(401, 'SESION_EXPIRADA', 'Tu sesión venció. Confirma tu celular otra vez.'); }
    try {
      return await fn(session);
    } catch (e) {
      if (e instanceof KycError && e.status === 401) {
        await caducar();
        throw new KycError(401, 'SESION_EXPIRADA', 'Tu sesión venció. Confirma tu celular otra vez.');
      }
      throw e;
    }
  };

  const caducar = async () => {
    writeSession(token, null);
    setSession(null);
    setOtpNote('Por seguridad tu sesión venció. Te mandamos un código nuevo para seguir donde ibas.');
    setPaso(1);
    try { await enviarOtp(); } catch { /* el botón de reenviar queda disponible */ }
  };

  if (fase.tipo !== 'flujo' || !invite) {
    return (
      <Marco riel={false}>
        {fase.tipo === 'cargando' && <div className="k-spinner" role="status" aria-label="Cargando" />}
        {fase.tipo === 'invalida' && <LigaInvalida detalle={fase.detalle} />}
        {fase.tipo === 'sin-red' && <SinConexion detalle={fase.detalle} onRetry={() => setIntento((n) => n + 1)} />}
      </Marco>
    );
  }

  return (
    <Marco riel paso={paso}>
      {paso === 0 && (
        <Bienvenida invite={invite} onStart={async () => { await enviarOtp(); setPaso(1); }} />
      )}
      {paso === 1 && (
        <Celular
          phoneMask={phoneMask}
          resendAt={resendAt}
          note={otpNote}
          onResend={enviarOtp}
          onVerify={async (code) => {
            const r = await kycApi.verifyOtp(token, code);
            writeSession(token, r.sessionToken);
            setSession(r.sessionToken);
            setOtpTail(code.slice(-2));
            setOtpNote(null);
            try { retomar(await kycApi.session(r.sessionToken)); } catch { setPaso(2); }
          }}
        />
      )}
      {paso === 2 && (
        <Ine onSubmit={async (front, back) => {
          const r = await conSesion((s) => kycApi.uploadIne(s, front, back));
          absorber(r.extracted, true);
          setPaso(3);
        }} />
      )}
      {paso === 3 && (
        <Selfie onSubmit={async (selfie) => {
          await conSesion((s) => kycApi.uploadSelfie(s, selfie));
          setPaso(4);
        }} />
      )}
      {paso === 4 && (
        <Datos
          initial={form}
          fromIne={fromIne}
          onSubmit={async (data) => {
            await conSesion((s) => kycApi.saveData(s, data));
            setForm({ ...data, monthlyIncome: String(data.monthlyIncome) });
            setFirstName(data.firstName);
            setPaso(5);
          }}
        />
      )}
      {paso === 5 && (
        <Autorizacion
          invite={{ ...invite, phoneMask }}
          otpTail={otpTail}
          consentsAccepted={consentsAccepted}
          onAccept={async () => {
            await conSesion((s) => kycApi.acceptConsents(s));
            setConsentsAccepted(true);
          }}
          onSign={async (code) => {
            const r = await conSesion((s) => kycApi.submit(s, code));
            if (r.firstName) setFirstName(r.firstName);
            if (r.phoneMask) setPhoneMask(r.phoneMask);
            // Terminado, la sesión ya no abre nada: se olvida para que una recarga no intente
            // retomar un expediente cerrado.
            writeSession(token, null);
            setPaso(6);
          }}
        />
      )}
      {paso === 6 && <Listo firstName={firstName} phoneMask={phoneMask} />}
    </Marco>
  );
}

/** Encabezado, riel de pasos y pie. El riel sólo va donde hay un proceso que seguir. */
function Marco({ riel, paso = 0, children }: { riel: boolean; paso?: number; children: ReactNode }) {
  return (
    <div className="k-page">
      <header className="k-header">
        <div className="k-header-in">
          <div className="k-mark" aria-hidden="true"><span className="a" /><span className="b" /><span className="c" /></div>
          <span className="k-brand">Kredius</span>
          <div className="k-secure">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            </svg>
            Conexión segura
          </div>
        </div>
      </header>

      <div className={`k-shell${riel ? '' : ' solo'}`}>
        {riel && (
          <aside className="k-rail" aria-label="Tu avance">
            <div className="k-rail-cap">TU SOLICITUD</div>
            <ol className="k-rail-list">
              {RAIL.map((label, i) => {
                const done = i < paso;
                const on = i === paso;
                return (
                  <li key={label} className={`k-rail-row${on ? ' on' : ''}${done ? ' done' : ''}`}
                      aria-current={on ? 'step' : undefined}>
                    <span className="k-dot">{done ? '✓' : i + 1}</span>
                    <span className="k-rail-label">{label}</span>
                  </li>
                );
              })}
            </ol>
            <div className="k-rail-aside">
              <b>¿Dudas?</b>
              <p>Escríbenos por WhatsApp al 55 1234 5678. No le des tus códigos a nadie, ni a tu distribuidora.</p>
            </div>
          </aside>
        )}
        <main>{children}</main>
      </div>

      <footer className="k-footer">
        <div className="k-footer-in">
          <span>
            Kredius SAPI de CV SOFOM ENR. Tus datos se tratan conforme al aviso de privacidad y se
            usan solo para evaluar y administrar este crédito. La consulta a sociedades de
            información crediticia se hace únicamente con tu autorización expresa.
          </span>
          <span>© 2026 Kredius</span>
        </div>
      </footer>
    </div>
  );
}
