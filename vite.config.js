import { createRequire } from "node:module";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const require = createRequire(import.meta.url);
const { readConfig, clientConfig, writeManagementConfig, writeIntegrationConfig } = require("./server/config");

function readRequestBody(req) {
  return new Promise(function (resolve, reject) {
    let body = "";

    req.on("data", function (chunk) {
      body += chunk;
    });
    req.on("end", function () {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function localAppConfigPlugin() {
  return {
    name: "local-app-config",
    configureServer(server) {
      // 开发模式下直接由 Vite 回应本地配置，保证页面行为和生产入口保持一致。
      server.middlewares.use("/api/app-config", async function (req, res, next) {
        if (req.method !== "GET" && req.method !== "PATCH") {
          next();
          return;
        }

        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(clientConfig(readConfig())));
          return;
        }

        try {
          const body = await readRequestBody(req);
          const input = body && body.management;

          // 开发环境同样只允许回写 management 默认配置，避免 Vite 与正式服务的行为不一致。
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "management 配置格式不正确" }));
            return;
          }

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(clientConfig(writeManagementConfig(input))));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error && error.message ? error.message : "保存默认配置失败" }));
        }
      });

      // 集成配置在开发模式下也需要单独保存入口，否则前端会因为接口缺失而提示保存失败。
      server.middlewares.use("/api/integrations-config", async function (req, res, next) {
        if (req.method !== "PATCH") {
          next();
          return;
        }

        try {
          const body = await readRequestBody(req);
          const input = body && body.integrations;

          if (!input || typeof input !== "object" || Array.isArray(input)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "integrations 配置格式不正确" }));
            return;
          }

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(clientConfig(writeIntegrationConfig(input))));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error && error.message ? error.message : "保存集成配置失败" }));
        }
      });
    }
  };
}

// Vite 负责把新的 Vue 管理台构建到 dist，服务端只需要静态托管最终产物。
export default defineConfig({
  plugins: [vue(), localAppConfigPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
