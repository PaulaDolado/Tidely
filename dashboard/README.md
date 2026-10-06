# Tidely — Dashboard demo

Dashboard en React + TypeScript + Vite que consume la [Tidely API](../README.md). Diseño adaptado de [difarmed/life-weaver-pro-23](https://github.com/difarmed/life-weaver-pro-23) ("Stoa OS", un prototipo generado con [Lovable](https://lovable.dev) con el mismo concepto — agenda/finanzas/proyectos/hobbies) — ver [Origen del diseño](#origen-del-diseño-y-qué-se-adaptó) más abajo para qué se copió tal cual y qué se adaptó a nuestra API real.

## Qué incluye

- Login / registro / logout (JWT guardado en `localStorage`), con detección automática de tu timezone al registrarte
- **Agenda**: tira de días de la semana + eventos del día seleccionado + alta de eventos (con recurrencia weekly/biweekly/monthly)
- **Metas**: tarjetas con barra de progreso, registro de avance, pestañas activas/completadas/vencidas/todas
- **Finanzas**: balance del mes, movimientos (alta/baja), metas de ahorro como grid de casillas (progreso calculado por la API, no guardado)
- **Proyectos**: cuaderno con tarjetas por proyecto, tareas como notas marcables, ciclo de estado
- **Páginas personalizadas** ("+ Nueva página"): crea todas las que quieras a partir de un modelo — nota en blanco, kanban, checklist, **planificación de viajes** (viajes con fechas, presupuesto e itinerario, más lugares guardados con favoritos y foto) y **galería** (collage de fotos y notas en columnas estilo pared de marcos, foto subida como data URL, diálogo ampliable a pantalla completa para escribir)
- Widget de notificaciones (recordatorios de eventos, alertas de metas en riesgo) y "próximo evento" en la barra lateral

## Setup

```bash
npm install
cp .env.example .env   # ajusta VITE_API_URL si tu API no corre en localhost:3000
npm run dev
```

Abre http://localhost:5173. Necesitas la API corriendo (`cd ../ && npm run dev`, con Postgres levantado) para poder iniciar sesión de verdad — sin la API, cada pantalla muestra un error claro ("No se pudo conectar con la API...") en vez de fallar en silencio o quedarse cargando para siempre. Lo verifiqué manualmente en el navegador con Postgres apagado: las 5 pestañas renderizan bien y muestran el error, ninguna rompe.

Para probar rápido, corre el seed de la API (`npm run prisma:seed` en la carpeta raíz) y entra con `demo@lifeorganizer.dev` / `Password123`.

## Build

```bash
npm run build    # tsc --noEmit + vite build -> dist/
npm run preview  # sirve dist/ localmente
```

`dist/` es estático — se puede desplegar en Vercel, Netlify, Cloudflare Pages o como sitio estático en el mismo Render/Railway. Recuerda configurar `VITE_API_URL` como variable de entorno de build apuntando a la URL de producción de la API, y actualizar `CORS_ORIGIN` en la API para que acepte el dominio del dashboard.

## Origen del diseño y qué se adaptó

El repo de referencia es un prototipo **cliente-only**: sin backend, sin auth, todo el estado vive en `localStorage` vía un `StoreProvider` con datos semilla. Comparte la idea de producto (agenda semanal/diaria, finanzas con metas de ahorro "por casillas", libreta de proyectos, hobbies) pero no tiene nada que conectar a una API real. Decisiones al adaptarlo:

- **Se adoptó**: la paleta de colores completa (oklch: `paper`/`sage`/`sand`/`charcoal`/`hobby`), tipografías (Outfit + Instrument Serif vía Google Fonts), y la estructura visual de cada página (tira de días, tarjetas "casilla" para metas de ahorro, cuaderno de proyectos con notas, sidebar con "próximo evento").
- **No se adoptó el stack**: el original usa TanStack Start (SSR) + Nitro + TanStack Router/Query + React 19 + Zod + react-hook-form. Es infraestructura pensada para desplegar en Cloudflare vía Lovable — de más para un dashboard personal que solo necesita ser un SPA estático. Este dashboard se quedó en Vite + React 18 + fetch simple (`api/client.ts` + `useFetch`), y solo se añadió **Tailwind CSS v4** (el original ya lo usaba) para poder reutilizar el sistema de diseño con fidelidad.
- **Tareas → Eventos**: el original tiene tareas con `recurrence: none|daily|weekly|monthly` sin persistencia real. Nuestra Agenda usa el modelo `Event` de la API, que soporta `weekly|biweekly|monthly` (sin `daily` ni `none` explícito — un evento simplemente no lleva `isRecurring`). El selector de recurrencia del formulario refleja lo que la API realmente soporta.
- **"Ahorro por casillas" → clic real, no un contador manual**: el original guarda `filled` como un número suelto en el store local. Aquí cada clic en una casilla llama `POST /finance/savings-goals/:id/contribute`, que crea una `Transaction` real (`income` si asignas, `expense` si retiras/corriges) en la categoría de la meta — el `currentAmount` sigue calculándose solo, sumando esas transacciones (ver [DATABASE.md](../DATABASE.md)). Al crear la meta defines `stepAmount` (cuánto vale cada casilla, ej. 100€); el nº de casillas es `targetAmount / stepAmount`. El comportamiento de clic es "rellenar hasta aquí" (estilo rating de estrellas): clicar la última casilla rellenada la vacía, para poder corregir un clic de más.
- **Metas de ahorro en su propia sección**: al poder haber varias metas a la vez, viven en un sub-apartado a todo lo ancho dentro de Finanzas (grid responsive), no apretadas en la barra lateral — la barra lateral se quedó solo con el resumen del mes (un único bloque, no una lista que crece).
- **Hobbies → Galería**: la página de Hobbies (tracking de sesiones/minutos por hobby, sin equivalente real en el repo original — estaba en el nav pero sin archivo de ruta) se sustituyó por completo por **Galería**: un collage de fotos y notas en columnas al estilo "pared de marcos", sin ningún tracking de tiempo. Empezó como su propia página fija con modelo propio (`GalleryItem`) y terminó como una plantilla más de "página personalizada" (`CustomPage.template = "galeria"`, junto a nota/kanban/etc.) — sus entradas viven en `CustomPage.content` (JSON), igual que las tarjetas del kanban, así que puedes crear tantas galerías como quieras. Ninguno de los dos (Hobbies ni Galería) tiene relación con el repo de referencia — se construyó desde cero siguiendo el mismo lenguaje visual.
- **Se añadió** una página de **Metas** (nuestro módulo `Goal`: objetivos semanales/mensuales con racha, riesgo y auto-renovación) que no tiene equivalente en el diseño original — sin ella, el dashboard perdía un módulo entero que la API ya expone.
- **Se añadió auth** (login/registro/perfil) y un **widget de notificaciones**, ninguno de los dos presentes en el original (que no tiene backend).

## Decisiones de diseño (generales)

- **Sin React Router**: con 5 secciones y sin necesidad de URLs profundas, un simple `useState<Tab>` en `DashboardPage` es más simple que añadir una dependencia de routing.
- **Sin librería de gráficos**: el original usa Recharts; aquí se mantuvo `MiniLineChart` (SVG puro, sin dependencias, con crosshair+tooltip al pasar el ratón) para la tendencia de 6 meses en Finanzas — evita añadir una librería solo para una línea de 6 puntos.
- **`useFetch`** ([src/hooks/useFetch.ts](src/hooks/useFetch.ts)) centraliza loading/error/reload para no repetir ese boilerplate en cada componente.
