// 统一收口前端本地存储 key 和额度窗口常量，避免 Vue 侧继续依赖旧 src 目录。
export const STORE = "cliproxyapi-codex-real-board";
export const SNAPSHOT_STORE = "cliproxyapi-codex-real-board-snapshot";
export const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const FIVE_HOUR = 18000;
export const WEEK = 604800;
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;
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
    "save-default-settings"
  ]
};
