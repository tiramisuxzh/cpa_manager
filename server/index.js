const fs = require("fs");
const path = require("path");
const express = require("express");
const { readConfig, clientConfig, serverConfig, writeManagementConfig, writeIntegrationConfig } = require("./config");
const { readAuthFileDetail, refreshAuthCredential, reviveAuthFile } = require("./revive");

const APP_CONFIG = readConfig();
const SERVER_OPTIONS = serverConfig(APP_CONFIG);
const HOST = String(process.env.HOST || SERVER_OPTIONS.host || "127.0.0.1");
const PORT = Number(process.env.PORT || SERVER_OPTIONS.port || 8090);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const app = express();

app.disable("x-powered-by");
app.use(express.json());

function isLoopbackAddress(value) {
  const input = String(value || "").trim().toLowerCase();

  if (!input) {
    return false;
  }

  return input === "127.0.0.1"
    || input === "::1"
    || input === "::ffff:127.0.0.1"
    || input === "localhost";
}

function getRequestHost(req) {
  return String(req.headers.host || "").trim().toLowerCase();
}

function isAllowedOrigin(origin, req) {
  const originText = String(origin || "").trim();
  const allowedOrigins = Array.isArray(SERVER_OPTIONS.allowedOrigins)
    ? SERVER_OPTIONS.allowedOrigins.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!originText) {
    return true;
  }

  if (allowedOrigins.indexOf(originText) !== -1) {
    return true;
  }

  try {
    const parsed = new URL(originText);
    const normalizedOrigin = parsed.origin.toLowerCase();
    const requestHost = getRequestHost(req);

    if (requestHost && (
      normalizedOrigin === ("http://" + requestHost)
      || normalizedOrigin === ("https://" + requestHost)
    )) {
      return true;
    }

    return isLoopbackAddress(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function isTrustedRequest(req) {
  if (SERVER_OPTIONS.allowRemoteAccess) {
    return isAllowedOrigin(req.headers.origin || req.headers.referer || "", req);
  }

  return isLoopbackAddress(req.socket && req.socket.remoteAddress)
    && isAllowedOrigin(req.headers.origin || req.headers.referer || "", req);
}

function requireTrustedRequest(req, res, next) {
  if (!isTrustedRequest(req)) {
    res.status(403).json({ error: "当前服务仅允许受信任的本地请求访问" });
    return;
  }
  next();
}

function sendConsoleApp(res) {
  const entry = path.join(DIST_DIR, "index.html");
  if (!fs.existsSync(entry)) {
    res.status(503).send("前端产物不存在，请先执行 npm run build。");
    return;
  }
  res.sendFile(entry);
}

app.use(express.static(DIST_DIR, { index: false }));

app.get(["/", "/management.html"], (req, res) => {
  sendConsoleApp(res);
});

app.get("/api/app-config", requireTrustedRequest, (req, res) => {
  res.json(clientConfig(readConfig()));
});

app.patch("/api/app-config", requireTrustedRequest, (req, res) => {
  const input = req.body && req.body.management;

  // 前端只允许回写 management 默认配置，且请求体必须是对象，避免空值或错误结构直接覆盖配置文件。
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ error: "management 配置格式不正确" });
    return;
  }

  try {
    const updated = writeManagementConfig(input);
    res.json(clientConfig(updated));
  } catch (error) {
    res.status(500).json({ error: error && error.message ? error.message : "保存默认配置失败" });
  }
});

app.patch("/api/integrations-config", requireTrustedRequest, (req, res) => {
  const input = req.body && req.body.integrations;

  // 集成配置单独保存，要求请求体显式携带 integrations 对象，避免错误结构写脏配置文件。
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ error: "integrations 配置格式不正确" });
    return;
  }

  try {
    const updated = writeIntegrationConfig(input);
    res.json(clientConfig(updated));
  } catch (error) {
    res.status(500).json({ error: error && error.message ? error.message : "保存集成配置失败" });
  }
});

app.post("/api/auth-file-detail", requireTrustedRequest, async (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : null;
  const management = input && input.management;
  const item = input && input.item;

  if (!input || !management || typeof management !== "object" || Array.isArray(management) || !item || typeof item !== "object" || Array.isArray(item)) {
    res.status(400).json({ error: "凭证信息请求格式不正确" });
    return;
  }
  if (!String(management.baseUrl || "").trim() || !String(management.key || "").trim() || !String(item.name || "").trim()) {
    res.status(400).json({ error: "缺少管理地址、Management Key 或文件名" });
    return;
  }

  try {
    res.json(await readAuthFileDetail(input));
  } catch (error) {
    console.error("[auth-file-detail] failed:", error);
    res.status(500).json({ error: error && error.message ? error.message : "读取凭证信息失败" });
  }
});

app.post("/api/revive-auth-file", requireTrustedRequest, async (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : null;
  const management = input && input.management;
  const item = input && input.item;

  // 复活接口只接受显式的管理配置和文件信息，避免浏览器误传空结构时把异常吞成“静默成功”。
  if (!input || !management || typeof management !== "object" || Array.isArray(management) || !item || typeof item !== "object" || Array.isArray(item)) {
    res.status(400).json({ error: "复活请求格式不正确" });
    return;
  }
  if (!String(management.baseUrl || "").trim() || !String(management.key || "").trim() || !String(item.name || "").trim()) {
    res.status(400).json({ error: "缺少管理地址、Management Key 或文件名" });
    return;
  }

  try {
    res.json(await reviveAuthFile(input));
  } catch (error) {
    console.error("[revive-auth-file] failed:", error);
    res.status(500).json({ error: error && error.message ? error.message : "尝试复活失败" });
  }
});

app.post("/api/refresh-auth-file", requireTrustedRequest, async (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : null;
  const management = input && input.management;
  const item = input && input.item;

  // 批量凭证保活和复活共用同一份参数校验，确保开发态与生产态都只接受显式的管理配置和文件信息。
  if (!input || !management || typeof management !== "object" || Array.isArray(management) || !item || typeof item !== "object" || Array.isArray(item)) {
    res.status(400).json({ error: "凭证刷新请求格式不正确" });
    return;
  }
  if (!String(management.baseUrl || "").trim() || !String(management.key || "").trim() || !String(item.name || "").trim()) {
    res.status(400).json({ error: "缺少管理地址、Management Key 或文件名" });
    return;
  }

  try {
    res.json(await refreshAuthCredential(input));
  } catch (error) {
    console.error("[refresh-auth-file] failed:", error);
    res.status(500).json({ error: error && error.message ? error.message : "刷新凭证失败" });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
