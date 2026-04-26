import { createRequire } from "node:module";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const require = createRequire(import.meta.url);
const { readConfig, clientConfig, writeManagementConfig, writeIntegrationConfig } = require("./server/config");
const { readAuthFileDetail, refreshAuthCredential, reviveAuthFile } = require("./server/revive");

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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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
          sendJson(res, 200, clientConfig(readConfig()));
          return;
        }

        try {
          const body = await readRequestBody(req);
          const input = body && body.management;

          // 开发环境同样只允许回写 management 默认配置，避免 Vite 与正式服务的行为不一致。
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            sendJson(res, 400, { error: "management 配置格式不正确" });
            return;
          }

          sendJson(res, 200, clientConfig(writeManagementConfig(input)));
        } catch (error) {
          sendJson(res, 500, { error: error && error.message ? error.message : "保存默认配置失败" });
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
            sendJson(res, 400, { error: "integrations 配置格式不正确" });
            return;
          }

          sendJson(res, 200, clientConfig(writeIntegrationConfig(input)));
        } catch (error) {
          sendJson(res, 500, { error: error && error.message ? error.message : "保存集成配置失败" });
        }
      });

      server.middlewares.use("/api/auth-file-detail", async function (req, res, next) {
        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const body = await readRequestBody(req);
          const management = body && body.management;
          const item = body && body.item;

          if (!body || !management || typeof management !== "object" || Array.isArray(management) || !item || typeof item !== "object" || Array.isArray(item)) {
            sendJson(res, 400, { error: "凭证信息请求格式不正确" });
            return;
          }
          if (!String(management.baseUrl || "").trim() || !String(management.key || "").trim() || !String(item.name || "").trim()) {
            sendJson(res, 400, { error: "缺少管理地址、Management Key 或文件名" });
            return;
          }

          sendJson(res, 200, await readAuthFileDetail(body));
        } catch (error) {
          sendJson(res, 500, { error: error && error.message ? error.message : "读取凭证信息失败" });
        }
      });

      // 开发模式默认只起 Vite，不起本地 Express，因此复活接口也要在这里补齐，避免页面在 5173 下直接打到 404。
      server.middlewares.use("/api/revive-auth-file", async function (req, res, next) {
        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const body = await readRequestBody(req);
          const management = body && body.management;
          const item = body && body.item;

          if (!body || !management || typeof management !== "object" || Array.isArray(management) || !item || typeof item !== "object" || Array.isArray(item)) {
            sendJson(res, 400, { error: "复活请求格式不正确" });
            return;
          }
          if (!String(management.baseUrl || "").trim() || !String(management.key || "").trim() || !String(item.name || "").trim()) {
            sendJson(res, 400, { error: "缺少管理地址、Management Key 或文件名" });
            return;
          }

          sendJson(res, 200, await reviveAuthFile(body));
        } catch (error) {
          sendJson(res, 500, { error: error && error.message ? error.message : "尝试复活失败" });
        }
      });

      // 开发模式下的凭证保活与正式服务保持同一路径，避免 file/disabled 池里的批量刷新动作在 5173 下直接失效。
      server.middlewares.use("/api/refresh-auth-file", async function (req, res, next) {
        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const body = await readRequestBody(req);
          const management = body && body.management;
          const item = body && body.item;

          if (!body || !management || typeof management !== "object" || Array.isArray(management) || !item || typeof item !== "object" || Array.isArray(item)) {
            sendJson(res, 400, { error: "凭证刷新请求格式不正确" });
            return;
          }
          if (!String(management.baseUrl || "").trim() || !String(management.key || "").trim() || !String(item.name || "").trim()) {
            sendJson(res, 400, { error: "缺少管理地址、Management Key 或文件名" });
            return;
          }

          sendJson(res, 200, await refreshAuthCredential(body));
        } catch (error) {
          sendJson(res, 500, { error: error && error.message ? error.message : "刷新凭证失败" });
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
