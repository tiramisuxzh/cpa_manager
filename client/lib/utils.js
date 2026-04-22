import { FIVE_HOUR, POOL_SORT_MODES, WEEK } from "./constants.js";

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

export function selectWindow(limit) {
  var classified = classify(limit);
  var windowValue = classified.weekly || classified.primary || classified.secondary || null;
  if (!windowValue) {
    return null;
  }
  var seconds = toNum(
    windowValue.limit_window_seconds != null ? windowValue.limit_window_seconds : windowValue.limitWindowSeconds
  );
  var used = clamp(windowValue.used_percent != null ? windowValue.used_percent : windowValue.usedPercent);
  var left = used == null ? null : clamp(100 - used);
  return {
    label: seconds === WEEK ? "周窗口" : (seconds === FIVE_HOUR ? "5 小时窗口" : "主窗口"),
    used: used,
    left: left,
    resetAt: windowValue.reset_at != null ? windowValue.reset_at : (windowValue.resetAt != null ? windowValue.resetAt : null)
  };
}

function defaultItemComparator(a, b) {
  var toneWeight = { bad: 0, warn: 1, good: 2 };
  var aTone = toneWeight[a.tone] != null ? toneWeight[a.tone] : 99;
  var bTone = toneWeight[b.tone] != null ? toneWeight[b.tone] : 99;
  var aRemaining = Math.min(
    isNum(a.chatQuota && a.chatQuota.left) ? a.chatQuota.left : 101,
    isNum(a.codeQuota && a.codeQuota.left) ? a.codeQuota.left : 101
  );
  var bRemaining = Math.min(
    isNum(b.chatQuota && b.chatQuota.left) ? b.chatQuota.left : 101,
    isNum(b.codeQuota && b.codeQuota.left) ? b.codeQuota.left : 101
  );

  if (aTone !== bTone) {
    return aTone - bTone;
  }
  if (aRemaining !== bRemaining) {
    return aRemaining - bRemaining;
  }
  return (a.email || "").localeCompare(b.email || "");
}

export function sessionResetTimeValue(item) {
  var sessionReset = parseDate(item && item.chatQuota ? item.chatQuota.resetAt : null);
  return sessionReset ? sessionReset.getTime() : null;
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
