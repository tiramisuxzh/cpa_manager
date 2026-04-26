import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { createApi } from "../lib/api.js";
import {
  baseItem,
  enrichError,
  enrichItem,
  reclassifyItem
} from "../lib/auth-file-state.js";
import { sortItems } from "../lib/utils.js";
import {
  AUTO_REFRESH_MODES,
  TOKEN_REFRESH_DEFAULTS,
  TOKEN_REFRESH_LIMITS,
  normalizeAutoRefreshMode
} from "../lib/constants.js";
import {
  readSettings,
  readIntegrationSettings,
  readSnapshot,
  saveSnapshot,
  writeIntegrationSettings,
  writeSettings
} from "../services/persistence.js";
import { useConsoleConfirm } from "./useConsoleConfirm.js";
import { useConsoleFeedback } from "./useConsoleFeedback.js";
import { useConsoleFileActions } from "./useConsoleFileActions.js";

function normalizedSettings(settings) {
  var lowQuotaThreshold = parseInt(settings.lowQuotaThreshold, 10);
  var quotaConcurrency = parseInt(settings.quotaConcurrency, 10);
  var quotaRequestIntervalSeconds = parseFloat(settings.quotaRequestIntervalSeconds);
  var tokenRefreshConcurrency = parseInt(settings.tokenRefreshConcurrency, 10);
  var tokenRefreshIntervalSeconds = parseFloat(settings.tokenRefreshIntervalSeconds);

  return {
    baseUrl: String(settings.baseUrl || "").trim().replace(/\/+$/, ""),
    key: String(settings.key || "").trim(),
    reviveProxyUrl: String(settings.reviveProxyUrl || "").trim(),
    interval: Math.max(1, parseInt(settings.interval, 10) || 10),
    showFilename: !!settings.showFilename,
    autoRefresh: !!settings.autoRefresh,
    autoRefreshMode: normalizeAutoRefreshMode(settings.autoRefreshMode),
    lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold)),
    quotaConcurrency: Math.max(1, Math.min(20, Number.isNaN(quotaConcurrency) ? 6 : quotaConcurrency)),
    quotaRequestIntervalSeconds: Math.max(0, Math.min(30, Number.isNaN(quotaRequestIntervalSeconds) ? 0 : quotaRequestIntervalSeconds)),
    tokenRefreshConcurrency: Math.max(TOKEN_REFRESH_LIMITS.concurrency.min, Math.min(TOKEN_REFRESH_LIMITS.concurrency.max, Number.isNaN(tokenRefreshConcurrency) ? TOKEN_REFRESH_DEFAULTS.concurrency : tokenRefreshConcurrency)),
    tokenRefreshIntervalSeconds: Math.max(TOKEN_REFRESH_LIMITS.intervalSeconds.min, Math.min(TOKEN_REFRESH_LIMITS.intervalSeconds.max, Number.isNaN(tokenRefreshIntervalSeconds) ? TOKEN_REFRESH_DEFAULTS.intervalSeconds : tokenRefreshIntervalSeconds))
  };
}

function normalizedIntegrationSettings(settings) {
  return {
    wenfxlOpenaiUrl: String(settings.wenfxlOpenaiUrl || "").trim()
  };
}

function autoRefreshModeSummary(mode) {
  if (mode === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
    return "同步文件列表、补拉凭证信息并刷新额度";
  }
  if (mode === AUTO_REFRESH_MODES.FILES_AND_CREDENTIALS) {
    return "同步文件列表并补拉凭证信息";
  }
  if (mode === AUTO_REFRESH_MODES.CREDENTIALS_AND_QUOTAS) {
    return "补拉凭证信息并刷新额度";
  }
  if (mode === AUTO_REFRESH_MODES.CREDENTIALS) {
    return "仅补拉凭证信息";
  }

  return "仅同步文件列表";
}

function autoRefreshModeLabel(mode) {
  if (mode === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
    return "文件 + 额度（含凭证）";
  }
  if (mode === AUTO_REFRESH_MODES.FILES_AND_CREDENTIALS) {
    return "文件 + 凭证";
  }
  if (mode === AUTO_REFRESH_MODES.CREDENTIALS_AND_QUOTAS) {
    return "凭证 + 额度";
  }
  if (mode === AUTO_REFRESH_MODES.CREDENTIALS) {
    return "只凭证";
  }

  return "只文件";
}

function futureTimeText(intervalMinutes) {
  var minutes = Math.max(1, parseInt(intervalMinutes, 10) || 10);
  return new Date(Date.now() + minutes * 60 * 1000).toLocaleString("zh-CN", { hour12: false });
}

function extractServiceValue(payload, keys) {
  var keyList = Array.isArray(keys) ? keys : [];
  var preferredKeys = keyList.concat(["value", "enabled", "data", "result"]);
  var index;

  if (payload == null) {
    return null;
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  for (index = 0; index < preferredKeys.length; index += 1) {
    var key = preferredKeys[index];
    if (payload[key] != null && payload[key] !== "") {
      if (key === "result" && typeof payload[key] === "object") {
        return extractServiceValue(payload[key], keyList);
      }
      return payload[key];
    }
  }

  return null;
}

function extractServiceBoolean(payload, keys) {
  var value = extractServiceValue(payload, keys);

  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }

  value = String(value).trim().toLowerCase();
  if (["true", "1", "enabled", "on", "yes"].indexOf(value) !== -1) {
    return true;
  }
  if (["false", "0", "disabled", "off", "no"].indexOf(value) !== -1) {
    return false;
  }
  return null;
}

// 新版管理台的顶部统计只关心全量真实状态，这里统一汇总文件池、额度池和异常处置需要的基础集合。
function createCollections(state) {
  var filtered = sortItems(state.items);
  var active = filtered.filter(function (item) {
    return !item.disabled;
  });
  var stable = active.filter(function (item) {
    return item.tone === "good";
  });
  var risk = active.filter(function (item) {
    return item.tone === "warn";
  });
  var operable = active.filter(function (item) {
    return item.tone !== "bad";
  });
  var badAll = active.filter(function (item) {
    return item.tone === "bad";
  });
  var disabled = filtered.filter(function (item) {
    return item.disabled;
  });

  return {
    stable: stable,
    risk: risk,
    operable: operable,
    badAll: badAll,
    disabled: disabled,
    bad401: badAll.filter(function (item) { return item.badReasonGroup === "auth-401"; }).length,
    badQuota: badAll.filter(function (item) { return item.badReasonGroup === "quota"; }).length,
    badOther: badAll.filter(function (item) { return item.badReasonGroup === "non-quota"; }).length,
    disabledBad: disabled.filter(function (item) { return item.tone === "bad"; }).length,
    disabledRecoverable: disabled.filter(function (item) { return item.tone !== "bad"; }).length
  };
}

