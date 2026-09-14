import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ThemePicker } from "../components/SettingsDialog";
import { api, ApiError } from "../api/client";
import { EnabledSection, ENABLED_SECTIONS, SECTION_DESCRIPTIONS, SECTION_LABELS } from "../types";

type Step = "apartados" | "apariencia";

/**
 * Asistente de bienvenida, se muestra en vez del dashboard justo después de registrarse (ver
 * App.tsx: mientras `user.onboardingCompleted` sea `false`) — nunca se vuelve a mostrar solo una
 * vez completado. Dos pasos:
 *  1. Qué apartados opcionales quiere el usuario en el menú — todos marcados por defecto, así que
 *     "quiero todos" es tan simple como darle a Siguiente sin tocar nada (ver
 *     `authValidators.completeOnboardingSchema`: la lista completa es una elección tan válida
 *     como cualquier otra, no un caso especial).
 *  2. Apariencia — mismo `ThemePicker` que Ajustes → General, elegir ahí es tan permanente (o tan
 *     poco) como en Ajustes: se puede cambiar cuando se quiera después, este paso es solo para no
 *     dejar al usuario con el tema por defecto sin haber mirado las alternativas.
 * El PUT a /auth/me/onboarding solo pasa los apartados — el tema no necesita ir al backend, ya
 * vive en localStorage vía ThemeContext, igual que cuando se cambia desde Ajustes.
 */
export function OnboardingWizard() {
  const { updateUser } = useAuth();
  const [step, setStep] = useState<Step>("apartados");
  const [selected, setSelected] = useState<Set<EnabledSection>>(new Set(ENABLED_SECTIONS));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (section: EnabledSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const enabledSections = ENABLED_SECTIONS.filter((s) => selected.has(s));
      const profile = await api.put<{ enabledSections: EnabledSection[]; onboardingCompleted: boolean }>(
        "/auth/me/onboarding",
        { enabledSections }
      );
      updateUser({ enabledSections: profile.enabledSections, onboardingCompleted: profile.onboardingCompleted });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar — inténtalo de nuevo.");
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <div className="card-soft w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-3xl">Bienvenido a Tidely</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === "apartados" ? "Paso 1 de 2 — Apartados" : "Paso 2 de 2 — Apariencia"}
          </p>
        </div>

        {step === "apartados" ? (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              ¿Qué apartados quieres tener en tu menú? Puedes elegir todos los que quieras — y cambiarlo cuando quieras después
              desde Ajustes → General.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ENABLED_SECTIONS.map((section) => {
                const checked = selected.has(section);
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => toggle(section)}
                    aria-pressed={checked}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                      checked ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/30"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{SECTION_LABELS[section]}</span>
                      <span className="block text-xs text-muted-foreground">{SECTION_DESCRIPTIONS[section]}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button type="button" onClick={() => setStep("apariencia")} className="btn-primary mt-6 w-full">
              Siguiente
            </button>
          </>
        ) : (
          <>
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Elige tu gama de colores</p>
            <p className="mb-4 text-sm text-muted-foreground">
              "Sistema" mantiene el aspecto actual y sigue el modo claro/oscuro de tu dispositivo. Puedes probar los distintos
              temas ahora mismo — se aplican al instante.
            </p>
            <ThemePicker />
            <p className="mt-4 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              ℹ️ Esto siempre se puede cambiar más adelante desde Ajustes → General.
            </p>

            {error && (
              <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">⚠️ {error}</p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep("apartados")}
                disabled={saving}
                className="cursor-pointer rounded-full border border-border px-6 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Atrás
              </button>
              <button type="button" onClick={finish} disabled={saving} className="btn-primary flex-1">
                {saving ? "Guardando..." : "Empezar a usar Tidely"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
