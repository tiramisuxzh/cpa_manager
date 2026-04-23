import { FIVE_HOUR, WEEK } from "./constants.js";
import { avg, isNum, now, parseBody, selectSecondaryWindow, selectWindow, sessionQuotaValues } from "./utils.js";

var HTTP_OK = 200;
var HTTP_UNAUTHORIZED = 401;

function normalizeStatusCode(value) {
  var code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function badReasonLabel(group, code) {
  if (group === "quota") {
    if (code === "quota-both") {
      return "对话/代码额度已用尽";
    }
    if (code === "quota-chat") {
      return "对话额度已用尽";
    }
    if (code === "quota-code") {
      return "代码审查额度已用尽";
    }
    if (code === "spend-control") {
      return "消费控制已触发";
    }
    if (code === "overage-limit") {
      return "超额额度已达上限";
    }
    return "额度相关异常";
  }
  if (group === "auth-401") {
    return "401 认证异常";
  }
  if (group === "non-quota") {
    return code && code.indexOf("http-") === 0 ? "接口异常" : "其他异常";
  }
  return "";
}

function extractPayloadMessage(value) {
  var text;
  var parsed;

  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    text = String(value).trim();
    if (!text) {
      return "";
    }
    try {
      parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return extractPayloadMessage(parsed.message || parsed.error || parsed.detail || parsed.type) || text;
      }
    } catch (_) {
      return text;
    }
    return text;
  }
  if (typeof value === "object") {
    return extractPayloadMessage(value.message || value.error || value.detail || value.type) || stringifyPayloadDetail(value);
  }
  return String(value);
}

function stringifyPayloadDetail(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return String(value).trim();
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function normalizeClassifierOptions(input) {
  var lowQuotaThreshold;

  if (!input || input instanceof RegExp) {
    return {
      lowQuotaThreshold: 20
    };
  }

  lowQuotaThreshold = parseInt(input.lowQuotaThreshold, 10);
  return {
    lowQuotaThreshold: Math.max(0, Math.min(100, Number.isNaN(lowQuotaThreshold) ? 20 : lowQuotaThreshold))
  };
}

function readFlag(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  value = String(value).trim().toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return null;
}

function quotaLimitReached(limit) {
  if (!limit || typeof limit !== "object") {
    return false;
  }
  return readFlag(limit.allowed) === false || readFlag(limit.limit_reached) === true || readFlag(limit.limitReached) === true;
}

function lowQuotaSignals(chatQuota, chatQuotaSecondary, codeQuota, threshold) {
  return {
    lowChat: !!(
      (chatQuota && chatQuota.left != null && chatQuota.left <= threshold)
      || (chatQuotaSecondary && chatQuotaSecondary.left != null && chatQuotaSecondary.left <= threshold)
    ),
    lowCode: !!(codeQuota && codeQuota.left != null && codeQuota.left <= threshold)
  };
}

function buildQuotaBadState(payload, chatBlocked, codeBlocked) {
  var spendControlReached = !!(payload && payload.spend_control && readFlag(payload.spend_control.reached));
  var overageLimitReached = !!(payload && payload.credits && readFlag(payload.credits.overage_limit_reached));

  if (chatBlocked && codeBlocked) {
    return {
      code: "quota-both",
      label: "对话/代码额度已用尽",
      reason: "对话周额度与代码审查周额度均已用尽，等待重置后恢复。"
    };
  }
  if (chatBlocked) {
    return {
      code: "quota-chat",
      label: "对话额度已用尽",
      reason: "对话额度已用尽，等待重置后恢复。"
    };
  }
  if (codeBlocked) {
    return {
      code: "quota-code",
      label: "代码审查额度已用尽",
      reason: "代码审查额度已用尽，等待重置后恢复。"
    };
  }
  if (spendControlReached) {
    return {
      code: "spend-control",
      label: "消费控制已触发",
      reason: "消费控制已触发，当前无法继续发起额度相关请求。"
    };
  }
  if (overageLimitReached) {
    return {
      code: "overage-limit",
      label: "超额额度已达上限",
      reason: "超额额度已达上限，当前无法继续使用额外额度。"
    };
  }
  return null;
}

function buildWarnState(chatQuota, chatQuotaSecondary, codeQuota, threshold) {
  var signals = lowQuotaSignals(chatQuota, chatQuotaSecondary, codeQuota, threshold);

  if (signals.lowChat && signals.lowCode) {
    return {
      code: "warn-both",
      label: "双额度预警",
      reason: "对话周额度与代码审查周额度都低于等于预警阈值（<= " + threshold + "%）。"
    };
  }
  if (signals.lowChat) {
    return {
      code: "warn-chat",
      label: "对话额度预警",
      reason: "对话额度低于等于预警阈值（<= " + threshold + "%）。"
    };
  }
  if (signals.lowCode) {
    return {
      code: "warn-code",
      label: "代码审查额度预警",
      reason: "代码审查额度低于等于预警阈值（<= " + threshold + "%）。"
    };
  }
  return null;
}

function buildRequestStatusText(statusCode) {
  if (statusCode == null) {
    return "等待请求";
  }
  return statusCode === HTTP_OK ? "接口正常 (200)" : ("接口异常 (" + statusCode + ")");
}

function extractPromoMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if (payload.promo && payload.promo.message) {
    return extractPayloadMessage(payload.promo.message);
  }
  return "";
}

