import {
  AUTO_REFRESH_MODES,
  INTEGRATION_STORE,
  SNAPSHOT_STORE,
  STORE,
  TOKEN_REFRESH_DEFAULTS,
  TOKEN_REFRESH_LIMITS,
  normalizeAutoRefreshMode
} from "../lib/constants.js";

function normalizedConfig(config) {
  return config && typeof config === "object" ? config : {};
}

function normalizedIntegrations(config) {
  return config && typeof config === "object" ? config : {};
}

function snapshotItem(item) {
  return {
    key: item.key || "",
    name: item.name || "",
    email: item.email || "",
    authIndex: item.authIndex || "",
    accountId: item.accountId || "",
    provider: item.provider || "codex",
    accountType: item.accountType || "",
    status: item.status || "unknown",
    statusMessage: item.statusMessage || "",
    disabled: !!item.disabled,
    unavailable: !!item.unavailable,
    runtimeOnly: !!item.runtimeOnly,
    lastRefresh: item.lastRefresh || "",
    expired: item.expired || "",
    updatedAt: item.updatedAt || "",
    planType: item.planType || "unknown",
    quotaStatus: item.quotaStatus || "idle",
    quotaStatusCode: item.quotaStatusCode == null ? null : item.quotaStatusCode,
    quotaError: item.quotaError || "",
    requestStatusText: item.requestStatusText || "等待请求",
    quotaStateCode: item.quotaStateCode || "idle",
    quotaStateLabel: item.quotaStateLabel || "等待额度",
    chatQuota: item.chatQuota || null,
    chatQuotaSecondary: item.chatQuotaSecondary || null,
    codeQuota: item.codeQuota || null,
    rawQuotaMessage: item.rawQuotaMessage || "",
    usageSuccessCount: item.usageSuccessCount == null ? null : item.usageSuccessCount,
    usageFailureCount: item.usageFailureCount == null ? null : item.usageFailureCount,
    promoMessage: item.promoMessage || "",
    tone: item.tone || "good",
    health: item.health || "待获取",
    badReasonGroup: item.badReasonGroup || "",
    badReasonCode: item.badReasonCode || "",
    badReasonLabel: item.badReasonLabel || "",
    reason: item.reason || ""
  };
}

function safeRead(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch (_) {
    return {};
  }
}

// 统一把本地设置和服务端默认值揉成一个结构，避免 Vue 层散落各种回填逻辑。
export function readSettings(config) {
  var raw = safeRead(STORE);
  var defaults = normalizedConfig(config).management || {};
  var lowQuotaThreshold = parseInt(raw.lowQuotaThreshold != null ? raw.lowQuotaThreshold : defaults.lowQuotaThreshold, 10);
  var quotaConcurrency = parseInt(raw.quotaConcurrency != null ? raw.quotaConcurrency : defaults.quotaConcurrency, 10);
  var quotaRequestIntervalSeconds = parseFloat(raw.quotaRequestIntervalSeconds != null ? raw.quotaRequestIntervalSeconds : defaults.quotaRequestIntervalSeconds);
  var tokenRefreshConcurrency = parseInt(raw.tokenRefreshConcurrency != null ? raw.tokenRefreshConcurrency : defaults.tokenRefreshConcurrency, 10);
  var tokenRefreshIntervalSeconds = parseFloat(raw.tokenRefreshIntervalSeconds != null ? raw.tokenRefreshIntervalSeconds : defaults.tokenRefreshIntervalSeconds);
  var autoRefreshMode = raw.autoRefreshMode != null ? raw.autoRefreshMode : defaults.autoRefreshMode;

  return {
    baseUrl: raw.baseUrl || defaults.baseUrl || "http://127.0.0.1:8317",
    key: defaults.key || "",
    reviveProxyUrl: String(raw.reviveProxyUrl != null ? raw.reviveProxyUrl : defaults.reviveProxyUrl || "").trim(),
    interval: Math.max(1, parseInt(raw.interval != null ? raw.interval : defaults.interval, 10) || 10),
    showFilename: raw.showFilename != null ? !!raw.showFilename : !!defaults.showFilename,
    autoRefresh: raw.autoRefresh != null ? !!raw.autoRefresh : !!defaults.autoRefresh,
    autoRefreshMode: normalizeAutoRefreshMode(autoRefreshMode || AUTO_REFRESH_MODES.FILES),
    lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold)),
    quotaConcurrency: Math.max(1, Math.min(20, Number.isNaN(quotaConcurrency) ? 6 : quotaConcurrency)),
    quotaRequestIntervalSeconds: Math.max(0, Math.min(30, Number.isNaN(quotaRequestIntervalSeconds) ? 0 : quotaRequestIntervalSeconds)),
    tokenRefreshConcurrency: Math.max(TOKEN_REFRESH_LIMITS.concurrency.min, Math.min(TOKEN_REFRESH_LIMITS.concurrency.max, Number.isNaN(tokenRefreshConcurrency) ? TOKEN_REFRESH_DEFAULTS.concurrency : tokenRefreshConcurrency)),
    tokenRefreshIntervalSeconds: Math.max(TOKEN_REFRESH_LIMITS.intervalSeconds.min, Math.min(TOKEN_REFRESH_LIMITS.intervalSeconds.max, Number.isNaN(tokenRefreshIntervalSeconds) ? TOKEN_REFRESH_DEFAULTS.intervalSeconds : tokenRefreshIntervalSeconds))
  };
}

