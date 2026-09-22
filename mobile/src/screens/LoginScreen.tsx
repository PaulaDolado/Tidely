import { useState } from "react";
import { View, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Text, TextInput } from "../components/AppText";
import Svg, { Path } from "react-native-svg";
import { useAuth } from "../auth/AuthContext";
import { colors, fonts, radius, shadow } from "../theme";

// Ojo abierto/tachado — mismo trazo outline que su equivalente web (LoginPage.tsx), en SVG (ya es
// dependencia del proyecto, sin librería de iconos aparte).
function EyeIcon({ open, color }: { open: boolean; color: string }) {
  return open ? (
    <Svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={color} strokeWidth={1.75}>
      <Path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <Path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </Svg>
  ) : (
    <Svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={color} strokeWidth={1.75}>
      <Path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </Svg>
  );
}

// Campo de contraseña con botón para alternar texto plano/oculto — usado tanto en login como en
// registro (contraseña y repetir contraseña), cada uno con su propio estado de visibilidad. Mismo
// criterio que PasswordField en dashboard/src/pages/LoginPage.tsx.
function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable: boolean;
  onSubmitEditing?: () => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder={placeholder}
          secureTextEntry={!visible}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          onSubmitEditing={onSubmitEditing}
        />
        <Pressable onPress={() => setVisible((v) => !v)} hitSlop={8} style={styles.eyeButton}>
          <EyeIcon open={visible} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </>
  );
}

// Misma lógica que dashboard/src/pages/LoginPage.tsx (mismo toggle login/registro, mismos
// campos) — antes esta pantalla solo tenía login y la cuenta se creaba desde el dashboard web
// (Fase 1 deliberadamente mínima); ahora el registro también está disponible aquí. Estilo:
// mismo `.card-soft` + paleta que la web (ver src/theme.ts) — tarjeta blanca centrada sobre el
// fondo "paper", título en Instrument Serif, resto en Outfit.
function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function LoginScreen() {
  const { login, register, loading, error } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  // En login, un único campo sirve como username O email (ver authService.login: busca por
  // cualquiera de los dos) — de ahí `identifier`, separado de `email` (que en registro sí tiene
  // que ser un correo real). Mismo criterio que dashboard/src/pages/LoginPage.tsx.
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Solo en registro: repetir la contraseña para evitar errores de tecleo al crear la cuenta —
  // mismo criterio que dashboard/src/pages/LoginPage.tsx.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const switchMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setFormError(null);
    setConfirmPassword("");
  };

  const handleSubmit = () => {
    setFormError(null);
    if (mode === "login") {
      if (!identifier || !password) return;
      login(identifier, password).catch(() => {
        /* el error ya queda expuesto en `error` desde AuthContext */
      });
    } else {
      if (!name || !username || !email || !password || !confirmPassword) return;
      if (password !== confirmPassword) {
        setFormError("Las contraseñas no coinciden.");
        return;
      }
      register(username, email, password, name, detectTimezone()).catch(() => {
        /* el error ya queda expuesto en `error` desde AuthContext */
      });
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Tidely</Text>
          <Text style={styles.subtitle}>
            {mode === "login" ? "Inicia sesión para sincronizar tu Hoy" : "Crea tu cuenta para empezar a sincronizar"}
          </Text>

          {mode === "register" && (
            <>
              <Text style={styles.label}>Nombre</Text>
              <TextInput style={styles.input} placeholder="Nombre" value={name} onChangeText={setName} editable={!loading} />
            </>
          )}

          {mode === "register" && (
            <>
              <Text style={styles.label}>Nombre de usuario</Text>
              <TextInput
                style={styles.input}
                placeholder="Nuevo nombre de usuario"
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
                editable={!loading}
              />
            </>
          )}

          <Text style={styles.label}>{mode === "login" ? "Usuario o email" : "Email"}</Text>
          {mode === "login" ? (
            <TextInput
              style={styles.input}
              placeholder="Introduce el usuario o email"
              autoCapitalize="none"
              value={identifier}
              onChangeText={setIdentifier}
              editable={!loading}
            />
          ) : (
            <TextInput
              style={styles.input}
              placeholder="Tu correo electrónico"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
          )}

          <PasswordField
            label="Contraseña"
            placeholder={mode === "register" ? "Contraseña nueva" : "Introduce la contraseña"}
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            onSubmitEditing={mode === "login" ? handleSubmit : undefined}
          />

          {mode === "register" && (
            <PasswordField
              label="Repite la contraseña"
              placeholder="Repite la contraseña nueva"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!loading}
              onSubmitEditing={handleSubmit}
            />
          )}

          {mode === "register" && (
            <Text style={styles.hint}>
              Después de registrarte tendrás que verificar tu email — mientras tanto puedes usar la app con normalidad.
            </Text>
          )}

          {(formError || error) && <Text style={styles.error}>{formError || error}</Text>}

          <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSubmit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>{mode === "login" ? "Entrar" : "Registrarse"}</Text>
            )}
          </Pressable>

          <Pressable onPress={switchMode} disabled={loading}>
            <Text style={styles.switchModeText}>{mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 12,
    ...shadow,
  },
  title: { fontFamily: fonts.serif, fontSize: 32, textAlign: "center", color: colors.foreground },
  subtitle: { fontFamily: fonts.sans, fontSize: 14, textAlign: "center", color: colors.mutedForeground, marginTop: -4, marginBottom: 8 },
  label: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
    marginBottom: -6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  // `justifyContent: "center"` en vez de alinear el botón a mano por altura fija: así el ojo se
  // sigue centrando aunque cambie el alto del input.
  passwordRow: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 44 },
  eyeButton: { position: "absolute", right: 14 },
  hint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: -4 },
  error: {
    fontFamily: fonts.sans,
    color: colors.destructive,
    fontSize: 12,
    textAlign: "center",
    backgroundColor: colors.destructiveTint,
    borderWidth: 1,
    borderColor: colors.destructive,
    borderRadius: radius.input,
    padding: 10,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  switchModeText: { fontFamily: fonts.sans, textAlign: "center", color: colors.mutedForeground, fontSize: 12, marginTop: 8 },
});
