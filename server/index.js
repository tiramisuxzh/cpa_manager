const fs = require("fs");
const path = require("path");
const express = require("express");
const { readConfig, clientConfig, serverConfig, writeManagementConfig } = require("./config");

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

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
