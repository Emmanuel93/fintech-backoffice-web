import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, DEMO_USERS, isMock, quickLoginPassword } from '@bo/api-client';
import { setSession } from '@bo/auth';
import { Brand, Button, Field, TextInput, ThemeToggle } from '@bo/design-system';
import { ROLE_LABELS } from '@bo/shared-types';

export function LoginPage() {
  const navigate = useNavigate();
  // Si hay contraseña de desarrollo (mock o .env.local), se precarga para poder entrar de un clic.
  // Si no la hay, el campo arranca vacío y lo teclea el usuario — nunca con un valor que va a fallar.
  const quickPassword = quickLoginPassword();
  const [email, setEmail] = useState('analista@kredius.mx');
  const [password, setPassword] = useState(quickPassword ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(mail: string, pass: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.login({ email: mail, password: pass });
      setSession(res);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bo-login">
      <form
        className="bo-login-card"
        onSubmit={(e) => { e.preventDefault(); void submit(email, password); }}
      >
        <div className="bo-login-brand" style={{ justifyContent: 'space-between' }}>
          {/* Sobre la tarjeta clara va la insignia —cuadro azul, K blanca—, igual que el ícono
              con el que el cliente abre la app. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Brand variant="badge" size={34} />
          </div>
          <ThemeToggle />
        </div>
        <h1>Backoffice de crédito</h1>
        <p className="sub">Acceso exclusivo para colaboradores. El token emitido tiene scope <b>BACKOFFICE</b>.</p>

        {error && <div className="bo-alert">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Correo corporativo" required>
            <TextInput
              value={email}
              onChange={setEmail}
              type="email"
              inputMode="email"
              autoComplete="username"
              name="email"
              placeholder="usuario@kredius.mx"
            />
          </Field>
          <Field label="Contraseña" required>
            <TextInput
              value={password}
              onChange={setPassword}
              type="password"
              autoComplete="current-password"
              name="password"
              placeholder="••••••••"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={loading || !email.trim() || !password}>
            {loading ? 'Ingresando…' : 'Iniciar sesión'}
          </Button>
        </div>

        {quickPassword && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--bo-border)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--bo-text-muted)', marginBottom: 10 }}>
              {isMock()
                ? 'Demo (modo mock) — carga un rol y entra para ver el RBAC:'
                : 'Empleados reales — carga un rol y entra para ver el RBAC:'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DEMO_USERS.map((u) => (
                <button
                  type="button"
                  key={u.email}
                  className={`bo-btn${email === u.email ? ' bo-btn-selected' : ''}`}
                  style={{ justifyContent: 'space-between' }}
                  // Rellena las credenciales; entrar sigue siendo el botón de entrar.
                  // Antes iniciaba sesión de un clic, y entonces la lista no era un
                  // atajo para escribir sino un segundo botón de acceso escondido
                  // entre nueve —uno por cada empleado— sin forma de ver con qué
                  // correo se iba a entrar antes de hacerlo.
                  onClick={() => { setEmail(u.email); setPassword(quickPassword); setError(null); }}
                >
                  <span>{u.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--bo-text-muted)' }}>
                    {u.roles.map((r) => ROLE_LABELS[r]).join(', ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
