# Deployment

Dos rutas soportadas: **Railway** (recomendada, más simple) y **Render** (usa el `render.yaml` incluido). Ambas construyen la API desde el [Dockerfile](Dockerfile) de este repo.

> Ninguna de las dos requiere tarjeta de crédito en su plan gratuito/hobby actual (verifica al momento de desplegar, las políticas cambian). **Yo no puedo crear la cuenta ni desplegar por ti** — esto son los pasos para que lo hagas tú.

## Opción A: Railway

1. Crea un repo en GitHub y sube este proyecto (`git init && git add . && git commit -m "Initial commit"` dentro de `life-organizer-api/`, luego `git push`).
2. En [railway.app](https://railway.app), **New Project → Deploy from GitHub repo** y selecciona el repo.
3. **Add a service → Database → PostgreSQL** (Railway te da `DATABASE_URL` automáticamente vía variable de referencia).
4. En el servicio de la API, pestaña **Variables**, añade:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}   # referencia automática al servicio de Postgres
   DIRECT_URL=${{Postgres.DATABASE_URL}}     # misma BD — el Postgres de Railway no tiene pooler delante
   JWT_SECRET=<genera un secreto largo aleatorio>
   JWT_REFRESH_SECRET=<otro secreto distinto>
   NODE_ENV=production
   CORS_ORIGIN=<dominio del dashboard, o * mientras pruebas>
   ```
   `DIRECT_URL` hace falta porque el `Dockerfile` corre `prisma migrate deploy` en cada arranque
   del contenedor, y la CLI de Prisma usa esa variable para migrar (ver `prisma/schema.prisma`) —
   sin ella el contenedor no arranca. Si en vez del Postgres de Railway conectas uno externo con
   pooler (Supabase), aquí SÍ deben ser distintas — ver [Usar Supabase como Postgres](#usar-supabase-como-postgres) más abajo.
5. **Settings → Deploy → Custom Start Command** no hace falta tocarlo (usa el `CMD` del Dockerfile). Si quieres correr las migraciones como parte del deploy, añade en **Settings → Deploy Triggers / Pre-Deploy Command**:
   ```
   npx prisma migrate deploy
   ```
   Si tu plan no soporta pre-deploy command, hazlo manualmente una vez desde la pestaña **Shell** del servicio (o desde tu máquina, apuntando `DATABASE_URL` a la BD de producción):
   ```bash
   npx prisma migrate deploy
   ```
6. Railway asigna una URL pública automáticamente (Settings → Networking → Generate Domain). Prueba `https://<tu-app>.up.railway.app/health`.

## Opción B: Render (con `render.yaml`)

