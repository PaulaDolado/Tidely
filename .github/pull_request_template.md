## Qué cambia

<!-- Una o dos frases: qué hace este cambio y por qué. -->

## Cómo se ha probado

<!-- Tests, pasos en el navegador o en el móvil. Si algo NO se ha probado, dilo aquí. -->

## Antes de fusionar

- [ ] El CI está en verde (`test`, `build`, `build-dashboard` y `mobile`).
- [ ] Si añade una **tabla** nueva: su migración incluye `ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;` (el test `rls.test.ts` lo exige).
- [ ] Si toca la **base de datos**: hay migración y `prisma migrate diff` no muestra diferencias con `schema.prisma`.
- [ ] Si toca el **móvil** con módulos nativos o configuración (`app.json`, `package.json`): hace falta un APK nuevo (anótalo).
- [ ] Si cambia textos o apartados visibles: web y móvil dicen lo mismo.