function normalizeErrorInput(input) {
  var statusCode;
  var payload;
  var rawMessage;
  var message;

  if (typeof input === "string") {
    return {
      statusCode: null,
      message: String(input).trim(),
      rawMessage: String(input).trim()
    };
  }

  statusCode = normalizeStatusCode(input && input.statusCode);
  payload = input && input.payload != null ? input.payload : null;
  rawMessage = input && input.rawMessage != null ? input.rawMessage : payload;
  message = extractPayloadMessage(
    input && input.message != null
      ? input.message
      : (payload && (payload.message != null ? payload.message : (payload.error != null ? payload.error : payload)))
  );

  return {
    statusCode: statusCode,
    message: message || "额度接口返回异常",
    rawMessage: stringifyPayloadDetail(rawMessage) || message || "额度接口返回异常"
  };
}

function buildHealthyState() {
  return {
    tone: "good",
    health: "健康",
    quotaStateCode: "healthy",
    quotaStateLabel: "额度正常",
    badReasonGroup: "",
    badReasonCode: "",
    badReasonLabel: "",
    reason: "额度正常"
  };
}

export function addLog(state, message, bad) {
  state.logs.unshift({ time: now(), msg: message, bad: !!bad });
  state.logs = state.logs.slice(0, 120);
}

export function allQuotaLoaded(state) {
  return state.progress.total > 0 && state.progress.done >= state.progress.total;
}

export function averageSessionLeftPercent(state) {
  var usable = state.items.filter(function (item) {
    return item.tone !== "bad" && sessionQuotaValues(item).length;
  }).map(function (item) {
    return Math.min.apply(Math, sessionQuotaValues(item));
  });
  return usable.length ? avg(usable) : null;
}

export function baseItem(file, index) {
  var token = file.id_token || {};
  var email = file.email || file.account || file.label || file.name || ("item-" + index);
  return {
    key: (file.name || file.id || email) + "::" + index,
    raw: file,
    name: file.name || file.id || "",
    email: email,
    authIndex: file.auth_index || file.authIndex || "",
    accountId: token.chatgpt_account_id || token.chatgptAccountId || "",
    provider: String(file.provider || file.type || "codex").toLowerCase(),
    accountType: file.account_type || file.accountType || "",
    status: String(file.status || "unknown").toLowerCase(),
    statusMessage: String(file.status_message || file.statusMessage || "").trim(),
    disabled: !!file.disabled,
    unavailable: !!file.unavailable,
    runtimeOnly: !!file.runtime_only || !!file.runtimeOnly,
    lastRefresh: file.last_refresh || file.lastRefresh || "",
    updatedAt: file.updated_at || file.updatedAt || file.modtime || "",
    planType: token.plan_type || token.planType || "unknown",
    quotaStatus: "idle",
    quotaStatusCode: null,
    quotaError: "",
    requestStatusText: "等待请求",
    quotaStateCode: "idle",
    quotaStateLabel: "等待额度",
    chatQuota: null,
    chatQuotaSecondary: null,
    codeQuota: null,
    rawQuotaMessage: "",
    usageSuccessCount: null,
    usageFailureCount: null,
    promoMessage: "",
    tone: "good",
    health: "待获取",
    badReasonGroup: "",
    badReasonCode: "",
    badReasonLabel: "",
    reason: "等待拉取额度详情。"
  };
}

