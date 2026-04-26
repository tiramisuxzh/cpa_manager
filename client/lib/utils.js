import { AUTH_TIMELINE_HINTS, EMPTY_PLAN_TYPE_FILTER, FIVE_HOUR, POOL_SORT_MODES, WEEK } from "./constants.js";

export function now() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

export function avg(list) {
  return list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null;
}

export function isNum(value) {
  return value != null && !Number.isNaN(value);
}

export function toNum(value) {
  var num = Number(value);
  return Number.isNaN(num) ? null : num;
}

export function clamp(value) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  var rounded = Math.round(Number(value));
  return Math.max(0, Math.min(100, rounded));
}

export function parseDate(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "number") {
    var secondsDate = new Date(value * 1000);
    if (!Number.isNaN(secondsDate.getTime())) {
      return secondsDate;
    }
    var directDate = new Date(value);
    return Number.isNaN(directDate.getTime()) ? null : directDate;
  }
  var text = String(value).trim();
  if (!text) {
    return null;
  }
  var parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateTimeValue(value) {
  var parsed = parseDate(value);
  return parsed ? parsed.getTime() : null;
}

export function fmt(value, full) {
  var date = parseDate(value);
  var options = arguments[2] || {};

  if (!date) {
    return "未知";
  }
  return date.toLocaleString(
    "zh-CN",
    Object.assign(
      {},
      full
        ? { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
        : { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
      options.withSeconds ? { second: "2-digit" } : {},
      options.timeZone ? { timeZone: options.timeZone } : {}
    )
  );
}

export function rawTimeText(value) {
  if (value == null) {
    return "未知";
  }
  if (typeof value === "string") {
    return String(value).trim() || "未知";
  }
  return String(value);
}

export function parseBody(body) {
  if (body == null) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (_) {
      return { raw_text: body };
    }
  }
  return body;
}

// 额度接口可能会返回主窗口、周窗口或兼容字段，这里统一整理成后续可直接展示的结构。
export function classify(limit) {
  if (!limit) {
    return { weekly: null, primary: null, secondary: null };
  }
  var primary = limit.primary_window || limit.primaryWindow || null;
  var secondary = limit.secondary_window || limit.secondaryWindow || null;
  var out = { weekly: null, primary: null, secondary: null };
  [primary, secondary].forEach(function (windowValue) {
    if (!windowValue) {
      return;
    }
    var seconds = toNum(windowValue.limit_window_seconds || windowValue.limitWindowSeconds);
    if (seconds === WEEK && !out.weekly) {
      out.weekly = windowValue;
    } else if (seconds === FIVE_HOUR && !out.primary) {
      out.primary = windowValue;
    }
  });
  if (!out.primary && primary) {
    out.primary = primary;
  }
  if (!out.secondary && secondary) {
    out.secondary = secondary;
  }
  if (!out.weekly && secondary && secondary !== out.primary) {
    out.weekly = secondary;
  }
  return out;
}

function normalizeWindow(windowValue) {
  var seconds;
  var rawUsed;
  var rawLeft;
  var used;
  var left;

  if (!windowValue) {
    return null;
  }

  seconds = toNum(
    windowValue.limit_window_seconds != null ? windowValue.limit_window_seconds : windowValue.limitWindowSeconds
  );
  rawUsed = toNum(windowValue.used_percent != null ? windowValue.used_percent : windowValue.usedPercent);
  rawLeft = rawUsed == null ? null : (100 - rawUsed);
  used = clamp(rawUsed);
  left = rawLeft == null ? null : clamp(rawLeft);

  return {
    label: seconds === WEEK ? "周窗口" : (seconds === FIVE_HOUR ? "5 小时窗口" : "主窗口"),
    usedRaw: rawUsed,
    used: used,
    leftRaw: rawLeft,
    left: left,
    resetAt: windowValue.reset_at != null ? windowValue.reset_at : (windowValue.resetAt != null ? windowValue.resetAt : null)
  };
}

export function selectWindow(limit) {
  var classified = classify(limit);
  var windowValue = classified.primary || classified.weekly || classified.secondary || null;
  return normalizeWindow(windowValue);
}

export function selectSecondaryWindow(limit) {
  var classified = classify(limit);
  var windowValue = null;

  if (classified.secondary && classified.secondary !== classified.primary) {
    windowValue = classified.secondary;
  } else if (classified.weekly && classified.weekly !== classified.primary) {
    windowValue = classified.weekly;
  }

  return normalizeWindow(windowValue);
}

function quotaEntryTitle(item, quota, fallback) {
  if (quota && quota.label === "5 小时窗口") {
    return "5 小时";
  }
  if (quota && quota.label === "周窗口") {
    return "周";
  }
  return fallback;
}

export function quotaEntries(item) {
  var entries = [];

  if (!item || typeof item !== "object") {
    return entries;
  }

  if (item.chatQuota) {
    entries.push({
      key: "chat-primary",
      title: quotaEntryTitle(item, item.chatQuota, "会话"),
      quota: item.chatQuota
    });
  }
  if (item.chatQuotaSecondary) {
    entries.push({
      key: "chat-secondary",
      title: quotaEntryTitle(item, item.chatQuotaSecondary, "周"),
      quota: item.chatQuotaSecondary
    });
  }
  if (item.codeQuota) {
    entries.push({
      key: "code",
      title: "代码",
      quota: item.codeQuota
    });
  }

  return entries;
}

export function quotaLeft(item) {
  var values = quotaEntries(item).map(function (entry) {
    return isNum(entry.quota && entry.quota.left) ? entry.quota.left : null;
  }).filter(function (value) {
    return value != null;
  });

  if (!values.length) {
    return null;
  }
  return Math.min.apply(Math, values);
}

export function quotaText(item) {
  var entries = quotaEntries(item);

  if (!entries.length) {
    return "等待额度返回";
  }

  return entries.map(function (entry) {
    return entry.title + " " + (isNum(entry.quota && entry.quota.left) ? (entry.quota.left + "%") : "--");
  }).join(" · ");
}

export function quotaResetText(item, full, joiner) {
  var entries = quotaEntries(item);
  var separator = joiner || " · ";
  var values = entries.reduce(function (result, entry) {
    if (entry.quota && entry.quota.resetAt) {
      result.push(entry.title + " " + fmt(entry.quota.resetAt, !!full));
    }
    return result;
  }, []);

  return values.length ? values.join(separator) : "等待返回";
}

export function quotaHintText(item) {
  var entries = quotaEntries(item);

  if (!entries.length) {
    return "等待窗口返回";
  }

  return entries.map(function (entry) {
    return entry.quota && entry.quota.label ? entry.quota.label : (entry.title + "窗口");
  }).join(" / ");
}

export function quotaMetricCards(item) {
  return quotaEntries(item).map(function (entry) {
    return {
      key: entry.key,
      title: entry.title + "剩余",
      value: isNum(entry.quota && entry.quota.left) ? (entry.quota.left + "%") : "--",
      subtitle: entry.quota && entry.quota.resetAt ? fmt(entry.quota.resetAt, true) : "等待返回"
    };
  });
}

export function planTypeFilterValue(item) {
  var value = String(item && item.planType ? item.planType : "").trim().toLowerCase();
  return value || EMPTY_PLAN_TYPE_FILTER;
}

export function buildPlanTypeOptions(items) {
  var seen = {};
  var values = [];

  (Array.isArray(items) ? items : []).forEach(function (item) {
    var value = planTypeFilterValue(item);
    if (seen[value]) {
      return;
    }
    seen[value] = true;
    values.push({
      value: value,
      label: value === EMPTY_PLAN_TYPE_FILTER ? "未标注" : value
    });
  });

  return values.sort(function (left, right) {
    if (left.value === EMPTY_PLAN_TYPE_FILTER) {
      return 1;
    }
    if (right.value === EMPTY_PLAN_TYPE_FILTER) {
      return -1;
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
}

export function sessionQuotaValues(item) {
  var values = [];
  if (item && item.chatQuota && isNum(item.chatQuota.left)) {
    values.push(item.chatQuota.left);
  }
  if (item && item.chatQuotaSecondary && isNum(item.chatQuotaSecondary.left)) {
    values.push(item.chatQuotaSecondary.left);
  }
  return values;
}

export function sessionResetTimeValue(item) {
  var timestamps = [];
  var primaryReset = parseDate(item && item.chatQuota ? item.chatQuota.resetAt : null);
  var secondaryReset = parseDate(item && item.chatQuotaSecondary ? item.chatQuotaSecondary.resetAt : null);

  if (primaryReset) {
    timestamps.push(primaryReset.getTime());
  }
  if (secondaryReset) {
    timestamps.push(secondaryReset.getTime());
  }

  if (!timestamps.length) {
    return null;
  }
  return Math.min.apply(Math, timestamps);
}

export function lastRefreshTimeValue(item) {
  return dateTimeValue(item && item.lastRefresh ? item.lastRefresh : null);
}

export function expiredTimeValue(item) {
  return dateTimeValue(item && item.expired ? item.expired : null);
}

function roundedDurationText(milliseconds) {
  var abs = Math.abs(milliseconds);
  var minute = 60 * 1000;
  var hour = 60 * minute;
  var day = 24 * hour;

  if (abs < hour) {
    return Math.max(1, Math.round(abs / minute)) + " 分钟";
  }
  if (abs < day) {
    return Math.max(1, Math.round(abs / hour)) + " 小时";
  }
  return Math.max(1, Math.round(abs / day)) + " 天";
}

// last_refresh 是原始文件字段，这里只按它本身判断“新旧”，避免和前端同步时间混在一起。
export function credentialRefreshMeta(item) {
  var timestamp = lastRefreshTimeValue(item);
  var age;

  if (item && item.credentialInfoStatus && item.credentialInfoStatus !== "success" && timestamp == null) {
    return {
      tone: "neutral",
      hintText: "未同步凭证信息"
    };
  }

  if (timestamp == null) {
    return {
      tone: "neutral",
      hintText: "未写入 last_refresh"
    };
  }

  age = Date.now() - timestamp;
  if (age <= AUTH_TIMELINE_HINTS.refreshFreshHours * 60 * 60 * 1000) {
    return {
      tone: "success",
      hintText: "24 小时内刷新"
    };
  }
  if (age <= AUTH_TIMELINE_HINTS.refreshWarnHours * 60 * 60 * 1000) {
    return {
      tone: "info",
      hintText: "已过 " + roundedDurationText(age)
    };
  }
  return {
    tone: "warn",
    hintText: "超过 " + roundedDurationText(age)
  };
}

// expired 表示当前 access_token 的过期时间，和 refresh_token 是否还能换新不是一个概念。
export function accessTokenExpiryMeta(item) {
  var timestamp = expiredTimeValue(item);
  var diff;

  if (item && item.credentialInfoStatus && item.credentialInfoStatus !== "success" && timestamp == null) {
    return {
      tone: "neutral",
      hintText: "未同步凭证信息"
    };
  }

  if (timestamp == null) {
    return {
      tone: "neutral",
      hintText: "未写入 expired"
    };
  }

  diff = timestamp - Date.now();
  if (diff <= 0) {
    return {
      tone: "danger",
      hintText: "已过期 " + roundedDurationText(diff)
    };
  }
  if (diff <= AUTH_TIMELINE_HINTS.expirySoonMinutes * 60 * 1000) {
    return {
      tone: "warn",
      hintText: AUTH_TIMELINE_HINTS.expirySoonMinutes / 60 + " 小时内到期"
    };
  }
  if (diff <= AUTH_TIMELINE_HINTS.expiryWarnHours * 60 * 60 * 1000) {
    return {
      tone: "info",
      hintText: "24 小时内到期"
    };
  }
  return {
    tone: "success",
    hintText: "剩余 " + roundedDurationText(diff)
  };
}

function defaultItemComparator(a, b) {
  var toneWeight = { bad: 0, warn: 1, good: 2 };
  var aTone = toneWeight[a.tone] != null ? toneWeight[a.tone] : 99;
  var bTone = toneWeight[b.tone] != null ? toneWeight[b.tone] : 99;
  var aRemaining = quotaLeft(a);
  var bRemaining = quotaLeft(b);
  var aFallbackRemaining = aRemaining == null ? 101 : aRemaining;
  var bFallbackRemaining = bRemaining == null ? 101 : bRemaining;

  if (aTone !== bTone) {
    return aTone - bTone;
  }
  if (aFallbackRemaining !== bFallbackRemaining) {
    return aFallbackRemaining - bFallbackRemaining;
  }
  return (a.email || "").localeCompare(b.email || "");
}

function sessionResetComparator(a, b) {
  var aReset = sessionResetTimeValue(a);
  var bReset = sessionResetTimeValue(b);

  if (aReset == null && bReset == null) {
    return defaultItemComparator(a, b);
  }
  if (aReset == null) {
    return 1;
  }
  if (bReset == null) {
    return -1;
  }
  if (aReset !== bReset) {
    return aReset - bReset;
  }
  return defaultItemComparator(a, b);
}

function lastRefreshComparator(a, b) {
  var aRefresh = lastRefreshTimeValue(a);
  var bRefresh = lastRefreshTimeValue(b);

  if (aRefresh == null && bRefresh == null) {
    return defaultItemComparator(a, b);
  }
  if (aRefresh == null) {
    return 1;
  }
  if (bRefresh == null) {
    return -1;
  }
  if (aRefresh !== bRefresh) {
    return aRefresh - bRefresh;
  }
  return defaultItemComparator(a, b);
}

function expiredComparator(a, b) {
  var aExpired = expiredTimeValue(a);
  var bExpired = expiredTimeValue(b);

  if (aExpired == null && bExpired == null) {
    return defaultItemComparator(a, b);
  }
  if (aExpired == null) {
    return 1;
  }
  if (bExpired == null) {
    return -1;
  }
  if (aExpired !== bExpired) {
    return aExpired - bExpired;
  }
  return defaultItemComparator(a, b);
}

// 排序入口统一收口在这里，方便各个池视图只管传模式，不再各自散落比较逻辑。
export function sortItems(list, sortMode) {
  var mode = sortMode || POOL_SORT_MODES.DEFAULT;
  return list.slice().sort(function (a, b) {
    if (mode === POOL_SORT_MODES.SESSION_RESET_ASC) {
      return sessionResetComparator(a, b);
    }
    if (mode === POOL_SORT_MODES.LAST_REFRESH_ASC) {
      return lastRefreshComparator(a, b);
    }
    if (mode === POOL_SORT_MODES.EXPIRED_ASC) {
      return expiredComparator(a, b);
    }
    return defaultItemComparator(a, b);
  });
}