export function writeSettings(settings) {
  var lowQuotaThreshold = parseInt(settings.lowQuotaThreshold, 10);
  var quotaConcurrency = parseInt(settings.quotaConcurrency, 10);
  var quotaRequestIntervalSeconds = parseFloat(settings.quotaRequestIntervalSeconds);
  var tokenRefreshConcurrency = parseInt(settings.tokenRefreshConcurrency, 10);
  var tokenRefreshIntervalSeconds = parseFloat(settings.tokenRefreshIntervalSeconds);
  try {
    localStorage.setItem(STORE, JSON.stringify({
      baseUrl: String(settings.baseUrl || "").trim().replace(/\/+$/, ""),
      reviveProxyUrl: String(settings.reviveProxyUrl || "").trim(),
      interval: Math.max(1, parseInt(settings.interval, 10) || 10),
      showFilename: !!settings.showFilename,
      autoRefresh: !!settings.autoRefresh,
      autoRefreshMode: normalizeAutoRefreshMode(settings.autoRefreshMode || AUTO_REFRESH_MODES.FILES),
      lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold)),
      quotaConcurrency: Math.max(1, Math.min(20, Number.isNaN(quotaConcurrency) ? 6 : quotaConcurrency)),
      quotaRequestIntervalSeconds: Math.max(0, Math.min(30, Number.isNaN(quotaRequestIntervalSeconds) ? 0 : quotaRequestIntervalSeconds)),
      tokenRefreshConcurrency: Math.max(TOKEN_REFRESH_LIMITS.concurrency.min, Math.min(TOKEN_REFRESH_LIMITS.concurrency.max, Number.isNaN(tokenRefreshConcurrency) ? TOKEN_REFRESH_DEFAULTS.concurrency : tokenRefreshConcurrency)),
      tokenRefreshIntervalSeconds: Math.max(TOKEN_REFRESH_LIMITS.intervalSeconds.min, Math.min(TOKEN_REFRESH_LIMITS.intervalSeconds.max, Number.isNaN(tokenRefreshIntervalSeconds) ? TOKEN_REFRESH_DEFAULTS.intervalSeconds : tokenRefreshIntervalSeconds))
    }));
  } catch (_) {}
}

// 集成配置使用独立的本地存储 key，避免保存管理地址时把外部集成地址一起覆盖。
export function readIntegrationSettings(config) {
  var raw = safeRead(INTEGRATION_STORE);
  var defaults = normalizedIntegrations(config).integrations || {};
  var wenfxlOpenai = defaults.wenfxlOpenai || {};

  return {
    wenfxlOpenaiUrl: String(raw.wenfxlOpenaiUrl != null ? raw.wenfxlOpenaiUrl : wenfxlOpenai.url || "").trim()
  };
}

export function writeIntegrationSettings(settings) {
  try {
    localStorage.setItem(INTEGRATION_STORE, JSON.stringify({
      wenfxlOpenaiUrl: String(settings.wenfxlOpenaiUrl || "").trim()
    }));
  } catch (_) {}
}

export function saveSnapshot(settings, state) {
  if (!settings || !settings.baseUrl) {
    return;
  }
  try {
    localStorage.setItem(SNAPSHOT_STORE, JSON.stringify({
      baseUrl: settings.baseUrl,
      savedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      progress: {
        done: state && state.progress ? (state.progress.done || 0) : 0,
        total: state && state.progress ? (state.progress.total || 0) : 0
      },
      items: Array.isArray(state && state.items) ? state.items.map(snapshotItem) : []
    }));
  } catch (_) {}
}

export function readSnapshot(baseUrl) {
  var raw = safeRead(SNAPSHOT_STORE);
  if (!raw || !Array.isArray(raw.items) || !raw.items.length) {
    return null;
  }
  if (baseUrl && raw.baseUrl && raw.baseUrl !== baseUrl) {
    return null;
  }
  return {
    baseUrl: raw.baseUrl || "",
    savedAt: raw.savedAt || "",
    progress: raw.progress || { done: raw.items.length, total: raw.items.length },
    items: raw.items
  };
}
