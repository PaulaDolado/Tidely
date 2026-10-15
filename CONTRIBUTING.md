# Cómo se trabaja en este repositorio

Los cambios entran en `main` **solo por pull request** (la rama está protegida: no se puede hacer `push` directo).

## Flujo

1. Crea una rama desde `main` actualizada, con un nombre corto que diga qué haces:
   `git switch main && git pull && git switch -c feat/lo-que-sea` (o `fix/...`, `docs/...`, `ci/...`).
2. Haz commits pequeños y con mensaje en español que expliquen el *porqué*.
3. Sube la rama y abre la PR: `git push -u origin feat/lo-que-sea` y `gh pr create` (o desde GitHub). La plantilla
   de PR te recuerda lo que hay que comprobar.
4. Espera al CI. Hay cuatro checks obligatorios, todos en `.github/workflows/ci.yml`:
   | Check | Qué comprueba |
   |---|---|
   | `test` | Lint y tipos del servidor, migraciones y la suite completa de tests |
   | `build` | Compila la API |
   | `build-dashboard` | ESLint, tipos y build de la web |
   | `mobile` | Tipos de la app móvil |
5. Fusiona con **Squash and merge** (un commit por PR en `main`); la rama se borra sola al fusionar.

## Qué pasa al fusionar

- La web se despliega sola en GitHub Pages (`deploy-pages.yml`).
- La API se despliega en Render desde `main`; el contenedor ejecuta `prisma migrate deploy` al arrancar, así que
  **una migración que llegue a `main` se aplica a producción**. Revísala con cuidado en la PR.
- Las versiones (APK + instalador de escritorio) **no salen de la fusión**: se publican al empujar una etiqueta
  `vX.Y.Z` anotada sobre `main` (`release.yml`); el mensaje de la etiqueta es el texto de la release.

## Reglas que ya cumple el CI

- Toda tabla nueva activa RLS en su migración (`tests/integration/rls.test.ts`): la API es lo único que habla con
  la base, y Supabase expone `public` por su Data API si no.
- Los tests del servidor se ejecutan siempre con `--runInBand` (comparten una sola base de datos).
