// 统一收口前端本地存储 key 和额度窗口常量，避免 Vue 侧继续依赖旧 src 目录。
export const STORE = "cliproxyapi-codex-real-board";
export const SNAPSHOT_STORE = "cliproxyapi-codex-real-board-snapshot";
export const INTEGRATION_STORE = "cliproxyapi-codex-real-board-integrations";
export const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const FIVE_HOUR = 18000;
export const WEEK = 604800;
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;
export const POOL_SORT_MODES = {
  DEFAULT: "default",
  SESSION_RESET_ASC: "session-reset-asc"
};
export const POOL_SORT_OPTIONS = [
  { value: POOL_SORT_MODES.DEFAULT, label: "默认排序" },
  { value: POOL_SORT_MODES.SESSION_RESET_ASC, label: "会话重置最早优先" }
];
export const AUTO_REFRESH_MODES = {
  FILES: "files",
  FILES_AND_QUOTAS: "files-and-quotas"
};
export const AUTO_REFRESH_MODE_OPTIONS = [
  { value: AUTO_REFRESH_MODES.FILES, label: "只文件" },
  { value: AUTO_REFRESH_MODES.FILES_AND_QUOTAS, label: "文件 + 额度" }
];

// 自动刷新模式需要兼容旧版本本地缓存与 app-config.json，未知值统一回退到更稳妥的“只文件”。
export function normalizeAutoRefreshMode(value) {
  var input = String(value || "").trim().toLowerCase();

  if (input === AUTO_REFRESH_MODES.FILES_AND_QUOTAS) {
    return AUTO_REFRESH_MODES.FILES_AND_QUOTAS;
  }

  return AUTO_REFRESH_MODES.FILES;
}

// 把工作台级动作和单文件动作的等待分组收口，避免组件里散落硬编码字符串。
export const PENDING_GROUPS = {
  workbench: [
    "refresh-files",
    "refresh-all",
    "refresh-disabled-quotas",
    "refresh-selected-quotas",
    "upload",
    "rescan",
    "disable-quota",
    "disable-selected",
    "delete-selected",
    "enable-selected"
  ],
  row: [
    "row-refresh",
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
