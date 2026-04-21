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

  return {
    baseUrl: String(settings.baseUrl || "").trim().replace(/\/+$/, ""),
    key: String(settings.key || "").trim(),
    interval: Math.max(1, parseInt(settings.interval, 10) || 10),
    showFilename: !!settings.showFilename,
    autoRefresh: !!settings.autoRefresh,
    autoRefreshMode: normalizeAutoRefreshMode(settings.autoRefreshMode),
    lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold)),
    quotaConcurrency: Math.max(1, Math.min(20, Number.isNaN(quotaConcurrency) ? 6 : quotaConcurrency)),
    quotaRequestIntervalSeconds: Math.max(0, Math.min(30, Number.isNaN(quotaRequestIntervalSeconds) ? 0 : quotaRequestIntervalSeconds))
  };
}

function normalizedIntegrationSettings(settings) {
  return {
    wenfxlOpenaiUrl: String(settings.wenfxlOpenaiUrl || "").trim()
  };
}

function autoRefreshModeSummary(mode) {
  if (mode === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
    return "同步文件列表并刷新额度";
  }

  return "仅同步文件列表";
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
    progressVisible: false,
    progressText: "等待任务开始…",
    progressPercent: 0
  });
  var ui = reactive({
    detailKey: "",
    pendingMap: {}
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
  var computeProgressPercent = feedback.computeProgressPercent;
  var setStatus = feedback.setStatus;

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

  function clearAutoRefreshTimer() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
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
      planType: previousItem.planType || nextItem.planType,
      quotaStatus: previousItem.quotaStatus || "idle",
      quotaStatusCode: previousItem.quotaStatusCode == null ? null : previousItem.quotaStatusCode,
      quotaError: previousItem.quotaError || "",
      requestStatusText: previousItem.requestStatusText || "等待请求",
      quotaStateCode: previousItem.quotaStateCode || "idle",
      quotaStateLabel: previousItem.quotaStateLabel || "等待额度",
      chatQuota: previousItem.chatQuota || null,
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
      setProgress("正在同步服务设置与运行状态…", 18);
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
    } catch (error) {
      log("同步服务设置失败：" + (error.message || "未知错误"), true);
      if (!currentOptions.silentToast) {
        notify("同步服务设置失败。", "danger", 3200);
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

    if (!current) {
      return;
    }

    startPending("service-flags", key);
    setBusy(true);
    setProgress("正在更新" + current.label + "…", 34);

    try {
      await api.setManagementValue(current.path, !!value);
      service[key] = !!value;
      service.lastSyncAt = new Date().toLocaleString("zh-CN", { hour12: false });

      log(current.label + "已" + (value ? "开启" : "关闭") + "。");
      notify(current.label + "已" + (value ? "开启" : "关闭") + "。", "success");
    } catch (error) {
      log(current.label + "更新失败：" + (error.message || "未知错误"), true);
      notify(current.label + "更新失败。", "danger", 3200);
    } finally {
      setBusy(false);
      finishPending("service-flags", key);
    }
  }

  async function saveServiceProxy() {
    var value = String(service.proxyUrl || "").trim();

    startPending("service-proxy", "save");
    setBusy(true);
    setProgress("正在保存代理地址…", 38);

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
    } catch (error) {
      log("保存代理地址失败：" + (error.message || "未知错误"), true);
      notify("保存代理地址失败。", "danger", 3200);
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

    startPending("service-retry", "save");
    setBusy(true);
    setProgress("正在保存重试策略…", 42);

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
    } catch (error) {
      log("保存重试策略失败：" + (error.message || "未知错误"), true);
      notify("保存重试策略失败。", "danger", 3200);
    } finally {
      setBusy(false);
      finishPending("service-retry", "save");
    }
  }

  async function saveDefaultSettings() {
    var nextManagement = normalizedSettings(settings);

    startPending("save-default-settings");
    setBusy(true);
    setProgress("正在保存默认配置…", 36);

    try {
      // 设置页的“保存默认配置”只把当前 management 配置回写到 app-config.json，页面本地缓存逻辑保持不变。
      var savedConfig = await api.saveDefaultManagementConfig(nextManagement);

      appConfig.value = Object.assign({}, appConfig.value, savedConfig || {}, {
        management: Object.assign({}, nextManagement)
      });
      log("已将当前管理台配置保存为默认配置。");
      notify("默认配置已保存到 app-config.json。", "success");
    } catch (error) {
      log("保存默认配置失败：" + (error.message || "未知错误"), true);
      notify("保存默认配置失败。", "danger", 3200);
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

    startPending("save-integration-settings");
    setBusy(true);
    setProgress("正在保存集成配置…", 36);

    try {
      // 集成配置与 management 默认值分开保存，避免不同设置页之间互相覆盖。
      var savedConfig = await api.saveDefaultIntegrationConfig(nextIntegrations);

      appConfig.value = Object.assign({}, appConfig.value, savedConfig || {}, {
        integrations: Object.assign({}, nextIntegrations)
      });
      log("已将当前外部集成配置保存为默认配置。");
      notify("集成配置已保存到 app-config.json。", "success");
    } catch (error) {
      log("保存集成配置失败：" + (error.message || "未知错误"), true);
      notify("保存集成配置失败。", "danger", 3200);
    } finally {
      setBusy(false);
      finishPending("save-integration-settings");
    }
  }

  async function loadQuotas(refreshId, options) {
    var currentOptions = options || {};
    var classifierOptions = currentClassifierOptions();
    var quotaRequestOptions = currentQuotaRequestOptions();
    var list = Array.isArray(currentOptions.items)
      ? currentOptions.items.filter(function (item) { return item && item.authIndex && item.accountId; })
      : state.items.filter(function (item) { return item.authIndex && item.accountId; });
    var total = list.length;
    var done = 0;
    var cursor = 0;

    setStatus(0, total);
    if (!total) {
      if (!currentOptions.silentLog) {
        log(currentOptions.emptyLog || "当前没有可拉取额度的 Codex 账号，已跳过额度刷新。");
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
        setStatus(done, total);
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
    if (refreshId === state.refreshId) {
      persistCurrentSnapshot();
      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("额度刷新完成，共处理 " + total + " 个账号。"));
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

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    setBusy(true);
    setProgress(currentOptions.progressLabel || "正在同步请求事件明细…", 18);

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
      return usageCenter.events;
    } catch (error) {
      usageCenter.error = error.message || "请求事件明细同步失败";
      log("请求事件明细同步失败：" + (error.message || "未知错误"), true);
      if (!currentOptions.silentToast) {
        notify("请求事件明细同步失败。", "danger", 3200);
      }
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

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    writeLocalSettings();
    setBusy(true);
    setProgress(currentOptions.progressLabel || "正在拉取认证文件列表…", 12);
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
        return;
      }

      applyAuthFiles(files);
      state.statusText = state.items.length
        ? ("文件列表已同步 · 共 " + state.items.length + " 个账号")
        : "文件列表已同步，当前没有 Codex 账号";
      setProgress(currentOptions.finishProgressText || "文件列表同步完成。", 100);

      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("认证文件列表已同步，共 " + state.items.length + " 个 Codex 账号。"));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.completeToast || ("文件列表已同步，当前共 " + state.items.length + " 个 Codex 账号。"), "success");
      }
    } catch (error) {
      state.statusText = "文件列表拉取失败，请检查连接";
      if (!currentOptions.silentLog) {
        log("文件列表刷新失败：" + (error.message || "未知错误"), true);
      }
      if (!currentOptions.silentErrorToast) {
        notify("文件列表刷新失败，请检查管理地址与 Management Key。", "danger", 3200);
      }
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
    setProgress(currentOptions.progressLabel || "正在准备刷新额度…", 12);
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
            silentLog: true
          })
        ]);
      } else {
        await loadQuotas(refreshId, {
          items: targetList,
          silentLog: true
        });
      }

      if (refreshId !== state.refreshId) {
        return null;
      }

      if (!currentOptions.silentLog) {
        log(currentOptions.completeLog || ("额度刷新完成，共处理 " + targetList.length + " 个账号。"));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.completeToast || ("额度刷新完成，共处理 " + targetList.length + " 个账号。"), "success");
      }
      return { total: targetList.length };
    } catch (error) {
      log((currentOptions.failLogPrefix || "额度刷新失败：") + (error.message || "未知错误"), true);
      notify(currentOptions.failToast || "额度刷新失败，请检查连接。", "danger", 3200);
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

    return loadQuotasBatch(selectedItems, Object.assign({
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

  async function loadAll(options) {
    var currentOptions = options || {};
    var pendingType = currentOptions.pendingType || "";
    var includeUsage = currentOptions.includeUsage !== false;

    if (pendingType) {
      startPending(pendingType, currentOptions.pendingKey || "");
    }

    writeLocalSettings();
    setBusy(true);
    setProgress(includeUsage ? "正在同步文件列表、请求统计与额度…" : "正在同步文件列表与额度…", 8);
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
        return;
      }

      applyAuthFiles(files);
      if (!currentOptions.silentLog) {
        log("认证文件已载入，Codex 账号 " + state.items.length + " 个，开始拉取" + (includeUsage ? "请求统计与额度明细。" : "额度明细。"));
      }

      if (includeUsage) {
        await Promise.all([
          loadUsageStats(refreshId),
          loadQuotas(refreshId, {
            items: state.items,
            silentLog: true
          })
        ]);
      } else {
        await loadQuotas(refreshId, {
          items: state.items,
          silentLog: true
        });
      }

      if (refreshId !== state.refreshId) {
        return;
      }

      if (!currentOptions.silentLog) {
        log((includeUsage ? "文件、请求统计与额度同步完成，共处理 " : "文件与额度同步完成，共处理 ") + state.items.length + " 个账号。");
      }
      if (!currentOptions.silentToast) {
        notify((includeUsage ? "文件、请求统计与额度同步完成，当前共 " : "文件与额度同步完成，当前共 ") + state.items.length + " 个 Codex 账号。", "success");
      }
    } catch (error) {
      state.statusText = "同步失败，请检查连接";
      if (!currentOptions.silentLog) {
        log("同步失败：认证文件或额度加载异常，" + (error.message || "未知错误"), true);
      }
      if (!currentOptions.silentErrorToast) {
        notify("同步失败，请检查管理地址与 Management Key。", "danger", 3200);
      }
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

  function restartAutoRefresh(options) {
    var currentSettings = normalizedSettings(settings);

    clearAutoRefreshTimer();
    if (!currentSettings.autoRefresh) {
      if (!options || !options.silent) {
        log("自动刷新已关闭。");
      }
      return;
    }

    autoRefreshTimer = setInterval(function () {
      if (!state.busy) {
        if (currentSettings.autoRefreshMode === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
          // 自动刷新走“文件 + 额度”时，只补齐用户关心的两类数据，不额外触发 usage 明细同步。
          loadAll({
            includeUsage: false,
            silentToast: true,
            silentErrorToast: true,
            silentLog: true
          });
          return;
        }

        loadFiles({
          silentToast: true,
          silentErrorToast: true,
          silentLog: true
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

  function clearSelection() {
    state.selected = {};
  }

  function openDetail(key) {
    ui.detailKey = key || "";
  }

  function closeDetail() {
    ui.detailKey = "";
  }

  var fileActions = useConsoleFileActions({
    api: api,
    state: state,
    settings: settings,
    uploadInputRef: uploadInputRef,
    currentClassifierOptions: currentClassifierOptions,
    persistCurrentSnapshot: persistCurrentSnapshot,
    updateItem: updateItem,
    reload: loadFiles,
    setBusy: setBusy,
    setProgress: setProgress,
    computeProgressPercent: computeProgressPercent,
    notify: notify,
    log: log,
    askConfirm: confirm.askConfirm,
    startPending: startPending,
    finishPending: finishPending
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

  watch(function () {
    return [
      settings.baseUrl,
      settings.interval,
      settings.showFilename,
      settings.autoRefresh,
      settings.autoRefreshMode,
      settings.lowQuotaThreshold,
      settings.quotaConcurrency,
      settings.quotaRequestIntervalSeconds
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
    service: service,
    usageCenter: usageCenter,
    uploadInputRef: uploadInputRef,
    confirmDialog: confirm.dialog,
    collections: collections,
    analyticsCollections: analyticsCollections,
    selectedStats: selectedStats,
    detailItem: detailItem,
    initialize: initialize,
    loadFiles: loadFiles,
    loadAll: loadAll,
    refreshAllQuotas: refreshAllQuotas,
    refreshDisabledQuotas: refreshDisabledQuotas,
    refreshSelectedQuotas: refreshSelectedQuotas,
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
    deleteItems: fileActions.deleteItems,
    setItemsDisabled: fileActions.setItemsDisabled,
    refreshOne: fileActions.refreshOne,
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
    notify: notify,
    log: log,
    dismissToast: dismissToast,
    isPending: isPending,
    hasPending: hasPending,
    confirmAction: confirm.confirm,
    cancelConfirm: confirm.cancel
  };
}
