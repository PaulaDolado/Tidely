import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "./AppText";
import { useTheme } from "../context/ThemeContext";
import { fonts, radius } from "../theme";

// Puerto literal de TermsOfUseSection/PrivacyPolicySection en
// dashboard/src/components/SettingsDialog.tsx — mismo contenido, palabra por palabra (sigue
// siendo un borrador razonable para una app en marcha, no un texto certificado por un abogado;
// el aviso de cabecera de cada sección ya lo deja claro), solo cambia el renderizado (Text/View de
// RN en vez de <p>/<ul> de HTML). Si el contenido cambia en la web, hay que replicarlo aquí a mano
// — no hay una fuente compartida entre dashboard/ y mobile/.
const POLICY_LAST_UPDATED = "11 de septiembre de 2026";

function LegalDisclaimer({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.disclaimer, { backgroundColor: colors.muted, color: colors.mutedForeground }]}>
      ℹ️ {children} Última actualización: {POLICY_LAST_UPDATED}.
    </Text>
  );
}

function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function P({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.paragraph, { color: colors.mutedForeground }]}>{children}</Text>;
}

function Li({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.listItem}>
      <Text style={[styles.bullet, { color: colors.mutedForeground }]}>•</Text>
      <Text style={[styles.paragraph, styles.listItemText, { color: colors.mutedForeground }]}>{children}</Text>
    </View>
  );
}

function Strong({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.strong, { color: colors.foreground }]}>{children}</Text>;
}

export function TermsOfUseSection() {
  return (
    <View>
      <LegalDisclaimer>
        Este es un borrador de condiciones de uso pensado para cubrir el funcionamiento real de Tidely — antes de tratarlo como
        vinculante conviene que lo revise un profesional legal.
      </LegalDisclaimer>

      <PolicySection title="1. Aceptación de las condiciones">
        <P>
          Al crear una cuenta o usar Tidely aceptas estas condiciones de uso. Si no estás de acuerdo con alguna parte, no debes
          utilizar la aplicación.
        </P>
      </PolicySection>

      <PolicySection title="2. Qué es Tidely">
        <P>
          Tidely es una aplicación personal de organización: agenda y calendario (con vista de día, semana, mes y año, eventos
          recurrentes y exportación a .ics/PDF), planificador de tareas con tableros personalizables, seguimiento de hábitos y
          objetivos, gestión financiera (ingresos, gastos, ahorro e inversión) y un espacio de proyectos con libretas de notas
          enriquecidas. Algunas funciones pueden integrarse con servicios de terceros, como la sincronización de solo lectura
          con Google Calendar.
        </P>
      </PolicySection>

      <PolicySection title="3. Tu cuenta">
        <P>
          Eres responsable de mantener la confidencialidad de tu contraseña y de toda actividad que ocurra en tu cuenta. Debes
          proporcionar datos veraces al registrarte (nombre, email) y mantenerlos actualizados. Puedes cambiar tu nombre de
          usuario una vez cada 15 días y tu contraseña cuando quieras desde Ajustes → Cuenta.
        </P>
        <P>Nos reservamos el derecho de suspender o cancelar cuentas que incumplan estas condiciones o la ley aplicable.</P>
      </PolicySection>

      <PolicySection title="4. Uso aceptable">
        <P>Al usar Tidely te comprometes a no:</P>
        <Li>Usar la aplicación con fines ilegales o para almacenar contenido ilícito.</Li>
        <Li>Intentar acceder a cuentas, datos o sistemas que no te pertenecen.</Li>
        <Li>Interferir con el funcionamiento normal del servicio (sobrecarga deliberada, ingeniería inversa, scraping masivo).</Li>
        <Li>Suplantar a otra persona o proporcionar información falsa al registrarte.</Li>
      </PolicySection>

      <PolicySection title="5. Tu contenido">
        <P>
          Todo lo que crees en Tidely (eventos, tareas, notas, libretas de proyecto, movimientos financieros, hábitos, objetivos)
          sigue siendo tuyo. No reclamamos ninguna propiedad sobre tu contenido; solo lo almacenamos y procesamos para poder
          ofrecerte el servicio (mostrarlo, sincronizarlo, exportarlo cuando lo pidas).
        </P>
      </PolicySection>

      <PolicySection title="6. Integraciones de terceros">
        <P>
          La sincronización con Google Calendar es de solo lectura: importa tus eventos de Google a Tidely, pero editar o mover
          un evento importado desde Tidely no modifica tu Google Calendar, y la siguiente sincronización automática (cada 30
          minutos) sobrescribe esos cambios con la versión de Google. Puedes desconectar esta integración en cualquier momento.
        </P>
      </PolicySection>

      <PolicySection title="7. Disponibilidad del servicio">
        <P>
          Hacemos lo posible por mantener Tidely disponible, pero no garantizamos un funcionamiento ininterrumpido ni libre de
          errores. Puede haber mantenimientos programados o interrupciones puntuales fuera de nuestro control.
        </P>
      </PolicySection>

      <PolicySection title="8. Cambios en el servicio o en estas condiciones">
        <P>
          Podemos actualizar Tidely (añadir, modificar o retirar funciones) y estas condiciones con el tiempo. Si el cambio es
          relevante, te avisaremos dentro de la aplicación o por email antes de que entre en vigor.
        </P>
      </PolicySection>

      <PolicySection title="9. Cancelación">
        <P>Puedes dejar de usar Tidely cuando quieras. Si quieres eliminar tu cuenta y tus datos, contáctanos desde Ajustes → Obtener ayuda.</P>
      </PolicySection>

      <PolicySection title="10. Contacto">
        <P>Para dudas sobre estas condiciones, escríbenos desde Ajustes → Obtener ayuda.</P>
      </PolicySection>
    </View>
  );
}

