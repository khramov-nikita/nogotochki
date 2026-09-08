import http from "node:http";
import { defineConfig } from "vite";

function isAdminHtmlPath(url) {
  const path = String(url || "").split("?")[0];
  return /^\/admin(?:\/(?:services|masters))?\/?$/.test(path);
}

function proxyAdminToApi(req, res, next) {
  const url = req.url || "";
  if (!isAdminHtmlPath(url)) {
    next();
    return;
  }

  const headers = { ...req.headers, host: "127.0.0.1:3000" };
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: 3000,
      path: url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    res.statusCode = 502;
    res.end("Admin server unavailable");
  });
  req.pipe(proxyReq);
}

export default defineConfig({
  appType: "mpa",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    {
      name: "proxy-admin-html",
      configureServer(server) {
        server.middlewares.use(proxyAdminToApi);
      },
    },
  ],
});
