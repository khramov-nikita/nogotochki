import express from "express";
import { errorHandler, notFoundHandler } from "./errors.js";
import { getConfig } from "./config.js";
import { corsMiddleware } from "./middleware/cors.js";
import { optionalAuth } from "./middleware/auth.js";
import adminRouter from "./routes/admin.js";
import { adminPagesHandler } from "./routes/admin-pages.js";
import appointmentsRouter from "./routes/appointments.js";
import authRouter from "./routes/auth.js";
import catalogRouter from "./routes/catalog.js";
import holdsRouter from "./routes/holds.js";
import notificationsRouter from "./routes/notifications.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", getConfig().trustProxy);
  app.use(corsMiddleware);
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      res.set("Cache-Control", "no-store");
    }
    next();
  });
  app.use(optionalAuth);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api", catalogRouter);
  app.use("/api/holds", holdsRouter);
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/admin", adminRouter);

  app.get(
    ["/admin", "/admin/", "/admin/services", "/admin/services/", "/admin/masters", "/admin/masters/"],
    adminPagesHandler,
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
