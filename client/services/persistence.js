import { SNAPSHOT_STORE, STORE } from "../lib/constants.js";

function normalizedConfig(config) {
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
    updatedAt: item.updatedAt || "",
    planType: item.planType || "unknown",
    quotaStatus: item.quotaStatus || "idle",
    quotaStatusCode: item.quotaStatusCode == null ? null : item.quotaStatusCode,
    quotaError: item.quotaError || "",
    requestStatusText: item.requestStatusText || "等待请求",
    quotaStateCode: item.quotaStateCode || "idle",
    quotaStateLabel: item.quotaStateLabel || "等待额度",
    chatQuota: item.chatQuota || null,
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

  return {
    baseUrl: raw.baseUrl || defaults.baseUrl || "http://127.0.0.1:8317",
    key: defaults.key || "",
    interval: Math.max(1, parseInt(raw.interval != null ? raw.interval : defaults.interval, 10) || 10),
    showFilename: raw.showFilename != null ? !!raw.showFilename : !!defaults.showFilename,
    autoRefresh: raw.autoRefresh != null ? !!raw.autoRefresh : !!defaults.autoRefresh,
    lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold)),
    quotaConcurrency: Math.max(1, Math.min(20, Number.isNaN(quotaConcurrency) ? 6 : quotaConcurrency)),
    quotaRequestIntervalSeconds: Math.max(0, Math.min(30, Number.isNaN(quotaRequestIntervalSeconds) ? 0 : quotaRequestIntervalSeconds))
  };
}

export function writeSettings(settings) {
  var lowQuotaThreshold = parseInt(settings.lowQuotaThreshold, 10);
  var quotaConcurrency = parseInt(settings.quotaConcurrency, 10);
  var quotaRequestIntervalSeconds = parseFloat(settings.quotaRequestIntervalSeconds);
  try {
    localStorage.setItem(STORE, JSON.stringify({
      baseUrl: String(settings.baseUrl || "").trim().replace(/\/+$/, ""),
      interval: Math.max(1, parseInt(settings.interval, 10) || 10),
      showFilename: !!settings.showFilename,
      autoRefresh: !!settings.autoRefresh,
      lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold)),
      quotaConcurrency: Math.max(1, Math.min(20, Number.isNaN(quotaConcurrency) ? 6 : quotaConcurrency)),
      quotaRequestIntervalSeconds: Math.max(0, Math.min(30, Number.isNaN(quotaRequestIntervalSeconds) ? 0 : quotaRequestIntervalSeconds))
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
