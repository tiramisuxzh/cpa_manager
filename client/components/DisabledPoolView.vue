<script setup>
import { computed, reactive, ref, watch } from "vue";
import UsageInlineStats from "./UsageInlineStats.vue";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, PENDING_GROUPS } from "../lib/constants.js";
import { fmt, isNum, sortItems } from "../lib/utils.js";

var props = defineProps({
  consoleApp: {
    type: Object,
    required: true
  },
  onOpenDetail: {
    type: Function,
    required: true
  }
});

var filters = reactive({
  search: "",
  category: "all",
  remain: "all"
});
var pageSize = ref(DEFAULT_PAGE_SIZE);
var currentPage = ref(1);

function quotaLeft(item) {
  var values = [];
  if (item.chatQuota && isNum(item.chatQuota.left)) {
    values.push(item.chatQuota.left);
  }
  if (item.codeQuota && isNum(item.codeQuota.left)) {
    values.push(item.codeQuota.left);
  }
  if (!values.length) {
    return null;
  }
  return Math.min.apply(Math, values);
}

function matchesSearch(item) {
  var keyword = String(filters.search || "").trim().toLowerCase();
  var scope;
  if (!keyword) {
    return true;
  }
  scope = [
    item.name,
    item.email,
    item.reason,
    item.statusMessage,
    item.rawQuotaMessage,
    item.requestStatusText,
    item.quotaStateLabel,
    item.planType,
    item.badReasonLabel
  ].join(" ").toLowerCase();
  return scope.indexOf(keyword) !== -1;
}

function matchesCategory(item) {
  if (filters.category === "auth-401") {
    return item.badReasonGroup === "auth-401";
  }
  if (filters.category === "quota") {
    return item.badReasonGroup === "quota";
  }
  if (filters.category === "non-quota") {
    return item.badReasonGroup === "non-quota";
  }
  if (filters.category === "manual") {
    return !item.badReasonGroup;
  }
  return true;
}

function matchesRemain(item) {
  var left = quotaLeft(item);
  if (filters.remain === "unknown") {
    return left == null;
  }
  if (left == null) {
    return filters.remain === "all";
  }
  if (filters.remain === "gt50") {
    return left > 50;
  }
  if (filters.remain === "warning") {
    return left > 0 && left <= props.consoleApp.settings.lowQuotaThreshold;
  }
  if (filters.remain === "zero") {
    return left === 0;
  }
  return true;
}

// 停用池只展示 disabled 文件，避免用户再去文件池和额度池里反复拼筛选条件。
var sourceItems = computed(function () {
  return sortItems(props.consoleApp.state.items.filter(function (item) {
    return item.disabled;
  }));
});

var filteredItems = computed(function () {
  return sourceItems.value.filter(function (item) {
    return matchesSearch(item) && matchesCategory(item) && matchesRemain(item);
  }).sort(function (a, b) {
    var aLeft = quotaLeft(a);
    var bLeft = quotaLeft(b);
    if (aLeft == null && bLeft == null) {
      return 0;
    }
    if (aLeft == null) {
      return 1;
    }
    if (bLeft == null) {
      return -1;
    }
    return aLeft - bLeft;
  });
});

var totalPages = computed(function () {
  return Math.max(1, Math.ceil(filteredItems.value.length / pageSize.value));
});

var pagedItems = computed(function () {
  var start = (currentPage.value - 1) * pageSize.value;
  return filteredItems.value.slice(start, start + pageSize.value);
});

var selectionStats = computed(function () {
  var selected = props.consoleApp.state.items.filter(function (item) {
    return item.disabled && props.consoleApp.isSelected(item.key);
  });

  return {
    total: selected.length,
    deletable: selected.filter(function (item) { return item.name && !item.runtimeOnly; }).length,
    enableable: selected.filter(function (item) { return item.name && !item.runtimeOnly; }).length,
    refreshable: selected.filter(function (item) { return item.authIndex && item.accountId; }).length
  };
});

var pageSelectionState = computed(function () {
  var selectable = pagedItems.value.filter(function (item) {
    return !item.runtimeOnly;
  });
  if (!selectable.length) {
    return false;
  }
  return selectable.every(function (item) {
    return props.consoleApp.isSelected(item.key);
  });
});

var summaryCards = computed(function () {
  return [
    { label: "停用总数", value: sourceItems.value.length, tone: "violet" },
    { label: "额度异常停用", value: sourceItems.value.filter(function (item) { return item.badReasonGroup === "quota"; }).length, tone: "warn" },
    { label: "401 停用", value: sourceItems.value.filter(function (item) { return item.badReasonGroup === "auth-401"; }).length, tone: "danger" },
    { label: "其他停用", value: sourceItems.value.filter(function (item) { return item.badReasonGroup === "non-quota"; }).length, tone: "info" },
    { label: "手动停用", value: sourceItems.value.filter(function (item) { return !item.badReasonGroup; }).length, tone: "neutral" }
  ];
});

