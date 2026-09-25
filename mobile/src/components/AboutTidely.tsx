import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, Linking, ActivityIndicator } from "react-native";
import { Text } from "./AppText";
import { useTheme } from "../context/ThemeContext";
import { fonts, radius } from "../theme";
import { checkForUpdate, AvailableUpdate, REPO } from "../utils/appUpdate";
import appJson from "../../app.json";

// "Sobre Tidely" en Ajustes: versión instalada + botón de actualizar si hay una más nueva (mismo
// checkForUpdate que ya usa el aviso de HoyScreen.tsx, aquí sin esperar a que aparezca solo) y el
// historial de versiones publicadas, leído en directo de GitHub Releases — no hay un changelog
// aparte que mantener a mano: el cuerpo de cada Release ES el mensaje del tag anotado
// (`git tag -a -m "..."`, ver el paso "Leer el mensaje del tag" en .github/workflows/release.yml),
// así que esto se mantiene solo con cada versión que se publica.
interface GithubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
}

function formatReleaseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

// El cuerpo trae el mensaje del tag tal cual: una primera línea que a veces repite la versión
// (ya se muestra aparte, en la cabecera de la tarjeta) y la línea de atribución del co-autor
// (interna, no algo que le interese al usuario) — ambas se descartan; el resto se pinta como
// párrafo suelto, o como viñeta si empieza por "- ".
function releaseBodyLines(release: GithubRelease): string[] {
  return (release.body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== release.tag_name && !line.startsWith("Co-Authored-By:"));
}

export function AboutTidelySection() {
  const { colors } = useTheme();
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [releases, setReleases] = useState<GithubRelease[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    checkForUpdate().then(setAvailableUpdate);
    fetch(`https://api.github.com/repos/${REPO}/releases`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: GithubRelease[]) => setReleases(data))
      .catch(() => setLoadError(true));
  }, []);

  return (
    <View>
      <View style={[styles.versionCard, { backgroundColor: colors.muted }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>Versión instalada</Text>
          <Text style={[styles.versionValue, { color: colors.foreground }]}>v{appJson.expo.version}</Text>
        </View>
        {availableUpdate && (
          <Pressable
            style={[styles.updateButton, { backgroundColor: colors.primary }]}
            onPress={() => Linking.openURL(availableUpdate.downloadUrl)}
          >
            <Text style={[styles.updateButtonText, { color: colors.primaryForeground }]}>
              Actualizar a v{availableUpdate.version}
            </Text>
          </Pressable>
        )}
      </View>
      {!availableUpdate && (
        <Text style={[styles.upToDate, { color: colors.mutedForeground }]}>
          {releases === null ? "Comprobando actualizaciones…" : "Ya tienes la última versión."}
        </Text>
      )}

      <Text style={[styles.changelogTitle, { color: colors.mutedForeground }]}>Historial de versiones</Text>
      {loadError ? (
        <Text style={[styles.paragraph, { color: colors.mutedForeground }]}>
          No se pudo cargar el historial de versiones — comprueba tu conexión.
        </Text>
      ) : releases === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
      ) : (
        releases.map((release) => <ReleaseEntry key={release.tag_name} release={release} />)
      )}
    </View>
  );
}

function ReleaseEntry({ release }: { release: GithubRelease }) {
  const { colors } = useTheme();
  const lines = releaseBodyLines(release);

  return (
    <View style={[styles.releaseBlock, { borderColor: colors.border }]}>
      <View style={styles.releaseHeader}>
        <Text style={[styles.releaseVersion, { color: colors.foreground }]}>{release.tag_name}</Text>
        <Text style={[styles.releaseDate, { color: colors.mutedForeground }]}>{formatReleaseDate(release.published_at)}</Text>
      </View>
      {lines.length === 0 ? (
        <Text style={[styles.paragraph, { color: colors.mutedForeground }]}>(sin notas)</Text>
      ) : (
        lines.map((line, i) =>
          line.startsWith("- ") ? (
            <View key={i} style={styles.listItem}>
              <Text style={[styles.bullet, { color: colors.mutedForeground }]}>•</Text>
              <Text style={[styles.paragraph, styles.listItemText, { color: colors.mutedForeground }]}>{line.slice(2)}</Text>
            </View>
          ) : (
            <Text key={i} style={[styles.paragraph, { color: colors.mutedForeground }]}>
              {line}
            </Text>
          )
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  versionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 8,
  },
  versionLabel: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  versionValue: { fontFamily: fonts.serif, fontSize: 20, marginTop: 2 },
  updateButton: { borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 10 },
  updateButtonText: { fontFamily: fonts.sansMedium, fontSize: 13 },
  upToDate: { fontFamily: fonts.sans, fontSize: 12, marginBottom: 18 },
  changelogTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  releaseBlock: { borderTopWidth: 1, paddingTop: 12, marginBottom: 16, gap: 4 },
  releaseHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  releaseVersion: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  releaseDate: { fontFamily: fonts.sans, fontSize: 11, textTransform: "capitalize" },
  paragraph: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  listItem: { flexDirection: "row", gap: 6 },
  bullet: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  listItemText: { flex: 1 },
});