export function PrivacyPolicySection() {
  return (
    <View>
      <LegalDisclaimer>
        Este es un borrador de política de privacidad pensado para cubrir los datos que Tidely maneja realmente hoy — antes de
        tratarlo como vinculante conviene que lo revise un profesional legal (especialmente si tienes usuarios en la Unión
        Europea, donde aplica el RGPD).
      </LegalDisclaimer>

      <PolicySection title="1. Qué datos recogemos">
        <Li>
          <Strong>Cuenta: </Strong>nombre, apellido (opcional), nombre de usuario, email y contraseña (almacenada siempre
          cifrada, nunca en texto plano), zona horaria.
        </Li>
        <Li>
          <Strong>Contenido que creas: </Strong>eventos de agenda (título, descripción, horario, recurrencia, invitados,
          categorías), tareas y tableros del planificador, hábitos, objetivos, movimientos e informes financieros, proyectos y
          el contenido de sus libretas (texto, imágenes que subas).
        </Li>
        <Li>
          <Strong>Integraciones opcionales: </Strong>si conectas Google Calendar, guardamos el token de acceso necesario para
          leer tus eventos y la marca de la última sincronización — nunca tu contraseña de Google.
        </Li>
        <Li>
          <Strong>Datos técnicos: </Strong>registros básicos del servidor (fecha, endpoint, código de respuesta) para detectar
          errores y abusos, con fines de seguridad y estabilidad del servicio.
        </Li>
      </PolicySection>

      <PolicySection title="2. Para qué usamos tus datos">
        <Li>Prestar el servicio: mostrarte tu agenda, tareas, finanzas y proyectos, y guardarlos entre sesiones.</Li>
        <Li>Autenticarte y proteger tu cuenta (inicio de sesión, verificación de email, recuperación de contraseña).</Li>
        <Li>
          Enviarte avisos que tú mismo configuras (recordatorios de eventos) y comunicaciones de servicio imprescindibles
          (verificación de email, cambios de seguridad).
        </Li>
        <Li>Sincronizar con Google Calendar si activas esa integración.</Li>
        <Li>Mantener la seguridad y estabilidad de la aplicación (detectar y corregir errores, prevenir abuso).</Li>
        <P>No vendemos tus datos ni los usamos con fines publicitarios.</P>
      </PolicySection>

      <PolicySection title="3. Dónde se almacenan los datos">
        <P>
          Los datos se guardan en una base de datos PostgreSQL (alojada en Supabase) y la API que los sirve corre en Render. El
          acceso está protegido con autenticación por token (JWT) y contraseñas cifradas.
        </P>
      </PolicySection>

      <PolicySection title="4. Con quién compartimos datos">
        <P>
          Solo con los proveedores estrictamente necesarios para hacer funcionar Tidely (alojamiento de la base de datos y del
          servidor) y, si tú lo activas, con Google (para la sincronización de calendario). No compartimos tus datos con
          terceros para fines comerciales.
        </P>
      </PolicySection>

      <PolicySection title="5. Cuánto tiempo conservamos tus datos">
        <P>
          Conservamos tus datos mientras tu cuenta esté activa. Si eliminas tu cuenta, borramos tu contenido y datos personales
          en un plazo razonable, salvo lo que debamos conservar por obligación legal.
        </P>
      </PolicySection>

      <PolicySection title="6. Tus derechos">
        <P>
          Puedes acceder, rectificar o eliminar tus datos personales en cualquier momento: los datos básicos de cuenta desde
          Ajustes → Cuenta, y el resto de tu contenido eliminándolo directamente en la aplicación (o pidiéndonos el borrado
          completo de la cuenta desde Ajustes → Obtener ayuda). Si resides en la Unión Europea, estos derechos están amparados
          por el RGPD (acceso, rectificación, supresión, portabilidad y oposición).
        </P>
      </PolicySection>

      <PolicySection title="7. Seguridad">
        <P>
          Usamos contraseñas cifradas, tokens de sesión con expiración y renovación, y conexiones cifradas (HTTPS) entre tu
          navegador y nuestros servidores. Ningún sistema es 100% infalible, pero tomamos medidas razonables para proteger tu
          información.
        </P>
      </PolicySection>

      <PolicySection title="8. Menores de edad">
        <P>Tidely no está dirigida a menores de 16 años y no recogemos deliberadamente datos de menores de esa edad.</P>
      </PolicySection>

      <PolicySection title="9. Cambios en esta política">
        <P>
          Si cambiamos de forma relevante cómo tratamos tus datos, te lo notificaremos dentro de la aplicación o por email antes
          de que el cambio entre en vigor.
        </P>
      </PolicySection>

      <PolicySection title="10. Contacto">
        <P>Para cualquier duda sobre privacidad o para ejercer tus derechos, escríbenos desde Ajustes → Obtener ayuda.</P>
      </PolicySection>
    </View>
  );
}

const styles = StyleSheet.create({
  disclaimer: { fontFamily: fonts.sans, fontSize: 12, borderRadius: radius.input, padding: 12, marginBottom: 18, lineHeight: 17 },
  section: { marginBottom: 18, gap: 6 },
  sectionTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  paragraph: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  strong: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  listItem: { flexDirection: "row", gap: 6 },
  bullet: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  listItemText: { flex: 1 },
});