watch(function () {
  return filteredItems.value.length + "::" + pageSize.value;
}, function () {
  currentPage.value = Math.max(1, Math.min(currentPage.value, totalPages.value));
});

function pendingText(type, idleText, loadingText, key) {
  return props.consoleApp.isPending(type, key) ? loadingText : idleText;
}

function workbenchPending() {
  return props.consoleApp.hasPending(PENDING_GROUPS.workbench);
}

function rowPending(item) {
  return props.consoleApp.hasPending(PENDING_GROUPS.row, item.key);
}

function togglePageSelection(checked) {
  props.consoleApp.togglePageSelection(checked, pagedItems.value);
}

function pageChange(nextPage) {
  currentPage.value = Math.max(1, Math.min(nextPage, totalPages.value));
}

function rowClass(item) {
  if (item.badReasonGroup === "auth-401") {
    return "tone-danger";
  }
  if (item.badReasonGroup === "quota") {
    return "tone-warn";
  }
  if (item.badReasonGroup === "non-quota") {
    return "tone-info";
  }
  return "tone-violet";
}

function disabledState(item) {
  if (item.badReasonGroup === "auth-401") {
    return item.badReasonLabel || "401 认证异常";
  }
  if (item.badReasonGroup === "quota" || item.badReasonGroup === "non-quota") {
    return item.badReasonLabel || item.quotaStateLabel || "停用异常";
  }
  return "手动停用";
}

function actionAdvice(item) {
  if (item.badReasonGroup === "auth-401") {
    return "更建议删除或替换";
  }
  if (item.badReasonGroup === "quota") {
    return "额度恢复后可重新启用";
  }
  if (!item.badReasonGroup) {
    return "按需刷新后重新启用";
  }
  if (quotaLeft(item) != null && quotaLeft(item) > props.consoleApp.settings.lowQuotaThreshold) {
    return "建议刷新确认后启用";
  }
  return "建议先看详情再决定";
}

function stoppedReason(item) {
  if (item.reason) {
    return item.reason;
  }
  if (item.rawQuotaMessage) {
    return item.rawQuotaMessage;
  }
  if (item.statusMessage) {
    return item.statusMessage;
  }
  return "当前处于停用状态，等待进一步处理。";
}

function quotaText(item) {
  var chat = item.chatQuota && isNum(item.chatQuota.left) ? ("会话 " + item.chatQuota.left + "%") : "会话 --";
  var code = item.codeQuota && isNum(item.codeQuota.left) ? ("代码 " + item.codeQuota.left + "%") : "代码 --";
  return chat + " · " + code;
}

function resetText(item) {
  var dates = [];
  if (item.chatQuota && item.chatQuota.resetAt) {
    dates.push("会话 " + fmt(item.chatQuota.resetAt, false));
  }
  if (item.codeQuota && item.codeQuota.resetAt) {
    dates.push("代码 " + fmt(item.codeQuota.resetAt, false));
  }
  return dates.length ? dates.join(" · ") : "等待返回";
}

function syncStatusText(item) {
  var syncTime = fmt(item.lastRefresh || item.updatedAt, true);
  if (item.quotaStatus === "loading") {
    return "正在刷新额度 · 最近同步 " + syncTime;
  }
  return (item.requestStatusText || "已停用待处理") + " · 最近同步 " + syncTime;
}

function pageSizeText(size) {
  return size + " / 页";
}

function warningRemainText() {
  return "低于等于预警线（" + props.consoleApp.settings.lowQuotaThreshold + "%）";
}
</script>

