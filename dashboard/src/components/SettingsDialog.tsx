import { FormEvent, ReactNode, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Theme, THEME_OPTIONS, useTheme } from "../context/ThemeContext";
import { api, ApiError } from "../api/client";
import { User } from "../types";

// Diálogo de ajustes: se abre al hacer click en el nombre del usuario en la barra lateral (ver
// AppShell). Antes esto era "ProfileDialog" — un único formulario de cuenta — ahora es un panel
// de varias secciones (menú a la izquierda, contenido a la derecha en pantallas grandes; el menú
// se aplana en una fila horizontal con scroll en móvil, mismo patrón que la barra de pestañas de
// AppShell). "Cuenta" es el antiguo ProfileDialog tal cual (mismo componente, solo movido aquí
// dentro como sección); el resto son secciones nuevas.
type SettingsSection = "cuenta" | "general" | "uso" | "privacidad" | "invitar" | "ayuda";

const SETTINGS_SECTIONS: { value: SettingsSection; label: string }[] = [
  { value: "cuenta", label: "Cuenta" },
  { value: "general", label: "General" },
  { value: "uso", label: "Política de uso" },
  { value: "privacidad", label: "Política de privacidad" },
  { value: "invitar", label: "Invita a un amigo" },
  { value: "ayuda", label: "Obtener ayuda" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>("cuenta");
  const activeLabel = SETTINGS_SECTIONS.find((s) => s.value === section)?.label ?? "Ajustes";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-card shadow-[var(--shadow-soft)] sm:flex-row"
      >
        {/* Menú de secciones: fila horizontal con scroll en móvil (como la barra de pestañas de
            AppShell), columna fija a la izquierda a partir de sm. */}
        <nav className="shrink-0 border-b border-border p-4 sm:w-48 sm:border-b-0 sm:border-r sm:p-6">
          <h2 className="mb-4 hidden font-serif text-lg sm:block">Ajustes</h2>
          <div className="flex gap-1.5 overflow-x-auto sm:flex-col sm:overflow-visible">
            {SETTINGS_SECTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSection(s.value)}
                className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-2 text-left text-sm transition-colors sm:rounded-xl ${
                  section === s.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-serif text-xl sm:hidden">Ajustes</h2>
            <h3 className="hidden font-serif text-xl sm:block">{activeLabel}</h3>
            <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              ✕ Cerrar
            </button>
          </div>

          {section === "cuenta" && <AccountSection />}
          {section === "general" && <GeneralSection />}
          {section === "uso" && <TermsOfUseSection />}
          {section === "privacidad" && <PrivacyPolicySection />}
          {section === "invitar" && <ComingSoonSection description="Comparte Tidely con quien quieras a través de un enlace de invitación propio." />}
          {section === "ayuda" && <ComingSoonSection description="Centro de ayuda, preguntas frecuentes y contacto directo con soporte." />}
        </div>
      </div>
    </div>
  );
}

// Previsualización de cada tema en su propia miniatura (fondo/tarjeta/acento) — colores fijos en
// vez de leer las variables CSS reales, a propósito: aquí hay que ENSEÑAR los 5 temas a la vez
// sin que elegir uno cambie cómo se ven los otros 4 en esta misma pantalla (si leyeran
// `var(--color-primary)` etc., las 5 miniaturas mostrarían siempre el tema ACTIVO, no el suyo
// propio). Mismos valores que sus bloques `[data-theme="..."]` en styles.css — si cambian ahí,
// cambian aquí también.
const THEME_PREVIEWS: Record<Theme, { background: string; card: string; primary: string }> = {
  sistema: { background: "#f7f4f1", card: "#ffffff", primary: "#5f7161" },
  basico: { background: "#f2f2f7", card: "#ffffff", primary: "#007aff" },
  oscuro: { background: "#000000", card: "#1c1c1e", primary: "#0a84ff" },
  salvia: { background: "#f9ead2", card: "#fffbf3", primary: "#4f5127" },
  espresso: { background: "#160c06", card: "#332116", primary: "#c89674" },
};

function GeneralSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Apariencia</p>
        <p className="mb-4 text-sm text-muted-foreground">
          Elige cómo se ve Tidely. "Sistema" mantiene el aspecto actual y sigue el modo claro/oscuro de tu dispositivo.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => {
            const preview = THEME_PREVIEWS[option.value];
            const selected = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={`cursor-pointer rounded-2xl border p-2 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/30"
                }`}
              >
                <span
                  className="mb-2 flex h-14 items-end gap-1 overflow-hidden rounded-xl p-1.5"
                  style={{ backgroundColor: preview.background }}
                >
                  <span className="h-full flex-1 rounded-md" style={{ backgroundColor: preview.card }} />
                  <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: preview.primary }} />
                </span>
                <span className={`block text-xs font-medium ${selected ? "text-primary" : "text-foreground"}`}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Sección genérica para lo que todavía no tiene funcionalidad real (Invita a un amigo, Obtener
// ayuda) — un único componente parametrizado en vez de dos casi idénticos, ya que de momento los
// dos son solo un aviso de "esto llega más adelante".
function ComingSoonSection({ description }: { description: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">🚧 Todavía no disponible — se implementará más adelante.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cuenta — antiguo ProfileDialog.tsx completo, ahora como una sección más de este diálogo (mismo
// comportamiento, sin diálogo/cabecera propios: los pone SettingsDialog).
// ---------------------------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function AccountSection() {
  const { user, updateUser, resendVerification } = useAuth();

  const [username, setUsername] = useState(user?.username ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  // "Guardar cambios" pide confirmar antes de mandar el PUT: primer click deja el formulario en
  // este estado (el botón cambia de texto), un segundo click ya envía de verdad. Cualquier
  // edición posterior (markProfileDirty) cancela la confirmación pendiente — no tiene sentido
  // conservarla si el usuario ha seguido escribiendo otra cosa distinta a lo que confirmó.
  const [confirmingSave, setConfirmingSave] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [resendSaving, setResendSaving] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const trimmedUsername = username.trim();
  const trimmedName = name.trim();
  const trimmedLastName = lastName.trim();
  const trimmedEmail = email.trim();

  const isChangingUsername = trimmedUsername !== (user?.username ?? "");
  const isChangingEmail = trimmedEmail !== (user?.email ?? "");

  const profileUnchanged =
    !isChangingUsername && trimmedName === (user?.name ?? "") && trimmedLastName === (user?.lastName ?? "") && !isChangingEmail;

  // El username solo se puede cambiar 1 vez cada 15 días — el backend es la fuente de verdad
  // (devuelve 429 si se intenta antes de tiempo), esto es solo para no dejar que el usuario
  // escriba uno nuevo y descubra el límite recién al darle a guardar.
  const usernameLocked = !!user?.nextUsernameChangeAllowedAt && new Date(user.nextUsernameChangeAllowedAt) > new Date();

  const markProfileDirty = () => {
    setProfileSaved(false);
    setProfileError(null);
    setConfirmingSave(false);
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmedUsername || !trimmedName || !trimmedEmail || profileUnchanged) return;
    if (!confirmingSave) {
      setConfirmingSave(true);
      return;
    }
    setConfirmingSave(false);
    setProfileSaving(true);
    setProfileError(null);
    try {
      const profile = await api.put<User>("/auth/me", {
        username: trimmedUsername,
        name: trimmedName,
        lastName: trimmedLastName || null,
        email: trimmedEmail,
      });
      updateUser({
        username: profile.username,
        name: profile.name,
        lastName: profile.lastName,
        email: profile.email,
        emailVerified: profile.emailVerified,
        nextUsernameChangeAllowedAt: profile.nextUsernameChangeAllowedAt,
      });
      setResendSent(false);
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : "No se pudieron guardar los cambios.");
    } finally {
      setProfileSaving(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword.length < 8) {
      setPasswordError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    setPasswordSaving(true);
    try {
      await api.put("/auth/me/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleResendVerification = async () => {
    setResendSaving(true);
    setResendError(null);
    try {
      await resendVerification();
      setResendSent(true);
    } catch (err) {
      setResendError(err instanceof ApiError ? err.message : "No se pudo mandar el email de verificación.");
    } finally {
      setResendSaving(false);
    }
  };

  return (
    <div>
      <form onSubmit={saveProfile} className="mb-8">
        <label className="mb-1 flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Nombre de usuario
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              markProfileDirty();
            }}
            required
            minLength={3}
            maxLength={30}
            disabled={usernameLocked}
            title="Minúsculas, números, puntos o guiones bajos"
            className={`field-input normal-case tracking-normal ${usernameLocked ? "cursor-not-allowed text-muted-foreground opacity-70" : ""}`}
          />
        </label>
        <p className="mb-3 text-xs text-muted-foreground">
          {usernameLocked
            ? `Ya lo cambiaste hace poco — podrás volver a cambiarlo el ${formatDate(user!.nextUsernameChangeAllowedAt as string)}.`
            : "Sirve para iniciar sesión (también puedes usar el email). Solo se puede cambiar 1 vez cada 15 días."}
        </p>

        <label className="mb-1 flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              markProfileDirty();
            }}
            required
            className="field-input normal-case tracking-normal"
          />
        </label>
        <div className="mb-3 flex items-center gap-2 text-xs">
          {user?.emailVerified ? (
            <span className="text-primary">✓ Verificado</span>
          ) : (
            <>
              <span className="text-muted-foreground">⚠️ Sin verificar</span>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendSaving}
                className="cursor-pointer text-muted-foreground underline hover:text-foreground disabled:cursor-not-allowed"
              >
                {resendSaving ? "Enviando…" : "Reenviar verificación"}
              </button>
              {resendSent && <span className="text-primary">Enviado.</span>}
            </>
          )}
        </div>
        {resendError && <p className="-mt-2 mb-3 text-xs text-destructive">⚠️ {resendError}</p>}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Nombre
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                markProfileDirty();
              }}
              minLength={2}
              required
              className="field-input normal-case tracking-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Apellido
            <input
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                markProfileDirty();
              }}
              placeholder="Opcional"
              className="field-input normal-case tracking-normal"
            />
          </label>
        </div>

        {profileError && (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">⚠️ {profileError}</p>
        )}
        {profileSaved && <p className="mt-3 text-xs text-primary">Datos actualizados.</p>}
        {confirmingSave && !profileSaving && (
          <p className="mt-3 text-xs text-muted-foreground">
            {isChangingUsername && isChangingEmail
              ? "Vas a cambiar el nombre de usuario (no podrás volver a cambiarlo hasta pasados 15 días) y el email (tendrás que verificarlo de nuevo)."
              : isChangingUsername
                ? "Vas a cambiar tu nombre de usuario — no podrás volver a cambiarlo hasta pasados 15 días."
                : isChangingEmail
                  ? "Vas a cambiar tu email — tendrás que verificarlo de nuevo."
                  : "¿Guardar estos cambios?"}
          </p>
        )}

        <button
          type="submit"
          disabled={profileSaving || !trimmedUsername || !trimmedName || !trimmedEmail || profileUnchanged}
          className={`mt-4 ${confirmingSave ? "btn-dark" : "btn-primary"}`}
        >
          {profileSaving ? "Guardando..." : confirmingSave ? "¿Confirmar guardar?" : "Guardar cambios"}
        </button>
      </form>

      <div className="border-t border-border pt-6">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Cambiar contraseña</h3>
        <form onSubmit={savePassword} className="grid gap-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Contraseña actual"
            required
            className="field-input"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Nueva contraseña"
            required
            minLength={8}
            className="field-input"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repite la nueva contraseña"
            required
            minLength={8}
            className="field-input"
          />

          {passwordError && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">⚠️ {passwordError}</p>
          )}
          {passwordSaved && <p className="text-xs text-primary">Contraseña actualizada.</p>}

          <button type="submit" disabled={passwordSaving} className="btn-primary">
            {passwordSaving ? "Guardando..." : "Cambiar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Política de uso / Política de privacidad — contenido real (no un stub), redactado a partir de
// las funciones reales de Tidely (agenda con Google Calendar, planificador, finanzas, proyectos/
// libretas, hábitos, objetivos...). Es un documento de partida razonable para una app en marcha,
// no un texto certificado por un abogado — el aviso de la cabecera de cada sección lo deja claro
// y recomienda revisión legal antes de tratarlo como vinculante.
// ---------------------------------------------------------------------------------------------

const POLICY_LAST_UPDATED = "11 de septiembre de 2026";

function LegalDisclaimer({ children }: { children: ReactNode }) {
  return (
    <p className="mb-6 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
      ℹ️ {children} Última actualización: {POLICY_LAST_UPDATED}.
    </p>
  );
}

function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className="mb-1.5 text-sm font-semibold">{title}</h4>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function TermsOfUseSection() {
  return (
    <div className="text-sm leading-relaxed">
      <LegalDisclaimer>
        Este es un borrador de condiciones de uso pensado para cubrir el funcionamiento real de Tidely — antes de tratarlo como
        vinculante conviene que lo revise un profesional legal.
      </LegalDisclaimer>

      <PolicySection title="1. Aceptación de las condiciones">
        <p>
          Al crear una cuenta o usar Tidely aceptas estas condiciones de uso. Si no estás de acuerdo con alguna parte, no debes
          utilizar la aplicación.
        </p>
      </PolicySection>

      <PolicySection title="2. Qué es Tidely">
        <p>
          Tidely es una aplicación personal de organización: agenda y calendario (con vista de día, semana, mes y año, eventos
          recurrentes y exportación a .ics/PDF), planificador de tareas con tableros personalizables, seguimiento de hábitos y
          objetivos, gestión financiera (ingresos, gastos, ahorro e inversión) y un espacio de proyectos con libretas de notas
          enriquecidas. Algunas funciones pueden integrarse con servicios de terceros, como la sincronización de solo lectura
          con Google Calendar.
        </p>
      </PolicySection>

      <PolicySection title="3. Tu cuenta">
        <p>
          Eres responsable de mantener la confidencialidad de tu contraseña y de toda actividad que ocurra en tu cuenta. Debes
          proporcionar datos veraces al registrarte (nombre, email) y mantenerlos actualizados. Puedes cambiar tu nombre de
          usuario una vez cada 15 días y tu contraseña cuando quieras desde Ajustes → Cuenta.
        </p>
        <p>Nos reservamos el derecho de suspender o cancelar cuentas que incumplan estas condiciones o la ley aplicable.</p>
      </PolicySection>

      <PolicySection title="4. Uso aceptable">
        <p>Al usar Tidely te comprometes a no:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Usar la aplicación con fines ilegales o para almacenar contenido ilícito.</li>
          <li>Intentar acceder a cuentas, datos o sistemas que no te pertenecen.</li>
          <li>Interferir con el funcionamiento normal del servicio (sobrecarga deliberada, ingeniería inversa, scraping masivo).</li>
          <li>Suplantar a otra persona o proporcionar información falsa al registrarte.</li>
        </ul>
      </PolicySection>

      <PolicySection title="5. Tu contenido">
        <p>
          Todo lo que crees en Tidely (eventos, tareas, notas, libretas de proyecto, movimientos financieros, hábitos, objetivos)
          sigue siendo tuyo. No reclamamos ninguna propiedad sobre tu contenido; solo lo almacenamos y procesamos para poder
          ofrecerte el servicio (mostrarlo, sincronizarlo, exportarlo cuando lo pidas).
        </p>
      </PolicySection>

      <PolicySection title="6. Integraciones de terceros">
        <p>
          La sincronización con Google Calendar es de solo lectura: importa tus eventos de Google a Tidely, pero editar o mover
          un evento importado desde Tidely no modifica tu Google Calendar, y la siguiente sincronización automática (cada 30
          minutos) sobrescribe esos cambios con la versión de Google. Puedes desconectar esta integración en cualquier momento.
        </p>
      </PolicySection>

      <PolicySection title="7. Disponibilidad del servicio">
        <p>
          Hacemos lo posible por mantener Tidely disponible, pero no garantizamos un funcionamiento ininterrumpido ni libre de
          errores. Puede haber mantenimientos programados o interrupciones puntuales fuera de nuestro control.
        </p>
      </PolicySection>

      <PolicySection title="8. Cambios en el servicio o en estas condiciones">
        <p>
          Podemos actualizar Tidely (añadir, modificar o retirar funciones) y estas condiciones con el tiempo. Si el cambio es
          relevante, te avisaremos dentro de la aplicación o por email antes de que entre en vigor.
        </p>
      </PolicySection>

      <PolicySection title="9. Cancelación">
        <p>
          Puedes dejar de usar Tidely cuando quieras. Si quieres eliminar tu cuenta y tus datos, contáctanos desde Ajustes →
          Obtener ayuda.
        </p>
      </PolicySection>

      <PolicySection title="10. Contacto">
        <p>Para dudas sobre estas condiciones, escríbenos desde Ajustes → Obtener ayuda.</p>
      </PolicySection>
    </div>
  );
}

function PrivacyPolicySection() {
  return (
    <div className="text-sm leading-relaxed">
      <LegalDisclaimer>
        Este es un borrador de política de privacidad pensado para cubrir los datos que Tidely maneja realmente hoy — antes de
        tratarlo como vinculante conviene que lo revise un profesional legal (especialmente si tienes usuarios en la Unión
        Europea, donde aplica el RGPD).
      </LegalDisclaimer>

      <PolicySection title="1. Qué datos recogemos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cuenta:</strong> nombre, apellido (opcional), nombre de usuario, email y contraseña (almacenada siempre
            cifrada, nunca en texto plano), zona horaria.
          </li>
          <li>
            <strong>Contenido que creas:</strong> eventos de agenda (título, descripción, horario, recurrencia, invitados,
            categorías), tareas y tableros del planificador, hábitos, objetivos, movimientos e informes financieros, proyectos
            y el contenido de sus libretas (texto, imágenes que subas).
          </li>
          <li>
            <strong>Integraciones opcionales:</strong> si conectas Google Calendar, guardamos el token de acceso necesario para
            leer tus eventos y la marca de la última sincronización — nunca tu contraseña de Google.
          </li>
          <li>
            <strong>Datos técnicos:</strong> registros básicos del servidor (fecha, endpoint, código de respuesta) para
            detectar errores y abusos, con fines de seguridad y estabilidad del servicio.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="2. Para qué usamos tus datos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Prestar el servicio: mostrarte tu agenda, tareas, finanzas y proyectos, y guardarlos entre sesiones.</li>
          <li>Autenticarte y proteger tu cuenta (inicio de sesión, verificación de email, recuperación de contraseña).</li>
          <li>Enviarte avisos que tú mismo configuras (recordatorios de eventos) y comunicaciones de servicio imprescindibles (verificación de email, cambios de seguridad).</li>
          <li>Sincronizar con Google Calendar si activas esa integración.</li>
          <li>Mantener la seguridad y estabilidad de la aplicación (detectar y corregir errores, prevenir abuso).</li>
        </ul>
        <p>No vendemos tus datos ni los usamos con fines publicitarios.</p>
      </PolicySection>

      <PolicySection title="3. Dónde se almacenan los datos">
        <p>
          Los datos se guardan en una base de datos PostgreSQL (alojada en Supabase) y la API que los sirve corre en Render.
          El acceso está protegido con autenticación por token (JWT) y contraseñas cifradas.
        </p>
      </PolicySection>

      <PolicySection title="4. Con quién compartimos datos">
        <p>
          Solo con los proveedores estrictamente necesarios para hacer funcionar Tidely (alojamiento de la base de datos y del
          servidor) y, si tú lo activas, con Google (para la sincronización de calendario). No compartimos tus datos con
          terceros para fines comerciales.
        </p>
      </PolicySection>

      <PolicySection title="5. Cuánto tiempo conservamos tus datos">
        <p>
          Conservamos tus datos mientras tu cuenta esté activa. Si eliminas tu cuenta, borramos tu contenido y datos personales
          en un plazo razonable, salvo lo que debamos conservar por obligación legal.
        </p>
      </PolicySection>

      <PolicySection title="6. Tus derechos">
        <p>
          Puedes acceder, rectificar o eliminar tus datos personales en cualquier momento: los datos básicos de cuenta desde
          Ajustes → Cuenta, y el resto de tu contenido eliminándolo directamente en la aplicación (o pidiéndonos el borrado
          completo de la cuenta desde Ajustes → Obtener ayuda). Si resides en la Unión Europea, estos derechos están
          amparados por el RGPD (acceso, rectificación, supresión, portabilidad y oposición).
        </p>
      </PolicySection>

      <PolicySection title="7. Seguridad">
        <p>
          Usamos contraseñas cifradas, tokens de sesión con expiración y renovación, y conexiones cifradas (HTTPS) entre tu
          navegador y nuestros servidores. Ningún sistema es 100% infalible, pero tomamos medidas razonables para proteger tu
          información.
        </p>
      </PolicySection>

      <PolicySection title="8. Menores de edad">
        <p>Tidely no está dirigida a menores de 16 años y no recogemos deliberadamente datos de menores de esa edad.</p>
      </PolicySection>

      <PolicySection title="9. Cambios en esta política">
        <p>
          Si cambiamos de forma relevante cómo tratamos tus datos, te lo notificaremos dentro de la aplicación o por email
          antes de que el cambio entre en vigor.
        </p>
      </PolicySection>

      <PolicySection title="10. Contacto">
        <p>Para cualquier duda sobre privacidad o para ejercer tus derechos, escríbenos desde Ajustes → Obtener ayuda.</p>
      </PolicySection>
    </div>
  );
}
