import { FormEvent, useState } from "react";
import { useAuth } from "../context/AuthContext";

function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

// Ojo abierto/tachado — mismo trazo outline que el icono de descarga de AppShell.tsx (sin librería
// de iconos instalada, así que va inline).
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

// Campo de contraseña con botón para alternar texto plano/oculto — usado tanto en login como en
// registro (contraseña y repetir contraseña), cada uno con su propio estado de visibilidad.
function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  minLength,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minLength?: number;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
      {label}
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={minLength}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="field-input w-full min-w-0 pr-10 normal-case tracking-normal"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <EyeIcon open={visible} />
        </button>
      </div>
    </label>
  );
}

export function LoginPage() {
  const { login, register, loading, error } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  // En login, un único campo sirve como username O email (ver authService.login: busca por
  // cualquiera de los dos). En registro hacen falta los dos por separado.
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Solo en registro: repetir la contraseña para evitar errores de tecleo al crear la cuenta (en
  // login no hace falta, ahí ya se sabe cuál es). Validación en el cliente antes de llamar a la
  // API — ver handleSubmit.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const switchMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setFormError(null);
    setConfirmPassword("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (mode === "register" && password !== confirmPassword) {
      setFormError("Las contraseñas no coinciden.");
      return;
    }
    try {
      if (mode === "login") {
        await login(identifier, password);
      } else {
        await register(username, email, password, name, detectTimezone());
      }
    } catch {
      // el error ya queda expuesto vía useAuth().error
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <form onSubmit={handleSubmit} className="card-soft flex w-full max-w-sm flex-col gap-4">
        <div className="mb-2 flex items-center justify-center gap-3">
          <h1 className="font-serif text-3xl">Tidely</h1>
        </div>
        <p className="-mt-2 text-center text-sm text-muted-foreground">
          {mode === "login" ? "Inicia sesión para continuar" : "Crea tu cuenta"}
        </p>

        {mode === "register" && (
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className="field-input normal-case tracking-normal" />
          </label>
        )}

        {mode === "register" && (
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Nombre de usuario
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={30}
              placeholder="Nuevo nombre de usuario"
              title="Minúsculas, números, puntos o guiones bajos"
              className="field-input normal-case tracking-normal"
            />
          </label>
        )}

        {mode === "login" ? (
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Usuario o email
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              placeholder="Introduce el usuario o email"
              className="field-input normal-case tracking-normal"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Tu correo electrónico"
              className="field-input normal-case tracking-normal"
            />
          </label>
        )}

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          minLength={mode === "register" ? 8 : undefined}
          placeholder={mode === "register" ? "Contraseña nueva" : "Introduce la contraseña"}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
        />

        {mode === "register" && (
          <PasswordField
            label="Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            minLength={8}
            placeholder="Repite la contraseña nueva"
            autoComplete="new-password"
          />
        )}

        {mode === "register" && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Después de registrarte tendrás que verificar tu email — mientras tanto puedes usar la app con normalidad.
          </p>
        )}

        {(formError || error) && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">⚠️ {formError || error}</p>
        )}

        <button type="submit" disabled={loading} className="btn-primary mt-2">
          {loading ? "Cargando..." : mode === "login" ? "Iniciar sesión" : "Registrarse"}
        </button>

        <button type="button" onClick={switchMode} className="cursor-pointer text-center text-xs text-muted-foreground hover:text-primary">
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </form>
    </div>
  );
}