<template>
  <section class="view-shell">
    <article class="surface-card pool-toolbar">
      <div class="toolbar-main">
        <div class="title-block">
          <span class="eyebrow">Disabled Pool</span>
          <h3>停用池</h3>
        </div>
        <div class="summary-row">
          <span v-for="card in summaryCards" :key="card.label" class="pill" :class="'tone-' + card.tone">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </span>
        </div>
      </div>

      <div class="toolbar-actions">
        <div v-if="selectionStats.total" class="selection-inline">
          <span>已选 {{ selectionStats.total }}</span>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.refreshable" :aria-busy="props.consoleApp.isPending('refresh-selected-quotas') ? 'true' : 'false'" @click="props.consoleApp.refreshSelectedQuotas">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-selected-quotas') }">{{ pendingText('refresh-selected-quotas', '刷新选中额度', '刷新中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.enableable" :aria-busy="props.consoleApp.isPending('enable-selected') ? 'true' : 'false'" @click="props.consoleApp.enableSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('enable-selected') }">{{ pendingText('enable-selected', '启用选中', '启用中') }}</span>
          </button>
          <button class="danger-btn" type="button" :disabled="workbenchPending() || !selectionStats.deletable" :aria-busy="props.consoleApp.isPending('delete-selected') ? 'true' : 'false'" @click="props.consoleApp.deleteSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('delete-selected') }">{{ pendingText('delete-selected', '删除选中', '删除中') }}</span>
          </button>
          <button class="ghost-btn" type="button" :disabled="workbenchPending() || !selectionStats.total" @click="props.consoleApp.clearSelection">清空勾选</button>
        </div>

        <button class="primary-btn" type="button" :disabled="workbenchPending()" :aria-busy="props.consoleApp.isPending('refresh-disabled-quotas') ? 'true' : 'false'" @click="props.consoleApp.refreshDisabledQuotas()">
          <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-disabled-quotas') }">{{ pendingText('refresh-disabled-quotas', '刷新停用池额度', '刷新中') }}</span>
        </button>
      </div>
    </article>

    <article class="surface-card control-bar">
      <label class="field search-field">
        <span>搜索</span>
        <input v-model="filters.search" class="text-input" placeholder="文件名、账号、异常说明">
      </label>

      <label class="field compact">
        <span>停用分类</span>
        <select v-model="filters.category" class="select-input">
          <option value="all">全部</option>
          <option value="quota">额度异常停用</option>
          <option value="auth-401">401 停用</option>
          <option value="non-quota">其他停用</option>
          <option value="manual">手动停用</option>
        </select>
      </label>

      <label class="field compact">
        <span>剩余额度</span>
        <select v-model="filters.remain" class="select-input">
          <option value="all">全部</option>
          <option value="gt50">大于 50%</option>
          <option value="warning">{{ warningRemainText() }}</option>
          <option value="zero">等于 0%</option>
          <option value="unknown">未知</option>
        </select>
      </label>

      <label class="field compact">
        <span>每页条数</span>
        <select v-model.number="pageSize" class="select-input">
          <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ pageSizeText(size) }}</option>
        </select>
      </label>
    </article>

    <section class="surface-card table-shell">
      <header class="table-head">
        <label class="table-check">
          <input type="checkbox" :checked="pageSelectionState" @change="togglePageSelection($event.target.checked)">
        </label>
        <span>文件 / 账号</span>
        <span>停用原因与建议</span>
        <span>额度与 Usage</span>
        <span>额度重置 / 状态</span>
        <span class="align-right">操作</span>
      </header>

      <div v-if="pagedItems.length" class="table-body">
        <article v-for="item in pagedItems" :key="item.key" class="table-row" :class="rowClass(item)">
          <div class="row-cell row-check">
            <input type="checkbox" :checked="props.consoleApp.isSelected(item.key)" :disabled="item.runtimeOnly" @change="props.consoleApp.selectRow(item.key, $event.target.checked)">
          </div>

          <div class="row-cell identity-cell">
            <strong>{{ item.email || item.name || "未命名账号" }}</strong>
            <span>{{ item.name || "未命名文件" }}</span>
            <div class="tag-row">
              <span class="tag-pill">{{ item.planType || "unknown" }}</span>
              <span class="tag-pill">disabled</span>
            </div>
          </div>

          <div class="row-cell status-cell">
            <div class="status-line">
              <span class="status-badge" :class="rowClass(item)">{{ disabledState(item) }}</span>
              <strong>{{ actionAdvice(item) }}</strong>
            </div>
            <p>{{ stoppedReason(item) }}</p>
          </div>

          <div class="row-cell metric-cell">
            <strong>{{ quotaText(item) }}</strong>
            <UsageInlineStats :success="item.usageSuccessCount" :failure="item.usageFailureCount" />
          </div>

          <div class="row-cell time-cell">
            <strong>{{ resetText(item) }}</strong>
            <span>{{ syncStatusText(item) }}</span>
          </div>

          <div class="row-cell action-cell">
            <button class="mini-btn" type="button" @click="props.onOpenDetail(item)">详情</button>
            <button class="mini-btn" type="button" :disabled="workbenchPending() || rowPending(item) || !item.authIndex || !item.accountId" :aria-busy="props.consoleApp.isPending('row-refresh', item.key) ? 'true' : 'false'" @click="props.consoleApp.refreshOne(item.key)">
              <span class="button-label" :class="{ pending: props.consoleApp.isPending('row-refresh', item.key) }">{{ pendingText('row-refresh', '刷新', '刷新中', item.key) }}</span>
            </button>
            <button class="mini-btn" type="button" :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly" :aria-busy="props.consoleApp.isPending('row-toggle-disabled', item.key) ? 'true' : 'false'" @click="props.consoleApp.setFileDisabled(item, false)">
              <span class="button-label" :class="{ pending: props.consoleApp.isPending('row-toggle-disabled', item.key) }">{{ pendingText('row-toggle-disabled', '启用', '启用中', item.key) }}</span>
            </button>
            <button class="mini-btn danger" type="button" :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly" :aria-busy="props.consoleApp.isPending('row-delete', item.key) ? 'true' : 'false'" @click="props.consoleApp.deleteFile(item)">
              <span class="button-label" :class="{ pending: props.consoleApp.isPending('row-delete', item.key) }">{{ pendingText('row-delete', '删除', '删除中', item.key) }}</span>
            </button>
          </div>
        </article>
      </div>

      <div v-else class="table-empty">
        当前停用池没有匹配项。
      </div>
    </section>

    <footer class="surface-card page-footer">
      <span>共 {{ filteredItems.length }} 项，当前每页 {{ pageSize }} 条</span>
      <div class="footer-actions">
        <button class="mini-btn" type="button" :disabled="currentPage <= 1" @click="pageChange(currentPage - 1)">上一页</button>
        <span class="page-indicator">{{ currentPage }} / {{ totalPages }}</span>
        <button class="mini-btn" type="button" :disabled="currentPage >= totalPages" @click="pageChange(currentPage + 1)">下一页</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.view-shell {
  height: 100%;
  min-height: 0;
  display: grid;
  gap: 10px;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.pool-toolbar,
.control-bar,
.table-shell,
.page-footer {
  padding: 12px 14px;
}

.pool-toolbar,
.page-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.toolbar-main,
.toolbar-actions,
.summary-row,
.selection-inline,
.footer-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.toolbar-main {
  min-width: 0;
}

.title-block {
  display: grid;
  gap: 4px;
}

.title-block h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1.05;
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.selection-inline {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.08);
  color: var(--text-muted);
}

.control-bar {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(3, minmax(150px, 0.28fr));
  gap: 10px;
  align-items: end;
}

.field {
  display: grid;
  gap: 6px;
}

.field span {
  color: var(--text-muted);
  font-size: 12px;
}

.table-shell {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 40px minmax(220px, 1.2fr) minmax(260px, 1.4fr) minmax(220px, 1fr) minmax(180px, 0.8fr) minmax(240px, 0.9fr);
  gap: 12px;
  align-items: center;
}

.table-head {
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--text-muted);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.table-check,
.row-check {
  display: flex;
  justify-content: center;
}

.align-right {
  text-align: right;
}

.table-body {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 6px;
  padding-top: 8px;
}

.table-row {
  position: relative;
  padding: 10px 10px 10px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(24, 34, 52, 0.06);
}

.table-row::before {
  content: "";
  position: absolute;
  inset: 10px auto 10px 0;
  width: 4px;
  border-radius: 0 999px 999px 0;
  background: currentColor;
  opacity: 0.9;
}

.row-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.row-cell strong {
  color: var(--text-strong);
  font-size: 13px;
  line-height: 1.45;
}

.row-cell span,
.row-cell p {
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.55;
}

.row-cell p {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tag-row,
.status-line,
.action-cell {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.tag-pill,
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
}

.status-badge.tone-danger {
  color: var(--danger);
}

.status-badge.tone-warn {
  color: var(--warn);
}

.status-badge.tone-info {
  color: var(--accent);
}

.status-badge.tone-violet {
  color: var(--violet);
}

.action-cell {
  justify-content: flex-end;
}

.table-empty {
  display: grid;
  place-items: center;
  color: var(--text-soft);
  font-size: 14px;
}

.page-footer span {
  color: var(--text-strong);
  font-size: 13px;
}

.page-indicator {
  display: inline-flex;
  align-items: center;
  padding: 0 2px;
  color: var(--text-muted);
}

@media (max-width: 1480px) {
  .control-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-head,
  .table-row {
    grid-template-columns: 40px minmax(180px, 1fr) minmax(220px, 1.2fr) minmax(180px, 0.9fr) minmax(150px, 0.8fr) minmax(220px, 0.9fr);
  }
}

@media (max-width: 980px) {
  .view-shell {
    grid-template-rows: auto auto auto auto;
  }

  .table-shell {
    overflow: visible;
  }

  .table-head {
    display: none;
  }

  .table-body {
    overflow: visible;
  }

  .table-row {
    grid-template-columns: 1fr;
  }

  .row-check,
  .action-cell {
    justify-content: flex-start;
  }

  .control-bar {
    grid-template-columns: 1fr;
  }
}
</style>
