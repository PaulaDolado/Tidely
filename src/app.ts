import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/environment";
import { swaggerSpec } from "./config/swagger";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { logger } from "./utils/logger";

export function createApp(): Application {
  const app = express();

  // Necesario para que express-rate-limit identifique la IP real del cliente
  // detrás de un proxy inverso (Railway/Render), en vez de la IP del proxy.
  if (env.isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.use(cors({ origin: env.cors.origin }));
  // Las páginas de la libreta de un proyecto pueden llevar imágenes embebidas como data URL
  // en el HTML, mucho más pesadas que el resto de payloads de la API — de ahí el límite propio
  // para ese prefijo. body-parser no vuelve a leer el stream si el body ya viene parseado, así
  // que el límite general de abajo no aplica dos veces sobre estas rutas. Las páginas
  // personalizadas (/custom-pages) comparten el mismo problema con la plantilla "nota" (HTML
  // con imágenes), "kanban" (imagen embebida por tarjeta) y "galeria" (imagen por entrada, ver
  // CustomPagePage en el dashboard). /planner también: cada tarea del tablero admite ahora su
  // propia imagen (ver Task.image). /sync (sincronización offline del móvil) reenvía la fila
  // ENTERA de cada entidad tocada, así que hereda el mismo problema en cuanto una tarea, evento,
  // página o tarjeta de kanban con imagen pasa por ahí — con un límite mayor porque un lote puede
  // traer varias entidades a la vez, no solo una. /agenda necesita su propio límite por la
  // importación de .ics (ver importIcsSchema, que ya admite hasta 2MB de contenido).
  app.use("/projects", express.json({ limit: "10mb" }));
  app.use("/custom-pages", express.json({ limit: "10mb" }));
  app.use("/planner", express.json({ limit: "10mb" }));
  app.use("/sync", express.json({ limit: "25mb" }));
  app.use("/agenda", express.json({ limit: "5mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(
    morgan(env.isProduction ? "combined" : "dev", {
      stream: { write: (message: string) => logger.info(message.trim()) },
      skip: () => env.isTest,
    })
  );

  const limiter = rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
  });
  app.use(limiter);

  // Límite más estricto en auth para dificultar fuerza bruta sobre login/register.
  const authLimiter = rateLimit({
    windowMs: env.rateLimit.authWindowMs,
    max: env.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    message: { error: "Demasiados intentos, inténtalo de nuevo más tarde" },
  });
  app.use("/auth", authLimiter);

  app.get("/health", (_req, res) => {
    res.json({ status: "OK" });
  });

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
