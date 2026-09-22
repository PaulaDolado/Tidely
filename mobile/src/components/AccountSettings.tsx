import { useState } from "react";
import { View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text, TextInput } from "./AppText";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { api, ApiError } from "../api/client";
import { fonts, radius } from "../theme";
import { User } from "../types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

// Puerto de AccountSection en dashboard/src/components/SettingsDialog.tsx: mismo formulario de
// perfil (usuario/email/nombre/apellido, con el cooldown de 15 días del username y el aviso de
// email sin verificar) y el mismo formulario de cambiar contraseña, ambos contra los mismos
// endpoints (PUT /auth/me, PUT /auth/me/password). La verificación de email en sí (clicar el
// enlace del correo) sigue pasando por la web — ver el comentario de resendVerification en
// AuthContext.tsx — así que aquí solo hace falta el botón de reenviar, no una pantalla propia.
export function AccountSettings() {
  const { user, updateUser, resendVerification } = useAuth();
  const { colors } = useTheme();

  const [username, setUsername] = useState(user?.username ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  // Igual que en la web: primer toque en "Guardar cambios" pide confirmar, un segundo toque ya
  // envía — cualquier edición posterior cancela la confirmación pendiente (markProfileDirty).
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

  const usernameLocked = !!user?.nextUsernameChangeAllowedAt && new Date(user.nextUsernameChangeAllowedAt) > new Date();

  const markProfileDirty = () => {
    setProfileSaved(false);
    setProfileError(null);
    setConfirmingSave(false);
  };

  const saveProfile = async () => {
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

  const savePassword = async () => {
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

  const inputStyle = { borderColor: colors.inputBorder, backgroundColor: colors.card, color: colors.foreground };
  const saveDisabled = profileSaving || !trimmedUsername || !trimmedName || !trimmedEmail || profileUnchanged;

  return (
    <View>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Nombre de usuario</Text>
      <TextInput
        value={username}
        onChangeText={(t) => {
          setUsername(t);
          markProfileDirty();
        }}
        editable={!usernameLocked}
        autoCapitalize="none"
        style={[styles.input, inputStyle, usernameLocked && styles.inputLocked]}
      />
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        {usernameLocked
          ? `Ya lo cambiaste hace poco — podrás volver a cambiarlo el ${formatDate(user!.nextUsernameChangeAllowedAt as string)}.`
          : "Sirve para iniciar sesión (también puedes usar el email). Solo se puede cambiar 1 vez cada 15 días."}
      </Text>

      <Text style={[styles.label, styles.fieldSpacing, { color: colors.mutedForeground }]}>Email</Text>
      <TextInput
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          markProfileDirty();
        }}
        autoCapitalize="none"
        keyboardType="email-address"
        style={[styles.input, inputStyle]}
      />
      <View style={styles.verifyRow}>
        {user?.emailVerified ? (
          <Text style={[styles.verifyText, { color: colors.primary }]}>✓ Verificado</Text>
        ) : (
          <>
            <Text style={[styles.verifyText, { color: colors.mutedForeground }]}>⚠️ Sin verificar</Text>
            <Pressable onPress={handleResendVerification} disabled={resendSaving} hitSlop={6}>
              <Text style={[styles.verifyLink, { color: colors.mutedForeground }]}>
                {resendSaving ? "Enviando…" : "Reenviar verificación"}
              </Text>
            </Pressable>
            {resendSent && <Text style={[styles.verifyText, { color: colors.primary }]}>Enviado.</Text>}
          </>
        )}
      </View>
      {resendError && <Text style={[styles.errorInline, { color: colors.destructive }]}>⚠️ {resendError}</Text>}

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Nombre</Text>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              markProfileDirty();
            }}
            style={[styles.input, inputStyle]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Apellido</Text>
          <TextInput
            value={lastName}
            onChangeText={(t) => {
              setLastName(t);
              markProfileDirty();
            }}
            placeholder="Opcional"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, inputStyle]}
          />
        </View>
      </View>

      {profileError && (
        <Text style={[styles.errorBox, { color: colors.destructive, backgroundColor: colors.destructiveTint, borderColor: colors.destructive }]}>
          ⚠️ {profileError}
        </Text>
      )}
      {profileSaved && <Text style={[styles.success, { color: colors.primary }]}>Datos actualizados.</Text>}
      {confirmingSave && !profileSaving && (
        <Text style={[styles.hint, styles.fieldSpacing, { color: colors.mutedForeground }]}>
          {isChangingUsername && isChangingEmail
            ? "Vas a cambiar el nombre de usuario (no podrás volver a cambiarlo hasta pasados 15 días) y el email (tendrás que verificarlo de nuevo)."
            : isChangingUsername
              ? "Vas a cambiar tu nombre de usuario — no podrás volver a cambiarlo hasta pasados 15 días."
              : isChangingEmail
                ? "Vas a cambiar tu email — tendrás que verificarlo de nuevo."
                : "¿Guardar estos cambios?"}
        </Text>
      )}

      <Pressable
        onPress={saveProfile}
        disabled={saveDisabled}
        style={[styles.button, { backgroundColor: confirmingSave ? colors.foreground : colors.primary, opacity: saveDisabled ? 0.6 : 1 }]}
      >
        {profileSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.buttonText, { color: confirmingSave ? colors.background : colors.primaryForeground }]}>
            {confirmingSave ? "¿Confirmar guardar?" : "Guardar cambios"}
          </Text>
        )}
      </Pressable>

      <View style={[styles.divider, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Cambiar contraseña</Text>
        <TextInput
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Contraseña actual"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, styles.fieldSpacing, inputStyle]}
        />
        <TextInput
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Nueva contraseña"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, styles.fieldSpacing, inputStyle]}
        />
        <TextInput
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Repite la nueva contraseña"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, styles.fieldSpacing, inputStyle]}
        />

        {passwordError && (
          <Text
            style={[
              styles.errorBox,
              styles.fieldSpacing,
              { color: colors.destructive, backgroundColor: colors.destructiveTint, borderColor: colors.destructive },
            ]}
          >
            ⚠️ {passwordError}
          </Text>
        )}
        {passwordSaved && <Text style={[styles.success, styles.fieldSpacing, { color: colors.primary }]}>Contraseña actualizada.</Text>}

        <Pressable onPress={savePassword} disabled={passwordSaving} style={[styles.button, styles.fieldSpacing, { backgroundColor: colors.primary }]}>
          {passwordSaving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Cambiar contraseña</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansBold, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  fieldSpacing: { marginTop: 10 },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    padding: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  inputLocked: { opacity: 0.6 },
  hint: { fontFamily: fonts.sans, fontSize: 12, marginTop: 4 },
  verifyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  verifyText: { fontFamily: fonts.sans, fontSize: 12 },
  verifyLink: { fontFamily: fonts.sans, fontSize: 12, textDecorationLine: "underline" },
  errorInline: { fontFamily: fonts.sans, fontSize: 11, marginTop: 4 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  errorBox: { fontFamily: fonts.sans, fontSize: 12, borderWidth: 1, borderRadius: radius.input, padding: 10, marginTop: 10 },
  success: { fontFamily: fonts.sans, fontSize: 12, marginTop: 10 },
  button: { borderRadius: radius.full, paddingVertical: 13, alignItems: "center", justifyContent: "center", marginTop: 14 },
  buttonText: { fontFamily: fonts.sansMedium, fontSize: 15 },
  divider: { borderTopWidth: 1, paddingTop: 18, marginTop: 22 },
  sectionTitle: { fontFamily: fonts.sansBold, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
});
