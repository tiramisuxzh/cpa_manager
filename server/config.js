const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(__dirname, "..", "config", "app-config.json");
const DEFAULT_CONFIG = {
  management: {
    baseUrl: "",
    key: "",
    interval: 10,
    showFilename: false,
    autoRefresh: false,
    lowQuotaThreshold: 20,
    quotaConcurrency: 6,
    quotaRequestIntervalSeconds: 0
  },
  remote: {
    host: "",
    port: 22,
    username: "",
    password: "",
    scriptPath: "",
    tokenDir: "",
    skipConfigPanel: true,
    autoStart: true,
    monitor: {
      enabled: false,
      intervalMinutes: 5,
      minUsableCount: 15,
      minAverageQuota: 50,
      recoveryBuffer: 10
    }
  },
  mail: {
    imapHost: "imap.qq.com",
    imapPort: 993,
    secure: true,
    qqAddress: "",
    authCode: "",
    senders: [],
    promptKeywords: []
  },
  server: {
    host: "127.0.0.1",
    port: 8090,
    allowRemoteAccess: false,
    allowedOrigins: []
  }
};

function normalizeConfig(config) {
  const input = config && typeof config === "object" ? config : {};
  const remoteInput = input.remote || {};

  return {
    management: Object.assign({}, DEFAULT_CONFIG.management, input.management || {}),
    remote: Object.assign({}, DEFAULT_CONFIG.remote, remoteInput, {
      monitor: Object.assign({}, DEFAULT_CONFIG.remote.monitor, remoteInput.monitor || {})
    }),
    mail: Object.assign({}, DEFAULT_CONFIG.mail, input.mail || {}),
    server: Object.assign({}, DEFAULT_CONFIG.server, input.server || {})
  };
}

function ensureConfigDir() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

function writeConfig(config) {
  const normalized = normalizeConfig(config);

  // 统一通过规范化后的对象回写配置文件，避免不同入口写出字段不完整或结构漂移的内容。
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

function writeManagementConfig(management) {
  const current = readConfig();
  const next = Object.assign({}, current, {
    management: Object.assign({}, current.management, management || {})
  });

  // 设置页只允许保存 management 默认配置，避免误伤 remote、mail、server 这类低频配置块。
  return writeConfig(next);
}

function readConfig() {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  } catch (_) {
    return normalizeConfig({});
  }
}

function clientConfig(config) {
  const normalized = normalizeConfig(config);
  return {
    management: normalized.management,
    remote: normalized.remote,
    mail: normalized.mail
  };
}

function serverConfig(config) {
  return normalizeConfig(config).server;
}

module.exports = {
  readConfig,
  writeConfig,
  writeManagementConfig,
  clientConfig,
  serverConfig,
  CONFIG_PATH
};
