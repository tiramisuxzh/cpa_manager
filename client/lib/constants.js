// 统一收口前端本地存储 key 和额度窗口常量，避免 Vue 侧继续依赖旧 src 目录。
export const STORE = "cliproxyapi-codex-real-board";
export const SNAPSHOT_STORE = "cliproxyapi-codex-real-board-snapshot";
export const INTEGRATION_STORE = "cliproxyapi-codex-real-board-integrations";
export const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const FIVE_HOUR = 18000;
export const WEEK = 604800;
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;
export const EMPTY_PLAN_TYPE_FILTER = "__empty_plan_type__";
// 统一收口认证时间的轻提示阈值，方便后续一起调整展示口径。
export const AUTH_TIMELINE_HINTS = {
  refreshFreshHours: 24,
  refreshWarnHours: 72,
  expirySoonMinutes: 120,
  expiryWarnHours: 24
};
export const POOL_SORT_MODES = {
  DEFAULT: "default",
  SESSION_RESET_ASC: "session-reset-asc",
  LAST_REFRESH_ASC: "last-refresh-asc",
  EXPIRED_ASC: "expired-asc"
};
export const POOL_SORT_OPTIONS = [
  { value: POOL_SORT_MODES.DEFAULT, label: "默认排序" },
  { value: POOL_SORT_MODES.SESSION_RESET_ASC, label: "会话重置最早优先" },
  { value: POOL_SORT_MODES.LAST_REFRESH_ASC, label: "凭证刷新最旧优先" },
  { value: POOL_SORT_MODES.EXPIRED_ASC, label: "Access Token 过期最早优先" }
];
export const AUTO_REFRESH_MODES = {
  FILES: "files",
  FILES_AND_QUOTAS: "files-and-quotas",
  FILES_AND_CREDENTIALS: "files-and-credentials",
  CREDENTIALS_AND_QUOTAS: "credentials-and-quotas",
  CREDENTIALS: "credentials"
};
export const AUTO_REFRESH_MODE_OPTIONS = [
  { value: AUTO_REFRESH_MODES.FILES, label: "只文件" },
  { value: AUTO_REFRESH_MODES.FILES_AND_QUOTAS, label: "文件 + 额度（含凭证）" },
  { value: AUTO_REFRESH_MODES.FILES_AND_CREDENTIALS, label: "文件 + 凭证" },
  { value: AUTO_REFRESH_MODES.CREDENTIALS_AND_QUOTAS, label: "凭证 + 额度" },
  { value: AUTO_REFRESH_MODES.CREDENTIALS, label: "只凭证" }
];
export const TOKEN_REFRESH_DEFAULTS = {
  concurrency: 3,
  intervalSeconds: 0
};
export const TOKEN_REFRESH_LIMITS = {
  concurrency: { min: 1, max: 10 },
  intervalSeconds: { min: 0, max: 30 }
};

// 自动刷新模式需要兼容旧版本本地缓存与 app-config.json，未知值统一回退到更稳妥的“只文件”。
export function normalizeAutoRefreshMode(value) {
  var input = String(value || "").trim().toLowerCase();

  if (input === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
    return AUTO_REFRESH_MODES.FILES_AND_QUOTAS;
  }
  if (input === AUTO_REFRESH_MODES.FILES_AND_CREDENTIALS) {
    return AUTO_REFRESH_MODES.FILES_AND_CREDENTIALS;
  }
  if (input === AUTO_REFRESH_MODES.CREDENTIALS_AND_QUOTAS) {
    return AUTO_REFRESH_MODES.CREDENTIALS_AND_QUOTAS;
  }
  if (input === AUTO_REFRESH_MODES.CREDENTIALS) {
    return AUTO_REFRESH_MODES.CREDENTIALS;
  }

  return AUTO_REFRESH_MODES.FILES;
}

// 把工作台级动作和单文件动作的等待分组收口，避免组件里散落硬编码字符串。
export const PENDING_GROUPS = {
  workbench: [
    "refresh-files",
    "run-auto-refresh-now",
    "refresh-all",
    "refresh-disabled-quotas",
    "refresh-selected-quotas",
    "refresh-credential-info-selected",
    "refresh-credentials-selected",
    "revive-selected",
    "upload",
    "rescan",
    "disable-quota",
    "disable-selected",
    "delete-selected",
    "enable-selected"
  ],
  row: [
    "row-refresh",
    "row-refresh-credential",
    "row-credential-info",
    "row-revive",
    "row-toggle-disabled",
    "row-delete"
  ],
  service: [
    "service-refresh",
    "service-flags",
    "service-proxy",
    "service-retry",
    "save-default-settings",
    "save-integration-settings"
  ]
};