function usageNumber(value) {
  var numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function usageTimestampValue(value) {
  var timeValue = Date.parse(value);
  return Number.isNaN(timeValue) ? 0 : timeValue;
}

function createEmptyUsageSummary() {
  return {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
    failedRequests: 0,
    modelCount: 0,
    sourceCount: 0,
    authIndexCount: 0,
    apiCount: 0
  };
}

function createAuthIndexLookup(items) {
  var lookup = {};

  (Array.isArray(items) ? items : []).forEach(function (item) {
    var authIndex = item && item.authIndex ? String(item.authIndex) : "";
    if (authIndex && !lookup[authIndex]) {
      lookup[authIndex] = item;
    }
  });

  return lookup;
}

// 把官方 /usage 响应统一扁平化，后续列表页、导出和文件 usage 计数都复用同一份解析结果。
function parseUsagePayload(payload, items) {
  var body = payload && payload.usage ? payload.usage : (payload || {});
  var apis = body && body.apis && typeof body.apis === "object" ? body.apis : {};
  var authIndexLookup = createAuthIndexLookup(items);
  var countsByAuthIndex = {};
  var events = [];
  var modelSet = {};
  var sourceSet = {};
  var authIndexSet = {};
  var apiSet = {};
  var derivedTotalTokens = 0;
  var derivedSuccessCount = 0;
  var derivedFailureCount = 0;

  Object.keys(apis).forEach(function (apiKey) {
    var apiEntry = apis[apiKey] || {};
    var models = apiEntry.models && typeof apiEntry.models === "object" ? apiEntry.models : {};
    apiSet[apiKey] = true;

    Object.keys(models).forEach(function (modelKey) {
      var modelEntry = models[modelKey] || {};
      var details = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      modelSet[modelKey] = true;

      details.forEach(function (detail, index) {
        var tokens = detail && detail.tokens ? detail.tokens : {};
        var authIndex = detail && detail.auth_index != null ? String(detail.auth_index) : "";
        var source = detail && detail.source ? String(detail.source) : "";
        var failed = !!(detail && detail.failed);
        var matchedItem = authIndex ? authIndexLookup[authIndex] : null;
        var event = {
          id: [
            apiKey,
            modelKey,
            authIndex || "unknown-auth",
            detail && detail.timestamp ? detail.timestamp : "unknown-time",
            String(index)
          ].join("::"),
          timestamp: detail && detail.timestamp ? detail.timestamp : "",
          apiLabel: apiKey,
          model: modelKey,
          source: source,
          authIndex: authIndex,
          fileName: matchedItem && matchedItem.name ? matchedItem.name : "",
          email: matchedItem && matchedItem.email ? matchedItem.email : "",
          failed: failed,
          resultCode: failed ? "failure" : "success",
          resultLabel: failed ? "失败" : "成功",
          inputTokens: usageNumber(tokens.input_tokens),
          outputTokens: usageNumber(tokens.output_tokens),
          reasoningTokens: usageNumber(tokens.reasoning_tokens),
          cachedTokens: usageNumber(tokens.cached_tokens),
          totalTokens: usageNumber(tokens.total_tokens)
        };

        events.push(event);
        derivedTotalTokens += event.totalTokens;
        if (failed) {
          derivedFailureCount += 1;
        } else {
          derivedSuccessCount += 1;
        }

        if (source) {
          sourceSet[source] = true;
        }
        if (authIndex) {
          authIndexSet[authIndex] = true;
          if (!countsByAuthIndex[authIndex]) {
            countsByAuthIndex[authIndex] = { success: 0, fail: 0 };
          }
          if (failed) {
            countsByAuthIndex[authIndex].fail += 1;
          } else {
            countsByAuthIndex[authIndex].success += 1;
          }
        }
      });
    });
  });

  events.sort(function (left, right) {
    return usageTimestampValue(right.timestamp) - usageTimestampValue(left.timestamp);
  });

  return {
    rawUsage: body,
    countsByAuthIndex: countsByAuthIndex,
    events: events,
    summary: {
      totalRequests: usageNumber(body.total_requests) || events.length,
      successCount: usageNumber(body.success_count) || derivedSuccessCount,
      failureCount: usageNumber(body.failure_count) || derivedFailureCount,
      totalTokens: usageNumber(body.total_tokens) || derivedTotalTokens,
      failedRequests: usageNumber(payload && payload.failed_requests != null ? payload.failed_requests : body.failure_count) || derivedFailureCount,
      modelCount: Object.keys(modelSet).length,
      sourceCount: Object.keys(sourceSet).length,
      authIndexCount: Object.keys(authIndexSet).length,
      apiCount: Object.keys(apiSet).length
    }
  };
}

export function useManagementConsole() {
  var bootstrapped = ref(false);
  var appConfig = ref({ management: {}, integrations: {} });
  var settings = reactive(readSettings(appConfig.value));
  var integrationSettings = reactive(readIntegrationSettings(appConfig.value));
  var state = reactive({
    items: [],
    logs: [],
    toasts: [],
    selected: {},
    busy: false,
    refreshId: 0,
    statusText: "等待连接",
    progress: { done: 0, total: 0 },
    progressTasks: [],
    progressVisible: false,
    progressText: "等待任务开始…",
    progressPercent: 0,
    autoRefreshInfo: {
      running: false,
      lastRunAt: "",
      lastResult: "idle",
      lastMessage: "",
      nextRunAt: ""
    }
  });
  var ui = reactive({
    detailKey: "",
    credentialDetailKey: "",
    pendingMap: {},
    operationDialog: {
      visible: false,
      title: "",
      stage: "",
      currentName: "",
      activeNames: [],
      currentIndex: 0,
      total: 0,
      percent: 0,
      successCount: 0,
      failureCount: 0,
      successLabel: "",
      failureLabel: "",
      concurrency: 0,
      intervalSeconds: null,
      latestMessage: "",
      failureDetails: [],
      resultDetails: [],
      canClose: false,
      completed: false
    }
  });
  var service = reactive({
    usageStatisticsEnabled: null,
    requestLog: null,
    debug: null,
    proxyUrl: "",
    requestRetry: "",
    maxRetryInterval: "",
    lastSyncAt: "",
    synced: false
  });
  var usageCenter = reactive({
    summary: createEmptyUsageSummary(),
    events: [],
    rawUsage: null,
    synced: false,
    loadedAt: "",
    error: ""
  });
  var uploadInputRef = ref(null);
  var api = createApi(function () {
    return normalizedSettings(settings);
  });
  var autoRefreshTimer = null;

  var confirm = useConsoleConfirm();
  var feedback = useConsoleFeedback(state);
  var log = feedback.log;
  var notify = feedback.notify;
  var dismissToast = feedback.dismissToast;
  var setBusy = feedback.setBusy;
  var setProgress = feedback.setProgress;
  var completeProgressTask = feedback.completeProgressTask;
  var removeProgressTask = feedback.removeProgressTask;
  var computeProgressPercent = feedback.computeProgressPercent;
  var setStatus = feedback.setStatus;

  function progressTaskId(type, key) {
    return String(type || "__global__") + "::" + String(key || "");
  }

  function resolveProgressTaskId(explicitTaskId, type, key) {
    return explicitTaskId ? String(explicitTaskId) : progressTaskId(type, key);
  }

  function setTaskProgress(taskId, text, percent, options) {
    setProgress(text, percent, Object.assign({}, options || {}, {
      taskId: String(taskId || "__global__")
    }));
  }

  function setTaskStatus(taskId, done, total, options) {
    setStatus(done, total, Object.assign({}, options || {}, {
      taskId: String(taskId || "__global__")
    }));
  }

  function completeTaskProgress(taskId, text, options) {
    completeProgressTask(String(taskId || "__global__"), text, options);
  }

  function removeTaskProgress(taskId) {
    removeProgressTask(String(taskId || "__global__"));
  }

  function pendingToken(type, key) {
    return String(type || "") + "::" + String(key || "");
  }

  // 等待态改为 token map，允许多个按钮同时保留自己的 pending，不会互相覆盖。
  function startPending(type, key) {
    var token;
    if (!type) {
      return "";
    }
    token = pendingToken(type, key);
    ui.pendingMap[token] = (ui.pendingMap[token] || 0) + 1;
    return token;
  }

  function finishPending(type, key) {
    var token;
    if (!type) {
      return;
    }
    token = pendingToken(type, key);
    if (!ui.pendingMap[token]) {
      return;
    }
    if (ui.pendingMap[token] <= 1) {
      delete ui.pendingMap[token];
      return;
    }
    ui.pendingMap[token] -= 1;
  }

  function isPending(type, key) {
    if (!type) {
      return false;
    }
    return !!ui.pendingMap[pendingToken(type, key)];
  }

  function hasPending(types, key) {
    var tokens = Object.keys(ui.pendingMap);
    var list = Array.isArray(types) ? types.filter(Boolean) : [types].filter(Boolean);

    if (!tokens.length) {
      return false;
    }
    if (!list.length) {
      return true;
    }
    return list.some(function (type) {
      if (key != null && key !== "") {
        return !!ui.pendingMap[pendingToken(type, key)];
      }
      return tokens.some(function (token) {
        return token.indexOf(String(type) + "::") === 0;
      });
    });
  }

  function showOperationDialog(input) {
    var options = input || {};

    ui.operationDialog.visible = true;
    ui.operationDialog.title = options.title || "批量处理中";
    ui.operationDialog.stage = options.stage || "正在执行操作…";
    ui.operationDialog.currentName = options.currentName || "";
    ui.operationDialog.activeNames = Array.isArray(options.activeNames) ? options.activeNames.filter(Boolean) : [];
    ui.operationDialog.currentIndex = Number(options.currentIndex) || 0;
    ui.operationDialog.total = Number(options.total) || 0;
    ui.operationDialog.percent = Number(options.percent) || 0;
    ui.operationDialog.successCount = Number(options.successCount) || 0;
    ui.operationDialog.failureCount = Number(options.failureCount) || 0;
    ui.operationDialog.successLabel = options.successLabel || "";
    ui.operationDialog.failureLabel = options.failureLabel || "";
    ui.operationDialog.concurrency = Number(options.concurrency) || 0;
    ui.operationDialog.intervalSeconds = options.intervalSeconds == null ? null : Number(options.intervalSeconds);
    ui.operationDialog.latestMessage = options.latestMessage || "";
    ui.operationDialog.failureDetails = Array.isArray(options.failureDetails) ? options.failureDetails.slice() : [];
    ui.operationDialog.resultDetails = Array.isArray(options.resultDetails) ? options.resultDetails.slice() : [];
    ui.operationDialog.canClose = !!options.canClose;
    ui.operationDialog.completed = !!options.completed;
  }

  function updateOperationDialog(input) {
    var options = input || {};

    ui.operationDialog.visible = options.visible == null ? ui.operationDialog.visible : !!options.visible;
    if (options.title != null) {
      ui.operationDialog.title = options.title;
    }
    if (options.stage != null) {
      ui.operationDialog.stage = options.stage;
    }
    if (options.currentName != null) {
      ui.operationDialog.currentName = options.currentName;
    }
    if (options.activeNames != null) {
      ui.operationDialog.activeNames = Array.isArray(options.activeNames) ? options.activeNames.filter(Boolean) : [];
    }
    if (options.currentIndex != null) {
      ui.operationDialog.currentIndex = Number(options.currentIndex) || 0;
    }
    if (options.total != null) {
      ui.operationDialog.total = Number(options.total) || 0;
    }
    if (options.percent != null) {
      ui.operationDialog.percent = Number(options.percent) || 0;
    }
    if (options.successCount != null) {
      ui.operationDialog.successCount = Number(options.successCount) || 0;
    }
    if (options.failureCount != null) {
      ui.operationDialog.failureCount = Number(options.failureCount) || 0;
    }
    if (options.successLabel != null) {
      ui.operationDialog.successLabel = options.successLabel;
    }
    if (options.failureLabel != null) {
      ui.operationDialog.failureLabel = options.failureLabel;
    }
    if (options.concurrency != null) {
      ui.operationDialog.concurrency = Number(options.concurrency) || 0;
    }
    if (options.intervalSeconds != null) {
      ui.operationDialog.intervalSeconds = Number(options.intervalSeconds);
    }
    if (options.latestMessage != null) {
      ui.operationDialog.latestMessage = options.latestMessage;
    }
    if (options.failureDetails != null) {
      ui.operationDialog.failureDetails = Array.isArray(options.failureDetails) ? options.failureDetails.slice() : [];
    }
    if (options.resultDetails != null) {
      ui.operationDialog.resultDetails = Array.isArray(options.resultDetails) ? options.resultDetails.slice() : [];
    }
    if (options.canClose != null) {
      ui.operationDialog.canClose = !!options.canClose;
    }
    if (options.completed != null) {
      ui.operationDialog.completed = !!options.completed;
    }
  }

  function closeOperationDialog(force) {
    if (ui.operationDialog.visible && !ui.operationDialog.canClose && !force) {
      return;
    }

    ui.operationDialog.visible = false;
    ui.operationDialog.title = "";
    ui.operationDialog.stage = "";
    ui.operationDialog.currentName = "";
    ui.operationDialog.activeNames = [];
    ui.operationDialog.currentIndex = 0;
    ui.operationDialog.total = 0;
    ui.operationDialog.percent = 0;
    ui.operationDialog.successCount = 0;
    ui.operationDialog.failureCount = 0;
    ui.operationDialog.successLabel = "";
    ui.operationDialog.failureLabel = "";
    ui.operationDialog.concurrency = 0;
    ui.operationDialog.intervalSeconds = null;
    ui.operationDialog.latestMessage = "";
    ui.operationDialog.failureDetails = [];
    ui.operationDialog.resultDetails = [];
    ui.operationDialog.canClose = false;
    ui.operationDialog.completed = false;
  }

  function clearAutoRefreshTimer() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function isAutoRefreshTrigger(options) {
    return !!(options && options.triggerSource === "auto-refresh");
  }

  function nowText() {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }

  function updateAutoRefreshNextRun(intervalMinutes) {
    state.autoRefreshInfo.nextRunAt = futureTimeText(intervalMinutes);
  }

  function clearAutoRefreshInfo() {
    state.autoRefreshInfo.running = false;
    state.autoRefreshInfo.nextRunAt = "";
  }

  // 自动刷新默认是静默执行，这里单独维护最近一次运行结果，方便在左下角状态区排查是否真的触发过。
  function markAutoRefreshRunning(options) {
    if (!isAutoRefreshTrigger(options)) {
      return;
    }

    state.autoRefreshInfo.running = true;
  }

  function markAutoRefreshSuccess(options) {
    if (!isAutoRefreshTrigger(options)) {
      return;
    }

    state.autoRefreshInfo.running = false;
    state.autoRefreshInfo.lastRunAt = nowText();
    state.autoRefreshInfo.lastResult = "success";
    state.autoRefreshInfo.lastMessage = autoRefreshModeLabel(options.autoRefreshMode) + " 已完成自动同步";
    updateAutoRefreshNextRun(options.autoRefreshInterval);
  }

  function markAutoRefreshFailure(options, error) {
    if (!isAutoRefreshTrigger(options)) {
      return;
    }

    state.autoRefreshInfo.running = false;
    state.autoRefreshInfo.lastRunAt = nowText();
    state.autoRefreshInfo.lastResult = "error";
    state.autoRefreshInfo.lastMessage = error && error.message
      ? error.message
      : (autoRefreshModeLabel(options.autoRefreshMode) + " 自动同步失败");
    updateAutoRefreshNextRun(options.autoRefreshInterval);
  }

  function currentClassifierOptions() {
    var currentSettings = normalizedSettings(settings);
    return {
      lowQuotaThreshold: currentSettings.lowQuotaThreshold
    };
  }

  function currentQuotaRequestOptions() {
    var currentSettings = normalizedSettings(settings);
    return {
      concurrency: currentSettings.quotaConcurrency,
      intervalSeconds: currentSettings.quotaRequestIntervalSeconds
    };
  }

  function currentTokenRefreshOptions() {
    var currentSettings = normalizedSettings(settings);
    return {
      concurrency: currentSettings.tokenRefreshConcurrency,
      intervalSeconds: currentSettings.tokenRefreshIntervalSeconds
    };
  }

  function credentialInfoTargets(list) {
    return (Array.isArray(list) ? list : state.items).filter(function (item) {
      return item && item.name && !item.runtimeOnly;
    });
  }

  function writeCredentialInfo(key, credential) {
    var detail = credential && typeof credential === "object" ? credential : {};

    updateItem(key, function (current) {
      return Object.assign({}, current, {
        lastRefresh: detail.lastRefresh || "",
        expired: detail.expired || "",
        credentialInfoStatus: "success",
        credentialInfoError: "",
        credentialFetchedAt: detail.fetchedAt || "",
        credentialContent: detail.content || null,
        credentialText: detail.contentText || ""
      });
    });
  }

  function markCredentialInfoLoading(key) {
    updateItem(key, function (current) {
      return Object.assign({}, current, {
        credentialInfoStatus: "loading",
        credentialInfoError: ""
      });
    });
  }

  function markCredentialInfoError(key, message) {
    updateItem(key, function (current) {
      return Object.assign({}, current, {
        credentialInfoStatus: "error",
        credentialInfoError: message || "凭证信息同步失败"
      });
    });
  }

  async function readCredentialInfo(key, options) {
    var currentOptions = options || {};
    var item = state.items.filter(function (current) {
      return current.key === key;
    })[0];
    var result;
    var message;

    if (!item || !item.name) {
      return null;
    }

    if (currentOptions.markLoading !== false) {
      markCredentialInfoLoading(key);
    }
    if (currentOptions.pendingType) {
      startPending(currentOptions.pendingType, currentOptions.pendingKey || key);
    }

    try {
      result = await api.readAuthFileDetail(item);
      if (!result || result.success !== true || !result.credential) {
        message = result && result.message ? result.message : "读取凭证信息失败";
        markCredentialInfoError(key, message);
        if (!currentOptions.silentLog) {
          log("凭证信息同步失败：" + item.name + " · " + message, true);
        }
        if (!currentOptions.silentToast) {
          notify("凭证信息同步失败：" + item.name + "\n" + message, "danger", 4200);
        }
        return Object.assign({}, result || {}, {
          success: false,
          message: message
        });
      }

      writeCredentialInfo(key, result.credential);
      if (!currentOptions.silentLog) {
        log("凭证信息已同步：" + item.name);
      }
      if (!currentOptions.silentToast) {
        notify("凭证信息已同步：" + item.name, "success");
      }
      if (currentOptions.persist !== false) {
        persistCurrentSnapshot();
      }
      return result;
    } catch (error) {
      message = error && error.message ? error.message : "读取凭证信息失败";
      markCredentialInfoError(key, message);
      if (!currentOptions.silentLog) {
        log("凭证信息同步失败：" + item.name + " · " + message, true);
      }
      if (!currentOptions.silentToast) {
        notify("凭证信息同步失败：" + item.name + "\n" + message, "danger", 4200);
      }
      return {
        success: false,
        reason: "credential_info_request_failed",
        message: message
      };
    } finally {
      if (currentOptions.pendingType) {
        finishPending(currentOptions.pendingType, currentOptions.pendingKey || key);
      }
    }
  }

  async function syncCredentialInfoBatch(list, options) {
    var currentOptions = options || {};
    var targetList = credentialInfoTargets(list);
    var requestOptions = currentTokenRefreshOptions();
    var pendingType = currentOptions.pendingType || "";
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, pendingType || "credential-info-batch", currentOptions.pendingKey || "");
    var manageProgressCompletion = currentOptions.manageProgressCompletion !== false;
    var activeMap = {};
    var total = targetList.length;
    var cursor = 0;
    var done = 0;
    var successCount = 0;
    var failureCount = 0;
    var latestMessage = "";
    var failureDetails = [];

    function activeNames() {
      return Object.keys(activeMap).map(function (key) {
        return activeMap[key];
      }).filter(Boolean);
    }

    function appendFailure(item, message) {
      failureDetails = failureDetails.concat([{
        key: item && item.key ? item.key : String(failureDetails.length),
        name: item && (item.name || item.email) ? (item.name || item.email) : "未命名文件",
        message: message || "未返回明确失败原因"
      }]);
    }

    async function worker() {
      var item;
      var currentItem;
      var result;
      var message;

      if (cursor >= total) {
        return;
      }

      item = targetList[cursor];
      cursor += 1;
      currentItem = state.items.filter(function (current) {
        return current.key === item.key;
      })[0] || item;
      activeMap[currentItem.key] = currentItem.name;
      latestMessage = "正在同步凭证信息：" + currentItem.name;

      if (currentOptions.showDialog) {
        updateOperationDialog({
          stage: currentOptions.runningStage || "正在批量同步凭证信息…",
          currentName: currentItem.name,
          activeNames: activeNames(),
          currentIndex: done,
          total: total,
          percent: computeProgressPercent(done, total),
          successCount: successCount,
          failureCount: failureCount,
          latestMessage: latestMessage,
          failureDetails: failureDetails,
          canClose: false,
          completed: false
        });
      }

      if (currentOptions.progressText) {
        setTaskProgress(progressId, currentOptions.progressText + " 已完成 " + done + "/" + total + " · 当前 " + currentItem.name, computeProgressPercent(done, total), {
          done: done,
          total: total
        });
      }

      result = await readCredentialInfo(currentItem.key, {
        silentLog: true,
        silentToast: true,
        markLoading: true,
        persist: false
      });
      message = result && result.message ? result.message : "凭证信息同步失败";

      if (result && result.success === true) {
        successCount += 1;
        latestMessage = currentItem.name + " 凭证信息已同步";
      } else {
        failureCount += 1;
        latestMessage = currentItem.name + " 失败：" + message;
        appendFailure(currentItem, message);
      }

      done += 1;
      delete activeMap[currentItem.key];

      if (currentOptions.showDialog) {
        updateOperationDialog({
          currentName: currentItem.name,
          activeNames: activeNames(),
          currentIndex: done,
          total: total,
          percent: computeProgressPercent(done, total),
          successCount: successCount,
          failureCount: failureCount,
          latestMessage: latestMessage,
          failureDetails: failureDetails
        });
      }

      if (requestOptions.intervalSeconds > 0 && cursor < total) {
        await waitSeconds(requestOptions.intervalSeconds);
      }

      return worker();
    }

    if (!total) {
      if (!currentOptions.silentEmpty) {
        log(currentOptions.emptyLog || "当前没有可同步凭证信息的文件。");
        notify(currentOptions.emptyToast || "当前没有可同步凭证信息的文件。", "info");
      }
      if (currentOptions.progressText && manageProgressCompletion) {
        completeTaskProgress(progressId, currentOptions.emptyProgressText || "当前没有可同步凭证信息的文件。", {
          tone: "info"
        });
      }
      return null;
    }

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }
    if (currentOptions.manageBusy !== false) {
      setBusy(true);
    }
    if (currentOptions.showDialog) {
      closeOperationDialog(true);
      showOperationDialog({
        title: currentOptions.dialogTitle || "批量同步凭证信息",
        stage: currentOptions.prepareStage || "正在准备批量同步凭证信息…",
        currentName: targetList[0] ? targetList[0].name : "",
        activeNames: [],
        currentIndex: 0,
        total: total,
        percent: 0,
        successCount: 0,
        failureCount: 0,
        successLabel: "凭证信息同步成功",
        failureLabel: "凭证信息同步失败",
        concurrency: requestOptions.concurrency,
        intervalSeconds: requestOptions.intervalSeconds,
        latestMessage: currentOptions.startingMessage || "任务启动后会按配置并发下载 auth-file JSON 并更新凭证字段。",
        failureDetails: [],
        canClose: false,
        completed: false
      });
    }
    if (currentOptions.progressText) {
      setTaskProgress(progressId, currentOptions.prepareProgressText || "正在准备同步凭证信息…", 8, {
        done: 0,
        total: total
      });
    }

    try {
      if (!currentOptions.silentLog) {
        log(currentOptions.startLog || ("开始同步凭证信息，共 " + total + " 个文件。"));
      }
      await Promise.all(Array.from({ length: Math.min(requestOptions.concurrency, total) }, function () {
        return worker();
      }));
      persistCurrentSnapshot();

      if (currentOptions.showDialog) {
        updateOperationDialog({
          stage: failureCount ? "批量凭证信息同步已完成，部分文件同步失败。" : "批量凭证信息同步已全部完成。",
          activeNames: [],
          currentName: targetList[targetList.length - 1] ? targetList[targetList.length - 1].name : "",
          currentIndex: total,
          total: total,
          percent: 100,
          successCount: successCount,
          failureCount: failureCount,
          latestMessage: "批量凭证信息同步完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。",
          failureDetails: failureDetails,
          canClose: true,
          completed: true
        });
      }

      if (currentOptions.progressText && manageProgressCompletion) {
        completeTaskProgress(progressId, currentOptions.finishProgressText || "凭证信息同步完成。", {
          tone: failureCount ? "warn" : "success",
          done: total,
          total: total,
          hideDelayMs: failureCount ? 2200 : 1400
        });
      }
      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("凭证信息同步完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。"));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.completeToast || ("凭证信息同步完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。"), failureCount ? "warn" : "success", 4200);
      }
      return {
        ok: successCount,
        fail: failureCount
      };
    } catch (error) {
      latestMessage = error && error.message ? error.message : "批量同步凭证信息中断";
      if (currentOptions.showDialog) {
        updateOperationDialog({
          stage: "批量凭证信息同步中断，请查看底部动态日志。",
          activeNames: [],
          currentIndex: done,
          total: total,
          percent: 100,
          successCount: successCount,
          failureCount: failureCount,
          latestMessage: latestMessage,
          failureDetails: failureDetails,
          canClose: true,
          completed: true
        });
      }
      if (!currentOptions.silentLog) {
        log("批量同步凭证信息中断：" + latestMessage, true);
      }
      if (!currentOptions.silentToast) {
        notify("批量同步凭证信息中断。\n" + latestMessage, "danger", 6200);
      }
      if (currentOptions.progressText && manageProgressCompletion) {
        completeTaskProgress(progressId, "批量同步凭证信息中断。", {
          tone: "danger",
          done: done,
          total: total,
          hideDelayMs: 2400
        });
      }
      return null;
    } finally {
      if (currentOptions.manageBusy !== false) {
        setBusy(false);
      }
      if (pendingType) {
        finishPending(pendingType, currentOptions.pendingKey || "");
      }
    }
  }

  function waitSeconds(seconds) {
    if (!seconds) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.round(Number(seconds || 0) * 1000));
    });
  }

  function writeLocalSettings() {
    writeSettings(normalizedSettings(settings));
  }

  function writeLocalIntegrationSettings() {
    writeIntegrationSettings(normalizedIntegrationSettings(integrationSettings));
  }

  function itemIdentity(item) {
    return [
      item && item.name ? item.name : "",
      item && item.authIndex ? item.authIndex : "",
      item && item.accountId ? item.accountId : "",
      item && item.email ? item.email : "",
      item && item.provider ? item.provider : ""
    ].join("::");
  }

  function extractCodexFiles(data) {
    return (Array.isArray(data) ? data : (data.files || data.auth_files || [])).filter(function (item) {
      return String(item.provider || item.type || "").toLowerCase() === "codex";
    });
  }

  function mergeLoadedItem(nextItem, previousItem, classifierOptions) {
    var merged;

    if (!previousItem) {
      return nextItem;
    }

    merged = Object.assign({}, nextItem, {
      lastRefresh: nextItem.lastRefresh || previousItem.lastRefresh || "",
      expired: nextItem.expired || previousItem.expired || "",
      credentialInfoStatus: previousItem.credentialInfoStatus || nextItem.credentialInfoStatus || "idle",
      credentialInfoError: previousItem.credentialInfoError || "",
      credentialFetchedAt: previousItem.credentialFetchedAt || "",
      credentialContent: previousItem.credentialContent || null,
      credentialText: previousItem.credentialText || "",
      planType: previousItem.planType || nextItem.planType,
      quotaStatus: previousItem.quotaStatus || "idle",
      quotaStatusCode: previousItem.quotaStatusCode == null ? null : previousItem.quotaStatusCode,
      quotaError: previousItem.quotaError || "",
      requestStatusText: previousItem.requestStatusText || "等待请求",
      quotaStateCode: previousItem.quotaStateCode || "idle",
      quotaStateLabel: previousItem.quotaStateLabel || "等待额度",
      chatQuota: previousItem.chatQuota || null,
      chatQuotaSecondary: previousItem.chatQuotaSecondary || null,
      codeQuota: previousItem.codeQuota || null,
      rawQuotaMessage: previousItem.rawQuotaMessage || "",
      usageSuccessCount: previousItem.usageSuccessCount == null ? null : previousItem.usageSuccessCount,
      usageFailureCount: previousItem.usageFailureCount == null ? null : previousItem.usageFailureCount,
      promoMessage: previousItem.promoMessage || "",
      tone: previousItem.tone || nextItem.tone,
      health: previousItem.health || nextItem.health,
      badReasonGroup: previousItem.badReasonGroup || "",
      badReasonCode: previousItem.badReasonCode || "",
      badReasonLabel: previousItem.badReasonLabel || "",
      reason: previousItem.reason || nextItem.reason
    });

    if (merged.quotaStatus === "success" || merged.quotaStatus === "error") {
      return reclassifyItem(merged, classifierOptions);
    }
    return merged;
  }

  function persistCurrentSnapshot() {
    // 只在当前基地址有效时落快照，这样关闭自动加载后仍能恢复上次可见数据。
    saveSnapshot(normalizedSettings(settings), state);
  }

  function applyAuthFiles(files) {
    var classifierOptions = currentClassifierOptions();
    var previousItems = Array.isArray(state.items) ? state.items.slice() : [];
    var previousSelected = Object.assign({}, state.selected);
    var previousByIdentity = {};
    var selectedByIdentity = {};

    previousItems.forEach(function (item) {
      var identity = itemIdentity(item);
      if (!previousByIdentity[identity]) {
        previousByIdentity[identity] = item;
      }
      if (previousSelected[item.key]) {
        selectedByIdentity[identity] = true;
      }
    });

    state.items = files.map(baseItem).map(function (item) {
      return mergeLoadedItem(item, previousByIdentity[itemIdentity(item)], classifierOptions);
    });

    state.selected = state.items.reduce(function (result, item) {
      if (selectedByIdentity[itemIdentity(item)] && !item.runtimeOnly) {
        result[item.key] = true;
      }
      return result;
    }, {});

    state.progress = {
      done: state.items.length,
      total: state.items.length
    };
    persistCurrentSnapshot();
  }

  function applySnapshot(snapshot) {
    var classifierOptions = currentClassifierOptions();
    state.items = (snapshot && Array.isArray(snapshot.items) ? snapshot.items : []).map(function (item) {
      return reclassifyItem(item, classifierOptions);
    });
    state.selected = {};
    state.progress = snapshot && snapshot.progress
      ? {
        done: snapshot.progress.done || state.items.length,
        total: snapshot.progress.total || state.items.length
      }
      : { done: state.items.length, total: state.items.length };
    state.progressTasks = [];
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) {
      return false;
    }
    applySnapshot(snapshot);
    return true;
  }

  function updateItem(key, updater) {
    state.items = state.items.map(function (item) {
      return item.key === key ? updater(item) : item;
    });
  }

  function resetServiceState() {
    service.usageStatisticsEnabled = null;
    service.requestLog = null;
    service.debug = null;
    service.proxyUrl = "";
    service.requestRetry = "";
    service.maxRetryInterval = "";
    service.lastSyncAt = "";
    service.synced = false;
  }

  function resetUsageCenter(message) {
    usageCenter.summary = createEmptyUsageSummary();
    usageCenter.events = [];
    usageCenter.rawUsage = null;
    usageCenter.synced = false;
    usageCenter.loadedAt = "";
    usageCenter.error = message || "";
  }

  function applyUsageCounts(map) {
    state.items = state.items.map(function (item) {
      var usage = item.authIndex ? map[String(item.authIndex)] : null;
      return Object.assign({}, item, {
        usageSuccessCount: usage ? usage.success : 0,
        usageFailureCount: usage ? usage.fail : 0
      });
    });
  }

  function applyUsagePayload(payload) {
    var parsed = parseUsagePayload(payload, state.items);

    applyUsageCounts(parsed.countsByAuthIndex);
    usageCenter.summary = Object.assign(createEmptyUsageSummary(), parsed.summary);
    usageCenter.events = parsed.events;
    usageCenter.rawUsage = parsed.rawUsage;
    usageCenter.synced = true;
    usageCenter.loadedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    usageCenter.error = "";
    return parsed;
  }

  // 服务侧开关和运行参数来自官方管理 API，这里集中同步，避免页面各处分别请求导致状态漂移。
  async function refreshServiceState(options) {
    var currentOptions = options || {};
    var pendingType = currentOptions.pendingType || "";
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, pendingType || "service-refresh", currentOptions.pendingKey || "");
    var requests;
    var results;
    var fulfilled = 0;

    if (!normalizedSettings(settings).baseUrl || !normalizedSettings(settings).key) {
      resetServiceState();
      if (!currentOptions.silent) {
        notify("请先填写管理地址和 Management Key。", "info");
      }
      return;
    }

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }
    if (!currentOptions.passive) {
      setBusy(true);
      setTaskProgress(progressId, "正在同步服务设置与运行状态…", 18);
    }

    requests = [
      api.usageStatisticsEnabledRequest(),
      api.getManagementValue("request-log"),
      api.getManagementValue("debug"),
      api.getManagementValue("proxy-url"),
      api.getManagementValue("request-retry"),
      api.getManagementValue("max-retry-interval")
    ];

    try {
      results = await Promise.allSettled(requests);

      if (results[0].status === "fulfilled") {
        fulfilled += 1;
        service.usageStatisticsEnabled = extractServiceBoolean(results[0].value, ["usage-statistics-enabled", "usage_statistics_enabled", "enabled"]);
      }
      if (results[1].status === "fulfilled") {
        fulfilled += 1;
        service.requestLog = extractServiceBoolean(results[1].value, ["request_log"]);
      }
      if (results[2].status === "fulfilled") {
        fulfilled += 1;
        service.debug = extractServiceBoolean(results[2].value, ["debug"]);
      }
      if (results[3].status === "fulfilled") {
        fulfilled += 1;
        service.proxyUrl = String(extractServiceValue(results[3].value, ["proxy_url", "proxyUrl"]) || "").trim();
      }
      if (results[4].status === "fulfilled") {
        fulfilled += 1;
        service.requestRetry = String(extractServiceValue(results[4].value, ["request_retry", "requestRetry"]) || "").trim();
      }
      if (results[5].status === "fulfilled") {
        fulfilled += 1;
        service.maxRetryInterval = String(extractServiceValue(results[5].value, ["max_retry_interval", "maxRetryInterval"]) || "").trim();
      }

      if (!fulfilled) {
        throw new Error("官方管理 API 状态同步失败");
      }

      service.synced = fulfilled > 0;
      service.lastSyncAt = new Date().toLocaleString("zh-CN", { hour12: false });

      if (!currentOptions.silentToast) {
        notify("服务侧设置已同步。", "success");
      }
      if (!currentOptions.silentLog) {
        log("已同步官方管理 API 的服务侧设置。");
      }
      if (!currentOptions.passive) {
        completeTaskProgress(progressId, "服务侧设置已同步。", {
          tone: "success"
        });
      }
    } catch (error) {
      log("同步服务设置失败：" + (error.message || "未知错误"), true);
      if (!currentOptions.silentToast) {
        notify("同步服务设置失败。", "danger", 3200);
      }
      if (!currentOptions.passive) {
        completeTaskProgress(progressId, "同步服务设置失败。", {
          tone: "danger",
          hideDelayMs: 2200
        });
      }
    } finally {
      if (!currentOptions.passive) {
        setBusy(false);
      }
      if (pendingType) {
        finishPending(pendingType, currentOptions.pendingKey || "");
      }
    }
  }

  async function updateServiceFlag(key, value) {
    var mapping = {
      usageStatisticsEnabled: { path: "usage-statistics-enabled", label: "Usage 统计" },
      requestLog: { path: "request-log", label: "请求日志" },
      debug: { path: "debug", label: "Debug 模式" }
    };
    var current = mapping[key];
    var progressId = progressTaskId("service-flags", key);

    if (!current) {
      return;
    }

    startPending("service-flags", key);
    setBusy(true);
    setTaskProgress(progressId, "正在更新" + current.label + "…", 34);

    try {
      await api.setManagementValue(current.path, !!value);
      service[key] = !!value;
      service.lastSyncAt = new Date().toLocaleString("zh-CN", { hour12: false });

      log(current.label + "已" + (value ? "开启" : "关闭") + "。");
      notify(current.label + "已" + (value ? "开启" : "关闭") + "。", "success");
      completeTaskProgress(progressId, current.label + "已" + (value ? "开启" : "关闭") + "。", {
        tone: "success"
      });
    } catch (error) {
      log(current.label + "更新失败：" + (error.message || "未知错误"), true);
      notify(current.label + "更新失败。", "danger", 3200);
      completeTaskProgress(progressId, current.label + "更新失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
    } finally {
      setBusy(false);
      finishPending("service-flags", key);
    }
  }

  async function saveServiceProxy() {
    var value = String(service.proxyUrl || "").trim();
    var progressId = progressTaskId("service-proxy", "save");

    startPending("service-proxy", "save");
    setBusy(true);
    setTaskProgress(progressId, "正在保存代理地址…", 38);

    try {
      if (value) {
        await api.setManagementValue("proxy-url", value);
        service.proxyUrl = value;
        log("已更新上游代理地址。");
        notify("代理地址已保存。", "success");
      } else {
        await api.clearManagementValue("proxy-url");
        service.proxyUrl = "";
        log("已清空上游代理地址。");
        notify("代理地址已清空。", "success");
      }
      service.lastSyncAt = new Date().toLocaleString("zh-CN", { hour12: false });
      completeTaskProgress(progressId, value ? "代理地址已保存。" : "代理地址已清空。", {
        tone: "success"
      });
    } catch (error) {
      log("保存代理地址失败：" + (error.message || "未知错误"), true);
      notify("保存代理地址失败。", "danger", 3200);
      completeTaskProgress(progressId, "保存代理地址失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
    } finally {
      setBusy(false);
      finishPending("service-proxy", "save");
    }
  }

  async function clearServiceProxy() {
    service.proxyUrl = "";
    await saveServiceProxy();
  }

  async function saveRetrySettings() {
    var retryValue = String(service.requestRetry || "").trim();
    var intervalValue = String(service.maxRetryInterval || "").trim();
    var progressId = progressTaskId("service-retry", "save");

    startPending("service-retry", "save");
    setBusy(true);
    setTaskProgress(progressId, "正在保存重试策略…", 42);

    try {
      if (retryValue) {
        await api.setManagementValue("request-retry", Number(retryValue));
      } else {
        await api.clearManagementValue("request-retry");
      }

      if (intervalValue) {
        await api.setManagementValue("max-retry-interval", Number(intervalValue));
      } else {
        await api.clearManagementValue("max-retry-interval");
      }

      service.requestRetry = retryValue;
      service.maxRetryInterval = intervalValue;
      service.lastSyncAt = new Date().toLocaleString("zh-CN", { hour12: false });
      log("已更新请求重试策略。");
      notify("重试策略已保存。", "success");
      completeTaskProgress(progressId, "重试策略已保存。", {
        tone: "success"
      });
    } catch (error) {
      log("保存重试策略失败：" + (error.message || "未知错误"), true);
      notify("保存重试策略失败。", "danger", 3200);
      completeTaskProgress(progressId, "保存重试策略失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
    } finally {
      setBusy(false);
      finishPending("service-retry", "save");
    }
  }

  async function saveDefaultSettings() {
    var nextManagement = normalizedSettings(settings);
    var progressId = progressTaskId("save-default-settings", "save");

    startPending("save-default-settings");
    setBusy(true);
    setTaskProgress(progressId, "正在保存默认配置…", 36);

    try {
      // 设置页的“保存默认配置”只把当前 management 配置回写到 app-config.json，页面本地缓存逻辑保持不变。
      var savedConfig = await api.saveDefaultManagementConfig(nextManagement);

      appConfig.value = Object.assign({}, appConfig.value, savedConfig || {}, {
        management: Object.assign({}, nextManagement)
      });
      log("已将当前管理台配置保存为默认配置。");
      notify("默认配置已保存到 app-config.json。", "success");
      completeTaskProgress(progressId, "默认配置已保存。", {
        tone: "success"
      });
    } catch (error) {
      log("保存默认配置失败：" + (error.message || "未知错误"), true);
      notify("保存默认配置失败。", "danger", 3200);
      completeTaskProgress(progressId, "保存默认配置失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
    } finally {
      setBusy(false);
      finishPending("save-default-settings");
    }
  }

  async function saveIntegrationSettings() {
    var nextIntegrations = {
      wenfxlOpenai: {
        url: normalizedIntegrationSettings(integrationSettings).wenfxlOpenaiUrl
      }
    };
    var progressId = progressTaskId("save-integration-settings", "save");

    startPending("save-integration-settings");
    setBusy(true);
    setTaskProgress(progressId, "正在保存集成配置…", 36);

    try {
      // 集成配置与 management 默认值分开保存，避免不同设置页之间互相覆盖。
      var savedConfig = await api.saveDefaultIntegrationConfig(nextIntegrations);

      appConfig.value = Object.assign({}, appConfig.value, savedConfig || {}, {
        integrations: Object.assign({}, nextIntegrations)
      });
      log("已将当前外部集成配置保存为默认配置。");
      notify("集成配置已保存到 app-config.json。", "success");
      completeTaskProgress(progressId, "集成配置已保存。", {
        tone: "success"
      });
    } catch (error) {
      log("保存集成配置失败：" + (error.message || "未知错误"), true);
      notify("保存集成配置失败。", "danger", 3200);
      completeTaskProgress(progressId, "保存集成配置失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
    } finally {
      setBusy(false);
      finishPending("save-integration-settings");
    }
  }

  async function loadQuotas(refreshId, options) {
    var currentOptions = options || {};
    var classifierOptions = currentClassifierOptions();
    var quotaRequestOptions = currentQuotaRequestOptions();
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, currentOptions.progressType || "quota-refresh", currentOptions.progressKey || "");
    var manageProgressCompletion = currentOptions.manageProgressCompletion !== false;
    var list = Array.isArray(currentOptions.items)
      ? currentOptions.items.filter(function (item) { return item && item.authIndex && item.accountId; })
      : state.items.filter(function (item) { return item.authIndex && item.accountId; });
    var total = list.length;
    var done = 0;
    var cursor = 0;

    setTaskStatus(progressId, 0, total);
    if (!total) {
      if (!currentOptions.silentLog) {
        log(currentOptions.emptyLog || "当前没有可拉取额度的 Codex 账号，已跳过额度刷新。");
      }
      if (manageProgressCompletion) {
        completeTaskProgress(progressId, currentOptions.emptyProgressText || "当前没有可拉取额度的账号。", {
          tone: "info"
        });
      }
      return;
    }

    // 额度请求采用固定并发批次，兼顾刷新速度和接口压力。
    async function worker() {
      if (refreshId !== state.refreshId || cursor >= list.length) {
        return;
      }

      var item = list[cursor];
      cursor += 1;

      updateItem(item.key, function (current) {
        return Object.assign({}, current, {
          quotaStatus: "loading",
          reason: "正在拉取额度详情..."
        });
      });

      try {
        var result = await api.quotaRequest(item);
        if (refreshId !== state.refreshId) {
          return;
        }
        updateItem(item.key, function (current) {
          return enrichItem(current, result, classifierOptions);
        });
      } catch (error) {
        if (refreshId !== state.refreshId) {
          return;
        }
        updateItem(item.key, function (current) {
          return enrichError(current, {
            message: error.message || "额度获取失败"
          });
        });
      } finally {
        done += 1;
        setTaskStatus(progressId, done, total);
      }

      if (refreshId === state.refreshId && quotaRequestOptions.intervalSeconds > 0 && cursor < list.length) {
        await waitSeconds(quotaRequestOptions.intervalSeconds);
      }

      return worker();
    }

    var jobs = [];
    var limit = Math.min(quotaRequestOptions.concurrency, list.length);
    var index;

    for (index = 0; index < limit; index += 1) {
      jobs.push(worker());
    }

    await Promise.all(jobs);
    if (refreshId !== state.refreshId) {
      if (manageProgressCompletion) {
        removeTaskProgress(progressId);
      }
      return;
    }
    if (refreshId === state.refreshId) {
      persistCurrentSnapshot();
      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("额度刷新完成，共处理 " + total + " 个账号。"));
      }
      if (manageProgressCompletion) {
        completeTaskProgress(progressId, currentOptions.completeProgressText || ("额度刷新完成，共处理 " + total + " 个账号。"), {
          tone: "success",
          done: total,
          total: total
        });
      }
    }
  }

  async function loadUsageStats(refreshId) {
    try {
      var enabled = await api.usageStatisticsEnabledRequest();
      var flag = extractServiceBoolean(enabled, ["usage-statistics-enabled", "usage_statistics_enabled", "enabled"]);
      service.usageStatisticsEnabled = flag == null ? service.usageStatisticsEnabled : flag !== false;
      if (flag === false) {
        usageCenter.error = "服务端当前未开启 Usage 统计。";
        return;
      }
      var data = await api.usageRequest();
      if (refreshId !== state.refreshId) {
        return;
      }
      applyUsagePayload(data);
      persistCurrentSnapshot();
    } catch (_) {
      return;
    }
  }

  async function loadUsageEvents(options) {
    var currentOptions = options || {};
    var pendingType = currentOptions.pendingType || "usage-events-refresh";
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, pendingType, currentOptions.pendingKey || "");

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    setBusy(true);
    setTaskProgress(progressId, currentOptions.progressLabel || "正在同步请求事件明细…", 18);

    try {
      if (!currentOptions.silentLog) {
        log(currentOptions.startLog || "开始同步请求事件明细。");
      }

      var enabledFlag = null;
      try {
        enabledFlag = extractServiceBoolean(await api.usageStatisticsEnabledRequest(), ["usage-statistics-enabled", "usage_statistics_enabled", "enabled"]);
        if (enabledFlag != null) {
          service.usageStatisticsEnabled = enabledFlag;
        }
      } catch (_) {
        enabledFlag = null;
      }

      if (enabledFlag === false) {
        usageCenter.error = "服务端当前未开启 Usage 统计，请先启用后再拉取事件明细。";
        if (!currentOptions.silentToast) {
          notify("服务端当前未开启 Usage 统计。", "info");
        }
        completeTaskProgress(progressId, "服务端当前未开启 Usage 统计。", {
          tone: "info"
        });
        return null;
      }

      var payload = await api.usageRequest();
      applyUsagePayload(payload);
      persistCurrentSnapshot();

      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("请求事件明细已同步，共 " + usageCenter.summary.totalRequests + " 条请求。"));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.completeToast || ("请求事件明细已同步，共 " + usageCenter.summary.totalRequests + " 条请求。"), "success");
      }
      completeTaskProgress(progressId, currentOptions.completeProgressText || "请求事件明细已同步。", {
        tone: "success"
      });
      return usageCenter.events;
    } catch (error) {
      usageCenter.error = error.message || "请求事件明细同步失败";
      log("请求事件明细同步失败：" + (error.message || "未知错误"), true);
      if (!currentOptions.silentToast) {
        notify("请求事件明细同步失败。", "danger", 3200);
      }
      completeTaskProgress(progressId, "请求事件明细同步失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
      return null;
    } finally {
      setBusy(false);
      if (pendingType) {
        finishPending(pendingType, currentOptions.pendingKey || "");
      }
    }
  }

  async function exportUsageSnapshot() {
    startPending("usage-export-json");

    try {
      return await api.usageExportRequest();
    } finally {
      finishPending("usage-export-json");
    }
  }

  async function loadFiles(options) {
    var currentOptions = options || {};
    var pendingType = currentOptions.pendingType || "";
    var includeCredentialInfo = !!currentOptions.includeCredentialInfo;
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, pendingType || "load-files", currentOptions.pendingKey || "");
    var credentialResult;

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    writeLocalSettings();
    markAutoRefreshRunning(currentOptions);
    setBusy(true);
    setTaskProgress(progressId, currentOptions.progressLabel || "正在拉取认证文件列表…", 12);
    state.statusText = "正在拉取账号列表…";
    state.refreshId += 1;
    var refreshId = state.refreshId;

    try {
      if (!currentOptions.silentLog) {
        log(currentOptions.startLog || "开始刷新认证文件列表。");
      }

      var data = await api.request("/auth-files");
      var files = extractCodexFiles(data);

      if (refreshId !== state.refreshId) {
        removeTaskProgress(progressId);
        return;
      }

      applyAuthFiles(files);

      if (includeCredentialInfo) {
        setTaskProgress(progressId, "文件列表已同步，正在补拉凭证信息…", 36);
        credentialResult = await syncCredentialInfoBatch(state.items, {
          manageBusy: false,
          showDialog: false,
          silentLog: true,
          silentToast: true,
          silentEmpty: true,
          progressText: "正在同步凭证信息…",
          prepareProgressText: "正在准备同步凭证信息…",
          finishProgressText: "文件与凭证信息同步完成。",
          progressTaskId: progressId,
          manageProgressCompletion: false
        });
        if (state.items.length && credentialResult == null) {
          throw new Error("凭证信息同步失败");
        }
      }

      state.statusText = state.items.length
        ? ((includeCredentialInfo ? "文件与凭证信息已同步" : "文件列表已同步") + " · 共 " + state.items.length + " 个账号")
        : "文件列表已同步，当前没有 Codex 账号";
      completeTaskProgress(progressId, currentOptions.finishProgressText || (includeCredentialInfo ? "文件与凭证信息同步完成。" : "文件列表同步完成。"), {
        tone: "success"
      });
      markAutoRefreshSuccess(currentOptions);

      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ((includeCredentialInfo ? "认证文件与凭证信息已同步，共 " : "认证文件列表已同步，共 ") + state.items.length + " 个 Codex 账号。"));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.completeToast || ((includeCredentialInfo ? "文件与凭证信息已同步，当前共 " : "文件列表已同步，当前共 ") + state.items.length + " 个 Codex 账号。"), "success");
      }
    } catch (error) {
      state.statusText = error && error.message === "凭证信息同步失败"
        ? "文件列表已同步，但凭证信息同步失败"
        : "文件列表拉取失败，请检查连接";
      markAutoRefreshFailure(currentOptions, error);
      if (!currentOptions.silentLog) {
        log((error && error.message === "凭证信息同步失败" ? "文件列表已同步，但凭证信息同步失败：" : "文件列表刷新失败：") + (error.message || "未知错误"), true);
      }
      if (!currentOptions.silentErrorToast) {
        notify(error && error.message === "凭证信息同步失败" ? "文件列表已同步，但凭证信息同步失败。" : "文件列表刷新失败，请检查管理地址与 Management Key。", "danger", 3200);
      }
      completeTaskProgress(progressId, error && error.message === "凭证信息同步失败" ? "文件列表已同步，但凭证信息同步失败。" : "文件列表刷新失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
    } finally {
      setBusy(false);
      if (pendingType) {
        finishPending(pendingType, currentOptions.pendingKey || "");
      }
    }
  }

  async function loadQuotasBatch(list, options) {
    var currentOptions = options || {};
    var pendingType = currentOptions.pendingType || "";
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, pendingType || "quota-batch", currentOptions.pendingKey || "");
    var targetList = Array.isArray(list) ? list.filter(function (item) {
      return item && item.authIndex && item.accountId;
    }) : [];

    if (!targetList.length) {
      log(currentOptions.emptyLog || "当前没有可刷新的额度对象。");
      notify(currentOptions.emptyToast || "当前没有可刷新的额度对象。", "info");
      return null;
    }

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    setBusy(true);
    setTaskProgress(progressId, currentOptions.progressLabel || "正在准备刷新额度…", 12);
    state.refreshId += 1;
    var refreshId = state.refreshId;

    try {
      if (!currentOptions.silentLog) {
        log(currentOptions.startLog || ("开始刷新额度，共 " + targetList.length + " 个账号。"));
      }

      if (currentOptions.includeUsage) {
        await Promise.all([
          loadUsageStats(refreshId),
          loadQuotas(refreshId, {
            items: targetList,
            silentLog: true,
            progressTaskId: progressId,
            manageProgressCompletion: false
          })
        ]);
      } else {
        await loadQuotas(refreshId, {
          items: targetList,
          silentLog: true,
          progressTaskId: progressId,
          manageProgressCompletion: false
        });
      }

      if (refreshId !== state.refreshId) {
        removeTaskProgress(progressId);
        return null;
      }

      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("额度刷新完成，共处理 " + targetList.length + " 个账号。"));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.completeToast || ("额度刷新完成，共处理 " + targetList.length + " 个账号。"), "success");
      }
      completeTaskProgress(progressId, currentOptions.completeProgressText || ("额度刷新完成，共处理 " + targetList.length + " 个账号。"), {
        tone: "success",
        done: targetList.length,
        total: targetList.length
      });
      return { total: targetList.length };
    } catch (error) {
      log((currentOptions.failLogPrefix || "额度刷新失败：") + (error.message || "未知错误"), true);
      notify(currentOptions.failToast || "额度刷新失败，请检查连接。", "danger", 3200);
      completeTaskProgress(progressId, currentOptions.failProgressText || "额度刷新失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      return null;
    } finally {
      setBusy(false);
      if (pendingType) {
        finishPending(pendingType, currentOptions.pendingKey || "");
      }
    }
  }

  async function refreshAllQuotas(options) {
    return loadQuotasBatch(state.items, Object.assign({
      pendingType: "refresh-all",
      progressLabel: "正在准备刷新全池额度…",
      startLog: "开始刷新全池额度。",
      completeLog: "全池额度刷新完成。",
      completeToast: "全池额度刷新完成。",
      emptyLog: "当前没有可刷新的额度对象。",
      emptyToast: "当前没有可刷新的额度对象。",
      failToast: "全池额度刷新失败，请检查连接。",
      includeUsage: true
    }, options || {}));
  }

  async function refreshSelectedQuotas(options) {
    var selectedItems = state.items.filter(function (item) {
      return !!state.selected[item.key];
    });
    var result;

    result = await loadQuotasBatch(selectedItems, Object.assign({
      pendingType: "refresh-selected-quotas",
      progressLabel: "正在准备刷新选中额度…",
      startLog: "开始刷新选中额度。",
      completeLog: "选中额度刷新完成。",
      completeToast: "选中额度刷新完成。",
      emptyLog: "当前没有可刷新的选中额度对象。",
      emptyToast: "当前没有可刷新的选中额度对象。",
      failToast: "选中额度刷新失败，请检查连接。",
      includeUsage: false
    }, options || {}));

    clearSelectionKeys(selectedItems.map(function (item) {
      return item.key;
    }));
    return result;
  }

  async function refreshDisabledQuotas(options) {
    var disabledItems = state.items.filter(function (item) {
      return !!item.disabled;
    });

    // 停用池独立成一级菜单后，提供对应的整池额度刷新入口，避免用户先去筛选再批量操作。
    return loadQuotasBatch(disabledItems, Object.assign({
      pendingType: "refresh-disabled-quotas",
      progressLabel: "正在准备刷新停用池额度…",
      startLog: "开始刷新停用池额度。",
      completeLog: "停用池额度刷新完成。",
      completeToast: "停用池额度刷新完成。",
      emptyLog: "当前停用池没有可刷新的额度对象。",
      emptyToast: "当前停用池没有可刷新的额度对象。",
      failToast: "停用池额度刷新失败，请检查连接。",
      includeUsage: true
    }, options || {}));
  }

  async function refreshSelectedCredentialInfo(options) {
    var selectedItems = state.items.filter(function (item) {
      return !!state.selected[item.key];
    });
    var result;

    result = await syncCredentialInfoBatch(selectedItems, Object.assign({
      pendingType: "refresh-credential-info-selected",
      dialogTitle: "批量同步凭证信息",
      prepareStage: "正在准备批量同步选中凭证信息…",
      runningStage: "正在批量同步选中凭证信息…",
      startingMessage: "任务启动后会按配置并发下载 auth-file JSON，并回填 last_refresh / expired 等凭证字段。",
      progressText: "正在同步凭证信息…",
      prepareProgressText: "正在准备同步选中凭证信息…",
      finishProgressText: "批量同步凭证信息完成。",
      startLog: "开始批量同步选中凭证信息。",
      completeLog: "批量同步选中凭证信息完成。",
      completeToast: "批量同步选中凭证信息完成。",
      emptyLog: "当前没有可同步凭证信息的选中文件。",
      emptyToast: "当前没有可同步凭证信息的选中文件。",
      showDialog: true,
      silentEmpty: false
    }, options || {}));

    clearSelectionKeys(selectedItems.map(function (item) {
      return item.key;
    }));
    return result;
  }

  async function loadAll(options) {
    var currentOptions = options || {};
    var pendingType = currentOptions.pendingType || "";
    var includeUsage = currentOptions.includeUsage !== false;
    var includeCredentialInfo = !!currentOptions.includeCredentialInfo;
    var progressId = resolveProgressTaskId(currentOptions.progressTaskId, pendingType || "load-all", currentOptions.pendingKey || "");
    var credentialResult;

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    writeLocalSettings();
    markAutoRefreshRunning(currentOptions);
    setBusy(true);
    setTaskProgress(progressId, includeCredentialInfo ? "正在同步文件列表、凭证信息与额度…" : (includeUsage ? "正在同步文件列表、请求统计与额度…" : "正在同步文件列表与额度…"), 8);
    state.statusText = "正在拉取账号列表…";
    state.refreshId += 1;
    var refreshId = state.refreshId;

    try {
      if (!currentOptions.silentLog) {
        log(includeUsage ? "开始同步认证文件、请求统计与额度数据。" : "开始同步认证文件与额度数据。");
      }
      var data = await api.request("/auth-files");
      var files = extractCodexFiles(data);

      if (refreshId !== state.refreshId) {
        removeTaskProgress(progressId);
        return;
      }

      applyAuthFiles(files);
      if (!currentOptions.silentLog) {
        log("认证文件已载入，Codex 账号 " + state.items.length + " 个，开始拉取" + (includeCredentialInfo ? "凭证信息与" : "") + (includeUsage ? "请求统计与额度明细。" : "额度明细。"));
      }

      if (includeCredentialInfo) {
        setTaskProgress(progressId, "认证文件已载入，正在同步凭证信息…", 28);
        credentialResult = await syncCredentialInfoBatch(state.items, {
          manageBusy: false,
          showDialog: false,
          silentLog: true,
          silentToast: true,
          silentEmpty: true,
          progressText: "正在同步凭证信息…",
          prepareProgressText: "正在准备同步凭证信息…",
          finishProgressText: "凭证信息同步完成。",
          progressTaskId: progressId,
          manageProgressCompletion: false
        });
        if (state.items.length && credentialResult == null) {
          throw new Error("凭证信息同步失败");
        }
      }

      setTaskProgress(progressId, includeUsage ? "正在同步额度与请求统计…" : "正在同步额度…", includeCredentialInfo ? 54 : 32);
      if (includeUsage) {
        await Promise.all([
          loadUsageStats(refreshId),
          loadQuotas(refreshId, {
            items: state.items,
            silentLog: true,
            progressTaskId: progressId,
            manageProgressCompletion: false
          })
        ]);
      } else {
        await loadQuotas(refreshId, {
          items: state.items,
          silentLog: true,
          progressTaskId: progressId,
          manageProgressCompletion: false
        });
      }

      if (refreshId !== state.refreshId) {
        removeTaskProgress(progressId);
        return;
      }

      if (!currentOptions.silentLog) {
        log((includeCredentialInfo ? "文件、凭证信息与额度同步完成，共处理 " : (includeUsage ? "文件、请求统计与额度同步完成，共处理 " : "文件与额度同步完成，共处理 ")) + state.items.length + " 个账号。");
      }
      markAutoRefreshSuccess(currentOptions);
      if (!currentOptions.silentToast) {
        notify((includeCredentialInfo ? "文件、凭证信息与额度同步完成，当前共 " : (includeUsage ? "文件、请求统计与额度同步完成，当前共 " : "文件与额度同步完成，当前共 ")) + state.items.length + " 个 Codex 账号。", "success");
      }
      completeTaskProgress(progressId, includeCredentialInfo ? "文件、凭证信息与额度同步完成。" : (includeUsage ? "文件、请求统计与额度同步完成。" : "文件与额度同步完成。"), {
        tone: "success",
        done: state.items.length,
        total: state.items.length
      });
    } catch (error) {
      state.statusText = error && error.message === "凭证信息同步失败"
        ? "文件列表已同步，但凭证信息同步失败"
        : "同步失败，请检查连接";
      markAutoRefreshFailure(currentOptions, error);
      if (!currentOptions.silentLog) {
        log((error && error.message === "凭证信息同步失败" ? "同步失败：凭证信息加载异常，" : "同步失败：认证文件或额度加载异常，") + (error.message || "未知错误"), true);
      }
      if (!currentOptions.silentErrorToast) {
        notify(error && error.message === "凭证信息同步失败" ? "文件列表已同步，但凭证信息同步失败。" : "同步失败，请检查管理地址与 Management Key。", "danger", 3200);
      }
      completeTaskProgress(progressId, error && error.message === "凭证信息同步失败" ? "文件列表已同步，但凭证信息同步失败。" : "同步失败，请检查连接。", {
        tone: "danger",
        hideDelayMs: 2400
      });
    } finally {
      setBusy(false);
      if (pendingType) {
        finishPending(pendingType, currentOptions.pendingKey || "");
      }
    }
  }

  function rescan() {
    startPending("rescan");
    try {
      var classifierOptions = currentClassifierOptions();
      state.items = state.items.map(function (item) {
        return reclassifyItem(item, classifierOptions);
      });
      persistCurrentSnapshot();
      log("已按当前额度响应标准重新归类文件状态。");
      notify("已按当前额度响应标准重新归类当前列表。", "info");
    } finally {
      finishPending("rescan");
    }
  }

  async function executeCurrentAutoRefreshMode(options) {
    var currentOptions = options || {};
    var currentSettings = currentOptions.settings || normalizedSettings(settings);
    var pendingType = currentOptions.pendingType || "";
    var pendingKey = currentOptions.pendingKey || "";

    if (pendingType) {
      startPending(pendingType, pendingKey);
    }

    try {
      if (currentSettings.autoRefreshMode === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
        return loadAll(Object.assign({}, currentOptions, {
          pendingType: "",
          includeCredentialInfo: true,
          includeUsage: false,
          autoRefreshMode: currentSettings.autoRefreshMode,
          autoRefreshInterval: currentSettings.interval
        }));
      }

      if (currentSettings.autoRefreshMode === AUTO_REFRESH_MODES.FILES_AND_CREDENTIALS) {
        return loadFiles(Object.assign({}, currentOptions, {
          pendingType: "",
          includeCredentialInfo: true,
          autoRefreshMode: currentSettings.autoRefreshMode,
          autoRefreshInterval: currentSettings.interval
        }));
      }

      if (currentSettings.autoRefreshMode === AUTO_REFRESH_MODES.CREDENTIALS_AND_QUOTAS) {
        var credentialResult = await syncCredentialInfoBatch(state.items, {
          manageBusy: true,
          showDialog: false,
          silentLog: !!currentOptions.silentLog,
          silentToast: !!currentOptions.silentToast,
          silentEmpty: true,
          progressText: currentOptions.progressText || "正在同步凭证信息…"
        });
        var quotaResult;

        if (!state.items.length) {
          markAutoRefreshSuccess({
            triggerSource: currentOptions.triggerSource,
            autoRefreshMode: currentSettings.autoRefreshMode,
            autoRefreshInterval: currentSettings.interval
          });
          return { total: 0 };
        }
        if (credentialResult == null) {
          markAutoRefreshFailure({
            triggerSource: currentOptions.triggerSource,
            autoRefreshMode: currentSettings.autoRefreshMode,
            autoRefreshInterval: currentSettings.interval
          }, new Error("同步凭证信息失败"));
          return null;
        }

        quotaResult = await loadQuotasBatch(state.items, {
          includeUsage: false,
          silentLog: !!currentOptions.silentLog,
          silentToast: !!currentOptions.silentToast,
          pendingType: ""
        });
        if (quotaResult == null) {
          markAutoRefreshFailure({
            triggerSource: currentOptions.triggerSource,
            autoRefreshMode: currentSettings.autoRefreshMode,
            autoRefreshInterval: currentSettings.interval
          }, new Error("刷新额度失败"));
          return null;
        }

        markAutoRefreshSuccess({
          triggerSource: currentOptions.triggerSource,
          autoRefreshMode: currentSettings.autoRefreshMode,
          autoRefreshInterval: currentSettings.interval
        });
        return quotaResult;
      }

      if (currentSettings.autoRefreshMode === AUTO_REFRESH_MODES.CREDENTIALS) {
        var result = await syncCredentialInfoBatch(state.items, {
          manageBusy: true,
          showDialog: false,
          silentLog: !!currentOptions.silentLog,
          silentToast: !!currentOptions.silentToast,
          silentEmpty: true,
          progressText: currentOptions.progressText || "正在同步凭证信息…"
        });

        if (!state.items.length) {
          markAutoRefreshSuccess({
            triggerSource: currentOptions.triggerSource,
            autoRefreshMode: currentSettings.autoRefreshMode,
            autoRefreshInterval: currentSettings.interval
          });
          return { ok: 0, fail: 0 };
        }
        if (result == null) {
          markAutoRefreshFailure({
            triggerSource: currentOptions.triggerSource,
            autoRefreshMode: currentSettings.autoRefreshMode,
            autoRefreshInterval: currentSettings.interval
          }, new Error("同步凭证信息失败"));
          return null;
        }

        markAutoRefreshSuccess({
          triggerSource: currentOptions.triggerSource,
          autoRefreshMode: currentSettings.autoRefreshMode,
          autoRefreshInterval: currentSettings.interval
        });
        return result;
      }

      return loadFiles(Object.assign({}, currentOptions, {
        pendingType: "",
        autoRefreshMode: currentSettings.autoRefreshMode,
        autoRefreshInterval: currentSettings.interval
      }));
    } finally {
      if (pendingType) {
        finishPending(pendingType, pendingKey);
      }
    }
  }

  async function runCurrentAutoRefreshMode() {
    var currentSettings = normalizedSettings(settings);

    log("开始按当前自动刷新模式立即执行一次：" + autoRefreshModeLabel(currentSettings.autoRefreshMode) + "。");
    return executeCurrentAutoRefreshMode({
      settings: currentSettings,
      pendingType: "run-auto-refresh-now",
      silentLog: false,
      silentToast: false,
      silentErrorToast: false
    });
  }

  function restartAutoRefresh(options) {
    var currentSettings = normalizedSettings(settings);

    clearAutoRefreshTimer();
    if (!currentSettings.autoRefresh) {
      clearAutoRefreshInfo();
      if (!options || !options.silent) {
        log("自动刷新已关闭。");
      }
      return;
    }

    // 每次重建定时器都先把下一次计划执行时间写出来，避免用户只能看到“已开启”却不知道还要等多久。
    updateAutoRefreshNextRun(currentSettings.interval);

    autoRefreshTimer = setInterval(function () {
      updateAutoRefreshNextRun(currentSettings.interval);
      if (!state.busy) {
        executeCurrentAutoRefreshMode({
          settings: currentSettings,
          silentToast: true,
          silentErrorToast: true,
          silentLog: true,
          triggerSource: "auto-refresh",
          progressText: "正在自动同步凭证信息…"
        });
      }
    }, currentSettings.interval * 60 * 1000);

    if (!options || !options.silent) {
      log("自动刷新已开启，间隔 " + currentSettings.interval + " 分钟，" + autoRefreshModeSummary(currentSettings.autoRefreshMode) + "。");
    }
  }

  function selectRow(key, checked) {
    state.selected = Object.assign({}, state.selected, {
      [key]: !!checked
    });
  }

  function togglePageSelection(checked, pageItems) {
    var next = Object.assign({}, state.selected);
    pageItems.forEach(function (item) {
      if (!item.runtimeOnly) {
        next[item.key] = !!checked;
      }
    });
    state.selected = next;
  }

  function isSelected(key) {
    return !!state.selected[key];
  }

  function clearSelectionKeys(keys) {
    var targetKeys = Array.isArray(keys) ? keys.filter(Boolean) : [];
    var next = Object.assign({}, state.selected);

    targetKeys.forEach(function (key) {
      delete next[key];
    });
    state.selected = next;
  }

  function clearSelection() {
    state.selected = {};
  }

  function openDetail(key) {
    ui.detailKey = key || "";
  }

  function closeDetail() {
    ui.detailKey = "";
  }

  async function openCredentialInfo(key) {
    ui.credentialDetailKey = key || "";
    if (!key) {
      return;
    }
    var item = state.items.filter(function (current) {
      return current.key === key;
    })[0];
    if (!item || !item.name) {
      return;
    }
    if (item.credentialInfoStatus === "success" && item.credentialText) {
      return;
    }
    await readCredentialInfo(key, {
      pendingType: "row-credential-info",
      silentLog: true,
      silentToast: true
    });
  }

  function closeCredentialInfo() {
    ui.credentialDetailKey = "";
  }

  var fileActions = useConsoleFileActions({
    api: api,
    state: state,
    settings: settings,
    ui: ui,
    uploadInputRef: uploadInputRef,
    currentClassifierOptions: currentClassifierOptions,
    currentTokenRefreshOptions: currentTokenRefreshOptions,
    persistCurrentSnapshot: persistCurrentSnapshot,
    updateItem: updateItem,
    reload: loadFiles,
    setBusy: setBusy,
    setProgress: setProgress,
    completeProgressTask: completeProgressTask,
    removeProgressTask: removeProgressTask,
    computeProgressPercent: computeProgressPercent,
    notify: notify,
    log: log,
    askConfirm: confirm.askConfirm,
    startPending: startPending,
    finishPending: finishPending,
    clearSelectionKeys: clearSelectionKeys,
    showOperationDialog: showOperationDialog,
    updateOperationDialog: updateOperationDialog,
    closeOperationDialog: closeOperationDialog
  });

  var collections = computed(function () {
    return createCollections(state);
  });

  var analyticsCollections = computed(function () {
    return collections.value;
  });

  var selectedStats = computed(function () {
    var selectedItems = state.items.filter(function (item) {
      return !!state.selected[item.key];
    });

    return {
      total: selectedItems.length,
      deletable: selectedItems.filter(function (item) { return !item.runtimeOnly; }).length,
      enableable: selectedItems.filter(function (item) { return item.disabled && !item.runtimeOnly; }).length,
      bad: selectedItems.filter(function (item) { return item.tone === "bad"; }).length
    };
  });

  var detailItem = computed(function () {
    return state.items.filter(function (item) {
      return item.key === ui.detailKey;
    })[0] || null;
  });

  var credentialDetailItem = computed(function () {
    return state.items.filter(function (item) {
      return item.key === ui.credentialDetailKey;
    })[0] || null;
  });

  watch(function () {
    return [
      settings.baseUrl,
      settings.interval,
      settings.showFilename,
      settings.autoRefresh,
      settings.autoRefreshMode,
      settings.lowQuotaThreshold,
      settings.quotaConcurrency,
      settings.quotaRequestIntervalSeconds,
      settings.tokenRefreshConcurrency,
      settings.tokenRefreshIntervalSeconds
    ].join("::");
  }, function () {
    writeLocalSettings();
  });

  watch(function () {
    return integrationSettings.wenfxlOpenaiUrl;
  }, function () {
    writeLocalIntegrationSettings();
  });

  watch(function () {
    return String(settings.lowQuotaThreshold || "");
  }, function () {
    if (bootstrapped.value && state.items.length) {
      rescan();
    }
  });

  watch(function () {
    return settings.autoRefresh + "::" + settings.interval + "::" + settings.autoRefreshMode;
  }, function () {
    if (bootstrapped.value) {
      restartAutoRefresh();
    }
  });

  watch(function () {
    return String(settings.baseUrl || "").trim() + "::" + String(settings.key || "").trim();
  }, function (value) {
    if (!value || value === "::") {
      resetServiceState();
      resetUsageCenter();
    }
  });

  async function loadAppConfig() {
    try {
      var response = await fetch("/api/app-config");
      appConfig.value = await response.json();
    } catch (_) {
      appConfig.value = { management: {}, integrations: {} };
    }
    Object.assign(settings, readSettings(appConfig.value));
    Object.assign(integrationSettings, readIntegrationSettings(appConfig.value));
  }

  async function initialize() {
    // 初始化顺序固定为：加载配置 -> 恢复快照 -> 启动自动刷新 -> 设置初始可见状态。
    await loadAppConfig();
    var snapshot = readSnapshot(normalizedSettings(settings).baseUrl);
    var restored = restoreSnapshot(snapshot);
    bootstrapped.value = true;
    restartAutoRefresh({ silent: true });
    resetServiceState();

    if (restored) {
      state.statusText = normalizedSettings(settings).key
        ? "已恢复上次缓存，等待手动刷新"
        : "已恢复上次缓存，当前未填写 Key";
      log("已恢复上次加载的缓存数据，共 " + snapshot.items.length + " 个账号" + (snapshot.savedAt ? ("，缓存时间 " + snapshot.savedAt) : "") + "。");
      return;
    }

    if (normalizedSettings(settings).baseUrl && normalizedSettings(settings).key) {
      state.statusText = "配置已载入，等待手动刷新";
      log("页面已载入配置，请按需手动刷新文件列表或额度。");
      return;
    }

    log("先填写管理地址和 Management Key，再开始拉取真实额度。");
  }

  onBeforeUnmount(function () {
    clearAutoRefreshTimer();
  });

  return {
    appConfig: appConfig,
    settings: settings,
    integrationSettings: integrationSettings,
    state: state,
    ui: ui,
    operationDialog: ui.operationDialog,
    service: service,
    usageCenter: usageCenter,
    uploadInputRef: uploadInputRef,
    confirmDialog: confirm.dialog,
    collections: collections,
    analyticsCollections: analyticsCollections,
    selectedStats: selectedStats,
    detailItem: detailItem,
    credentialDetailItem: credentialDetailItem,
    initialize: initialize,
    loadFiles: loadFiles,
    loadAll: loadAll,
    refreshAllQuotas: refreshAllQuotas,
    refreshDisabledQuotas: refreshDisabledQuotas,
    refreshSelectedQuotas: refreshSelectedQuotas,
    refreshSelectedCredentialInfo: refreshSelectedCredentialInfo,
    loadUsageEvents: loadUsageEvents,
    exportUsageSnapshot: exportUsageSnapshot,
    refreshServiceState: refreshServiceState,
    updateServiceFlag: updateServiceFlag,
    saveServiceProxy: saveServiceProxy,
    clearServiceProxy: clearServiceProxy,
    saveRetrySettings: saveRetrySettings,
    saveDefaultSettings: saveDefaultSettings,
    saveIntegrationSettings: saveIntegrationSettings,
    rescan: rescan,
    runCurrentAutoRefreshMode: runCurrentAutoRefreshMode,
    deleteItems: fileActions.deleteItems,
    setItemsDisabled: fileActions.setItemsDisabled,
    refreshOne: fileActions.refreshOne,
    revive401Item: fileActions.revive401Item,
    reviveSelected401: fileActions.reviveSelected401,
    refreshCredentialOne: fileActions.refreshCredentialOne,
    refreshSelectedCredentials: fileActions.refreshSelectedCredentials,
    disableQuotaRelated: fileActions.disableQuotaRelated,
    deleteSelected: fileActions.deleteSelected,
    disableSelected: fileActions.disableSelected,
    enableSelected: fileActions.enableSelected,
    openUploadPicker: fileActions.openUploadPicker,
    handleUploadFiles: fileActions.handleUploadFiles,
    handleUploadChange: fileActions.handleUploadChange,
    setFileDisabled: fileActions.setFileDisabled,
    deleteFile: fileActions.deleteFile,
    copyName: fileActions.copyName,
    selectRow: selectRow,
    togglePageSelection: togglePageSelection,
    isSelected: isSelected,
    clearSelection: clearSelection,
    openDetail: openDetail,
    closeDetail: closeDetail,
    openCredentialInfo: openCredentialInfo,
    closeCredentialInfo: closeCredentialInfo,
    readCredentialInfo: readCredentialInfo,
    closeOperationDialog: closeOperationDialog,
    notify: notify,
    log: log,
    dismissToast: dismissToast,
    isPending: isPending,
    hasPending: hasPending,
    confirmAction: confirm.confirm,
    cancelConfirm: confirm.cancel
  };
}