1. Sube el repo a GitHub (igual que en el paso 1 de Railway).
2. En [render.com](https://render.com), **New → Blueprint**, apunta al repo — Render detecta [`render.yaml`](render.yaml) y crea automáticamente el servicio web + la base de datos Postgres, con `DATABASE_URL`/`DIRECT_URL` conectadas (a la misma BD — el Postgres de Render no tiene pooler delante) y `JWT_SECRET`/`JWT_REFRESH_SECRET` generados.
3. Antes del primer deploy exitoso necesitas aplicar las migraciones. Opciones:
   - Si tu plan soporta **Pre-Deploy Command** (Settings del servicio web): `npx prisma migrate deploy`.
   - Si no, entra a **Shell** del servicio ya desplegado y corre `npx prisma migrate deploy` manualmente.
4. Revisa `CORS_ORIGIN` en las variables de entorno del servicio y cámbialo al dominio real del dashboard cuando lo despliegues.
5. Render asigna una URL tipo `https://life-organizer-api.onrender.com`. Prueba `/health` y `/api-docs`.

## Usar Supabase como Postgres

Supabase es Postgres administrado real, así que Prisma se conecta sin cambios de código — pero
Supabase **no sustituye a Railway/Render**: solo te da la base de datos, no ejecuta la API
(`src/`). El combo es: **Railway o Render para la API** (los pasos de arriba, tal cual) **+
Supabase solo como Postgres**, pegando sus connection strings en vez de usar el Postgres que
Railway/Render crean por defecto.

1. En tu proyecto de Supabase, **Project Settings → Database → Connection string**. Ahí verás
   dos, en pestañas distintas:
   - **Transaction pooler** (puerto `6543`, vía PgBouncer/Supavisor) — para `DATABASE_URL`.
     Añádele `?pgbouncer=true` al final: el modo transacción del pooler no soporta los
     "prepared statements" que Prisma usa por defecto, y ese parámetro se lo dice.
   - **Session pooler** o **Direct connection** (puerto `5432`) — para `DIRECT_URL`. Esta es la
     que usa `prisma migrate deploy` para migrar; el modo transacción de arriba puede romper los
     advisory locks que necesita migrar, así que esta va SIEMPRE directa, sin pooler.
2. En Railway/Render, sustituye las variables del paso 4 (Railway) o las que generó el Blueprint
   (Render) por estas dos:
   ```
   DATABASE_URL=postgresql://postgres.[ref]:[password]@[host]:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://postgres.[ref]:[password]@[host]:5432/postgres
   ```
   (En Render, si usaste el Blueprint, puedes borrar el bloque `databases:` de `render.yaml` — o
   simplemente dejarlo sin usar y sobreescribir `DATABASE_URL`/`DIRECT_URL` a mano en el
   dashboard del servicio; el de Supabase manda.)
3. El resto del flujo no cambia: migraciones, seed, `/health` — todo sigue igual, solo cambia
   dónde vive la base de datos.

## Después de desplegar

- **Swagger**: `https://<tu-url>/api-docs`
- **Health check**: `https://<tu-url>/health`
- **Seed de datos demo** (opcional, para tener una cuenta de prueba): corre apuntando `DATABASE_URL` a producción (o a cualquier otra máquina donde quieras la misma cuenta demo):
  ```bash
  DATABASE_URL="<url-de-destino>" npm run prisma:seed
  ```
  Crea o **reinicia por completo** `demo@lifeorganizer.dev` / `Password123` con TODO lo que hubiera
  en `prisma/fixtures/demoUser.json` — agenda, planificador (con sus propiedades personalizadas),
  páginas personalizadas, proyectos, objetivos, finanzas, horario, hábitos, notas y leyenda del
  calendario anual. Es idempotente (borra y recrea), así que correrlo varias veces no acumula
  datos duplicados.

  Ese fichero es un snapshot que se genera aparte, normalmente desde tu Postgres local, con:
  ```bash
  npm run prisma:export-demo
  ```
  Commitéalo (`git add prisma/fixtures/demoUser.json`) y en cualquier otra máquina que haga
  `git pull` + `npm run prisma:seed` la cuenta demo quedará igual que en la tuya — así es como
  "otro ordenador" o el móvil (que habla con el backend de esa otra máquina) terminan viendo los
  mismos datos. Ver el comentario de cabecera de `prisma/exportDemoUser.ts` para el detalle de qué
  se exporta y qué no (las credenciales de Google Calendar, entre otras cosas, nunca se copian).
- **CI**: cada push a `main`/`master` corre lint + typecheck + tests (con Postgres real en un contenedor) vía [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Ese workflow no despliega nada — solo verifica que el código esté sano antes de mergear. Si quieres deploy automático en cada push, tanto Railway como Render lo hacen solos en cuanto conectas el repo (no necesitas un paso extra en GitHub Actions para eso).

## Variables de entorno de producción (checklist)

| Variable | Obligatoria | Notas |
|---|---|---|
| `DATABASE_URL` | Sí | La da el proveedor (Postgres administrado). Con pooler (Supabase), la conexión POOLED |
| `DIRECT_URL` | Sí | La usa `prisma migrate deploy` en cada arranque (ver `Dockerfile`). Sin pooler, igual a `DATABASE_URL`; con pooler (Supabase), la conexión DIRECTA — ver [Usar Supabase como Postgres](#usar-supabase-como-postgres) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Sí | Deben ser distintos entre sí, largos y aleatorios. Nunca reutilices los de `.env.example` |
| `NODE_ENV=production` | Sí | Activa `trust proxy`, logs en JSON, oculta detalles de error 500 |
| `CORS_ORIGIN` | Recomendada | Dominio exacto del dashboard en vez de `*` una vez lo tengas desplegado |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `RATE_LIMIT_*` | No | Tienen defaults razonables en `src/config/environment.ts` |
