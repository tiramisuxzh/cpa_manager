import { EMPTY_PLAN_TYPE_FILTER, FIVE_HOUR, POOL_SORT_MODES, WEEK } from "./constants.js";

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

export function fmt(value, full) {
  var date = parseDate(value);
  if (!date) {
    return "未知";
  }
  return date.toLocaleString(
    "zh-CN",
    full
      ? { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
  );
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
  var used;
  var left;

  if (!windowValue) {
    return null;
  }

  seconds = toNum(
    windowValue.limit_window_seconds != null ? windowValue.limit_window_seconds : windowValue.limitWindowSeconds
  );
  used = clamp(windowValue.used_percent != null ? windowValue.used_percent : windowValue.usedPercent);
  left = used == null ? null : clamp(100 - used);

  return {
    label: seconds === WEEK ? "周窗口" : (seconds === FIVE_HOUR ? "5 小时窗口" : "主窗口"),
    used: used,
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
  var planType = String(item && item.planType ? item.planType : "").trim().toLowerCase();
  var sessionWindowPlanTypes = ["plus", "team", "tream"];

  // plus / team 账号的会话额度都按“5 小时 + 周”两层窗口展示，标题不再沿用通用的“会话”文案。
  if (sessionWindowPlanTypes.indexOf(planType) !== -1) {
    if (quota && quota.label === "5 小时窗口") {
      return "5 小时";
    }
    if (quota && quota.label === "周窗口") {
      return "周";
    }
    return fallback || (quota && quota.label) || "窗口";
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

// 列表默认仍按风险和剩余额度优先；只有用户显式切到会话重置排序时，才把最早重置的账号提到前面。
export function sortItems(list, sortMode) {
  var mode = sortMode || POOL_SORT_MODES.DEFAULT;
  return list.slice().sort(mode === POOL_SORT_MODES.SESSION_RESET_ASC ? sessionResetComparator : defaultItemComparator);
}
