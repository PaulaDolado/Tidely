# Contribuir

Proyecto personal de portfolio, pero estructurado para aceptar contribuciones si alguien quiere proponer algo.

## Setup

Ver [README.md](README.md#setup) para instalar dependencias, levantar Postgres y correr el servidor.

## Antes de abrir un PR

```bash
npm run lint          # ESLint sin errores
npx tsc --noEmit        # typecheck sin errores
npm test                 # unit + integration en verde (requiere Postgres levantado)
(cd dashboard && npm run lint && npm run build)   # si tocas la web
(cd mobile && npx tsc --noEmit)                   # si tocas la app móvil
```

El CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) corre estos mismos pasos — si pasan en local, deberían pasar ahí.

## Convenciones de código

- **Controllers delgados**: parsean `req`, llaman al `service`, formatean la respuesta. Cero lógica de negocio ni acceso a Prisma directo — eso vive en `services/`.
- **Un `service` por módulo**, exporta funciones puras/async (no una clase). Los helpers puramente de cálculo (sin Prisma) se exportan para poder testearlos sin mockear la BD — ver `computeGoalRisk` en `goalsService.ts` o `expandRecurringEvent` en `utils/recurrence.ts`.
- **Ownership**: cualquier endpoint que lea/edite/borre un recurso de un usuario debe verificar `resource.userId === req.userId` antes de tocarlo, lanzando `ForbiddenError` (403) si no coincide y `NotFoundError` (404) si no existe. Sigue el patrón `findOwned*` ya usado en cada service.
- **Validación con Joi** en `validators/`, aplicada en las rutas vía el middleware `validate(schema)` — nunca valides a mano dentro de un controller.
- **Errores**: lanza una subclase de `AppError` (`utils/errorHandler.ts`) desde el service; el middleware de error centralizado (`middlewares/errorHandler.ts`) se encarga de mapearla a la respuesta HTTP. No captures errores en el controller salvo para pasarlos a `next(error)`.
- **Paginación** en cualquier listado nuevo: usa el `paginationQuerySchema` compartido (`validators/pagination.ts`) y `buildPagination()` (`utils/pagination.ts`) para mantener la misma forma de respuesta (`{ page, limit, total, pages }`) en todos lados.

## Añadir un módulo nuevo (checklist)

Sigue el patrón de los módulos existentes (`goals`, `projects`, etc.):

1. Modelo(s) en `prisma/schema.prisma` + `npx prisma generate`
2. `src/validators/miModuloValidators.ts` — esquemas Joi
3. `src/services/miModuloService.ts` — lógica de negocio, funciones exportadas
4. `src/controllers/miModuloController.ts` — capa HTTP delgada
5. `src/routes/miModulo.routes.ts` — rutas + anotaciones `@openapi` para Swagger
6. Wire en `src/routes/index.ts`
7. Tests unitarios en `tests/unit/services/miModuloService.test.ts` (Prisma mockeado) + `tests/unit/validators/miModuloValidators.test.ts`
8. Test de integración en `tests/integration/miModulo.test.ts` (contra Postgres real)
9. Documentar en [API.md](API.md) y, si aplica, [DATABASE.md](DATABASE.md)

## Commits y PRs

Los cambios entran en `main` **solo por pull request**: la rama está protegida y no admite `push` directo.

1. Crea una rama desde `main` actualizada, con un nombre corto que diga qué haces:
   `git switch main && git pull && git switch -c feat/lo-que-sea` (o `fix/…`, `docs/…`, `ci/…`).
2. Haz commits pequeños. Sin convención estricta (no Conventional Commits obligatorio), pero el mensaje debe explicar
   el *por qué*, no solo el *qué*.
3. Sube la rama y abre la PR (`git push -u origin feat/lo-que-sea` y `gh pr create`, o desde GitHub). La
   [plantilla de PR](.github/pull_request_template.md) te recuerda lo que hay que comprobar.
4. Espera al CI: hay **cuatro checks obligatorios** y los cuatro tienen que estar en verde para poder fusionar.

   | Check | Qué comprueba |
   |---|---|
   | `test` | Lint y tipos del servidor, migraciones y la suite completa de tests |
   | `build` | Compila la API |
   | `build-dashboard` | ESLint, tipos y build de la web |
   | `mobile` | Tipos de la app móvil |

5. Fusiona con **Squash and merge** (un commit por PR en `main`); la rama se borra sola al fusionar.

Una PR debe, además:
- Actualizar la documentación relevante si cambia comportamiento observable (endpoints, schema, variables de entorno)
- Incluir tests para el cambio (unitarios como mínimo; de integración si toca un flujo HTTP completo)

### Qué pasa al fusionar

- La web se despliega sola en GitHub Pages (`deploy-pages.yml`).
- La API se despliega en Render desde `main`; el contenedor ejecuta `prisma migrate deploy` al arrancar, así que
  **una migración que llegue a `main` se aplica a producción**: revísala con cuidado en la PR.
- Las versiones (APK + instalador de escritorio) **no salen de la fusión**: se publican al empujar una etiqueta
  `vX.Y.Z` anotada sobre `main` (`release.yml`); el mensaje de la etiqueta es el texto de la release.

### Reglas que hace cumplir el CI

- Toda tabla nueva activa RLS en su propia migración (`tests/integration/rls.test.ts`): la API es lo único que habla
  con la base, y Supabase expone `public` por su Data API si no.
- Los tests del servidor se ejecutan siempre con `--runInBand` (comparten una sola base de datos).

### Dependabot

- Cada lunes (07:00, Madrid) abre PRs con actualizaciones de dependencias, agrupadas por ecosistema (servidor, web, móvil, acciones de GitHub y Dockerfile), con la etiqueta `dependencias`. Pasan por el mismo CI que cualquier cambio.
- Las **alertas de vulnerabilidades** abren su PR aparte y al momento, sin esperar al lunes.
- Se dejan fuera a propósito: las versiones de **Expo, React Native y módulos nativos** (las fija el SDK de Expo: se suben con `npx expo install --fix`), las versiones **mayores** de la imagen `node` del Dockerfile y la v6 de `gradle/actions` (cambia la licencia). Las dependencias de Rust del instalador de escritorio tampoco están cubiertas.
- Antes de fusionar una PR de Dependabot que toque `prisma`, comprueba que `npx prisma migrate diff` no muestra diferencias.