export function enrichItem(item, result, classifierOptions) {
  var options = normalizeClassifierOptions(classifierOptions);
  var statusCode = normalizeStatusCode(result && result.status_code) || HTTP_OK;
  var payload = parseBody(result && result.body);
  var chat = payload.rate_limit || payload.rateLimit || null;
  var code = payload.code_review_rate_limit || payload.codeReviewRateLimit || null;
  var chatQuota = selectWindow(chat);
  var chatQuotaSecondary = selectSecondaryWindow(chat);
  var codeQuota = selectWindow(code);
  var chatBlocked = quotaLimitReached(chat);
  var codeBlocked = quotaLimitReached(code);
  var promoMessage = extractPromoMessage(payload);
  var warnState;
  var badState;

  // 额度接口 wrapper 返回 200 代表请求成功，其余 status_code 都视为接口异常，并展示 body 里的 message。
  if (statusCode !== HTTP_OK) {
    return enrichError(item, {
      statusCode: statusCode,
      payload: payload
    });
  }

  badState = buildQuotaBadState(payload, chatBlocked, codeBlocked);
  warnState = buildWarnState(chatQuota, chatQuotaSecondary, codeQuota, options.lowQuotaThreshold);

  if (badState) {
    return Object.assign({}, item, {
      quotaStatus: "success",
      quotaStatusCode: HTTP_OK,
      quotaError: "",
      requestStatusText: buildRequestStatusText(HTTP_OK),
      quotaStateCode: badState.code,
      quotaStateLabel: badState.label,
      planType: payload.plan_type || payload.planType || item.planType,
      chatQuota: chatQuota,
      chatQuotaSecondary: chatQuotaSecondary,
      codeQuota: codeQuota,
      rawQuotaMessage: "",
      promoMessage: promoMessage,
      tone: "bad",
      health: "异常",
      badReasonGroup: "quota",
      badReasonCode: badState.code,
      badReasonLabel: badReasonLabel("quota", badState.code),
      reason: badState.reason
    });
  }

  if (warnState) {
    return Object.assign({}, item, {
      quotaStatus: "success",
      quotaStatusCode: HTTP_OK,
      quotaError: "",
      requestStatusText: buildRequestStatusText(HTTP_OK),
      quotaStateCode: warnState.code,
      quotaStateLabel: warnState.label,
      planType: payload.plan_type || payload.planType || item.planType,
      chatQuota: chatQuota,
      chatQuotaSecondary: chatQuotaSecondary,
      codeQuota: codeQuota,
      rawQuotaMessage: "",
      promoMessage: promoMessage,
      tone: "warn",
      health: "告警",
      badReasonGroup: "",
      badReasonCode: "",
      badReasonLabel: "",
      reason: warnState.reason
    });
  }

  return Object.assign({}, item, buildHealthyState(), {
    quotaStatus: "success",
    quotaStatusCode: HTTP_OK,
    quotaError: "",
    requestStatusText: buildRequestStatusText(HTTP_OK),
    planType: payload.plan_type || payload.planType || item.planType,
    chatQuota: chatQuota,
    chatQuotaSecondary: chatQuotaSecondary,
    codeQuota: codeQuota,
    rawQuotaMessage: "",
    promoMessage: promoMessage
  });
}

export function enrichError(item, errorInput) {
  var errorState = normalizeErrorInput(errorInput);
  var group = errorState.statusCode === HTTP_UNAUTHORIZED ? "auth-401" : "non-quota";
  var code = errorState.statusCode === HTTP_UNAUTHORIZED
    ? "http-401"
    : (errorState.statusCode ? ("http-" + errorState.statusCode) : "request-error");
  var label = badReasonLabel(group, code);

  return Object.assign({}, item, {
    quotaStatus: "error",
    quotaStatusCode: errorState.statusCode,
    quotaError: errorState.message || "额度接口返回异常",
    requestStatusText: buildRequestStatusText(errorState.statusCode),
    quotaStateCode: group === "auth-401" ? "auth-401" : "http-error",
    quotaStateLabel: group === "auth-401" ? "401 认证异常" : label,
    rawQuotaMessage: errorState.rawMessage,
    tone: "bad",
    health: "异常",
    badReasonGroup: group,
    badReasonCode: code,
    badReasonLabel: label,
    reason: errorState.message || "额度接口返回异常"
  });
}

export function reclassifyItem(item, classifierOptions) {
  if (item.quotaStatus === "success") {
    return enrichItem(item, {
      status_code: item.quotaStatusCode || HTTP_OK,
      body: {
        plan_type: item.planType,
        rate_limit: item.chatQuota ? {
          allowed: !(item.badReasonCode === "quota-chat" || item.badReasonCode === "quota-both"),
          limit_reached: item.badReasonCode === "quota-chat" || item.badReasonCode === "quota-both",
          primary_window: {
            used_percent: item.chatQuota.used,
            reset_at: item.chatQuota.resetAt,
            limit_window_seconds: item.chatQuota.label === "周窗口" ? WEEK : FIVE_HOUR
          },
          secondary_window: item.chatQuotaSecondary ? {
            used_percent: item.chatQuotaSecondary.used,
            reset_at: item.chatQuotaSecondary.resetAt,
            limit_window_seconds: item.chatQuotaSecondary.label === "周窗口" ? WEEK : FIVE_HOUR
          } : null
        } : null,
        code_review_rate_limit: item.codeQuota ? {
          allowed: !(item.badReasonCode === "quota-code" || item.badReasonCode === "quota-both"),
          limit_reached: item.badReasonCode === "quota-code" || item.badReasonCode === "quota-both",
          primary_window: {
            used_percent: item.codeQuota.used,
            reset_at: item.codeQuota.resetAt,
            limit_window_seconds: item.codeQuota.label === "周窗口" ? WEEK : FIVE_HOUR
          }
        } : null,
        promo: item.promoMessage ? { message: item.promoMessage } : null,
        spend_control: item.badReasonCode === "spend-control" ? { reached: true } : { reached: false },
        credits: item.badReasonCode === "overage-limit" ? { overage_limit_reached: true } : { overage_limit_reached: false }
      }
    }, classifierOptions);
  }

  if (item.quotaStatus === "error") {
    return enrichError(item, {
      statusCode: item.quotaStatusCode,
      message: item.quotaError || item.reason,
      rawMessage: item.rawQuotaMessage || item.quotaError || item.reason
    });
  }

  return item;
}
