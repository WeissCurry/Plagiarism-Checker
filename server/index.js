import express from "express";
import cluster from "cluster";
import os from "os";
import cors from "cors"; // 1. IMPORT CORS
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";

const isDev = process.env.NODE_ENV === "development";

// LOGIKA CLUSTER
if (cluster.isPrimary && !isDev) {
  const numCPUs = os.cpus().length;
  log(`Primary process ${process.pid} is running`);
  log(`Detected ${numCPUs} CPUs. Forking workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });

} else {
  // --- WORKER / DEV SERVER ---
  const app = express();

  // 2. KONFIGURASI CORS (PENTING BUAT JUDOL)
  // Kita izinkan domain Netlify JUDOL dan Localhost (buat testing)
  app.use(cors({
    origin: [
      "https://judol.netlify.app",  // Domain Production JUDOL
      "http://localhost:5173",      // Vite default port (jaga-jaga)
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  }));

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }

        const workerInfo = cluster.isWorker ? `[Worker ${cluster.worker.id}]` : "[Dev]";
        log(`${workerInfo} ${logLine}`);
      }
    });

    next();
  });

  (async () => {
    const server = registerRoutes(app);

    app.use((err, _req, res, _next) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("Error:", err);
      res.status(status).json({ message });
    });

    if (isDev) {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    const PORT = process.env.PORT || 5005;
    
    server.listen(PORT, "0.0.0.0", () => {
      const mode = cluster.isWorker ? `Worker ${cluster.worker.id}` : "Development Server";
      log(`${mode} running on port http://localhost:${PORT}`);
    });
  })();
}