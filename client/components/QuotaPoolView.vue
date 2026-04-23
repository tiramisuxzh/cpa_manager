<script setup>
import { computed, reactive, ref, watch } from "vue";
import UsageInlineStats from "./UsageInlineStats.vue";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, PENDING_GROUPS, POOL_SORT_MODES, POOL_SORT_OPTIONS } from "../lib/constants.js";
import { buildPlanTypeOptions, fmt, planTypeFilterValue, quotaHintText, quotaLeft as quotaLeftValue, quotaResetText, quotaText, sortItems } from "../lib/utils.js";

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
  state: "all",
  remain: "all",
  planType: "all",
  sortMode: POOL_SORT_MODES.DEFAULT
});
var pageSize = ref(DEFAULT_PAGE_SIZE);
var currentPage = ref(1);
var sortOptions = POOL_SORT_OPTIONS;

function quotaLeft(item) {
  return quotaLeftValue(item);
}

function matchesSearch(item) {
  var keyword = String(filters.search || "").trim().toLowerCase();
  var scope;
  if (!keyword) {
    return true;
  }
  scope = [item.name, item.email, item.planType, item.reason, item.statusMessage, item.rawQuotaMessage, item.requestStatusText, item.quotaStateLabel].join(" ").toLowerCase();
  return scope.indexOf(keyword) !== -1;
}

function matchesState(item) {
  if (filters.state === "healthy") {
    return item.tone === "good" && !item.disabled;
  }
  if (filters.state === "warn") {
    return item.tone === "warn" && !item.disabled;
  }
  if (filters.state === "quota") {
    return item.badReasonGroup === "quota";
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
  if (filters.remain === "20to50") {
    return left > 20 && left <= 50;
  }
  if (filters.remain === "warning") {
    return left > 0 && left <= props.consoleApp.settings.lowQuotaThreshold;
  }
  if (filters.remain === "zero") {
    return left === 0;
  }
  return true;
}

function matchesPlanType(item) {
  if (filters.planType === "all") {
    return true;
  }
  return planTypeFilterValue(item) === filters.planType;
}

var planTypeOptions = computed(function () {
  return buildPlanTypeOptions(props.consoleApp.state.items.filter(function (item) {
    return !item.disabled;
  }));
});

var filteredItems = computed(function () {
  var items = props.consoleApp.state.items.filter(function (item) {
    if (item.disabled) {
      return false;
    }
    return matchesSearch(item) && matchesState(item) && matchesRemain(item) && matchesPlanType(item);
  });

  if (filters.sortMode === POOL_SORT_MODES.SESSION_RESET_ASC) {
    return sortItems(items, filters.sortMode);
  }

  return sortItems(items).sort(function (a, b) {
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
    return props.consoleApp.isSelected(item.key);
  });
  return {
    total: selected.length,
    disableable: selected.filter(function (item) { return item.name && !item.runtimeOnly && !item.disabled; }).length,
    enableable: selected.filter(function (item) { return item.name && !item.runtimeOnly && item.disabled; }).length,
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
  var items = props.consoleApp.state.items;
  return [
    { label: "稳定可用", value: items.filter(function (item) { return item.tone === "good" && !item.disabled; }).length, tone: "success" },
    { label: "低额度预警", value: items.filter(function (item) { return item.tone === "warn" && !item.disabled; }).length, tone: "info" },
    { label: "额度异常", value: items.filter(function (item) { return item.badReasonGroup === "quota" && !item.disabled; }).length, tone: "warn" },
    { label: "停用池", value: items.filter(function (item) { return item.disabled; }).length, tone: "violet" }
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
  if (item.badReasonGroup === "quota") {
    return "tone-warn";
  }
  if (item.badReasonGroup === "auth-401") {
    return "tone-danger";
  }
  if (item.disabled) {
    return "tone-violet";
  }
  if (item.tone === "warn") {
    return "tone-info";
  }
  return "tone-success";
}

function quotaState(item) {
  if (item.quotaStateLabel) {
    return item.disabled && item.badReasonGroup === "quota"
      ? (item.quotaStateLabel + "已停用")
      : item.quotaStateLabel;
  }
  return item.disabled ? "已停用" : "等待额度";
}

function actionAdvice(item) {
  if (item.badReasonGroup === "quota") {
    return item.disabled ? "恢复前先刷新确认" : "建议先停用观察";
  }
  if (item.badReasonGroup === "auth-401") {
    return "建议转到异常处置";
  }
  return item.tone === "warn" ? "建议优先观察" : "当前可继续使用";
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
          <span class="eyebrow">Quota Pool</span>
          <h3>额度池</h3>
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
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.disableable" :aria-busy="props.consoleApp.isPending('disable-selected') ? 'true' : 'false'" @click="props.consoleApp.disableSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('disable-selected') }">{{ pendingText('disable-selected', '停用选中', '停用中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.enableable" :aria-busy="props.consoleApp.isPending('enable-selected') ? 'true' : 'false'" @click="props.consoleApp.enableSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('enable-selected') }">{{ pendingText('enable-selected', '启用选中', '启用中') }}</span>
          </button>
          <button class="ghost-btn" type="button" :disabled="workbenchPending() || !selectionStats.total" @click="props.consoleApp.clearSelection">清空勾选</button>
        </div>

        <button class="primary-btn" type="button" :disabled="workbenchPending()" :aria-busy="props.consoleApp.isPending('refresh-all') ? 'true' : 'false'" @click="props.consoleApp.refreshAllQuotas({ pendingType: 'refresh-all' })">
          <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-all') }">{{ pendingText('refresh-all', '刷新全池额度', '刷新中') }}</span>
        </button>
        <button class="secondary-btn" type="button" :disabled="workbenchPending()" :aria-busy="props.consoleApp.isPending('disable-quota') ? 'true' : 'false'" @click="props.consoleApp.disableQuotaRelated">
          <span class="button-label" :class="{ pending: props.consoleApp.isPending('disable-quota') }">{{ pendingText('disable-quota', '停用额度异常', '停用中') }}</span>
        </button>
      </div>
    </article>

    <article class="surface-card control-bar">
      <label class="field search-field">
        <span>搜索</span>
        <input v-model="filters.search" class="text-input" placeholder="账号、文件、套餐、状态说明">
      </label>

      <label class="field compact">
        <span>运行状态</span>
        <select v-model="filters.state" class="select-input">
          <option value="all">全部</option>
          <option value="healthy">稳定可用</option>
          <option value="warn">低额度告警</option>
          <option value="quota">额度异常</option>
        </select>
      </label>

      <label class="field compact">
        <span>剩余额度</span>
        <select v-model="filters.remain" class="select-input">
          <option value="all">全部</option>
          <option value="gt50">大于 50%</option>
          <option value="20to50">20%-50%</option>
          <option value="warning">{{ warningRemainText() }}</option>
          <option value="zero">等于 0%</option>
          <option value="unknown">未知</option>
        </select>
      </label>

      <label class="field compact">
        <span>套餐类型</span>
        <select v-model="filters.planType" class="select-input">
          <option value="all">全部套餐</option>
          <option v-for="option in planTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>

      <label class="field compact">
        <span>每页条数</span>
        <select v-model.number="pageSize" class="select-input">
          <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ pageSizeText(size) }}</option>
        </select>
      </label>

      <label class="field compact">
        <span>排序方式</span>
        <select v-model="filters.sortMode" class="select-input">
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
    </article>

    <section class="surface-card table-shell">
      <header class="table-head">
        <label class="table-check">
          <input type="checkbox" :checked="pageSelectionState" @change="togglePageSelection($event.target.checked)">
        </label>
        <span>账号 / 文件</span>
        <span>状态与建议</span>
        <span>额度窗口</span>
        <span>重置时间 / Usage</span>
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
              <span v-if="item.disabled" class="tag-pill">disabled</span>
            </div>
          </div>

          <div class="row-cell status-cell">
            <div class="status-line">
              <span class="status-badge" :class="rowClass(item)">{{ quotaState(item) }}</span>
              <strong>{{ actionAdvice(item) }}</strong>
            </div>
            <p>{{ item.reason || item.statusMessage || "等待进一步判断" }}</p>
          </div>

          <div class="row-cell metric-cell">
            <strong>{{ quotaText(item) }}</strong>
            <span>{{ quotaHintText(item) }}</span>
          </div>

          <div class="row-cell time-cell">
            <strong>{{ quotaResetText(item, false, " / ") }}</strong>
            <div class="usage-stack">
              <span>{{ item.requestStatusText }}</span>
              <UsageInlineStats :success="item.usageSuccessCount" :failure="item.usageFailureCount" />
            </div>
          </div>

          <div class="row-cell action-cell">
            <button class="mini-btn" type="button" @click="props.onOpenDetail(item)">详情</button>
            <button class="mini-btn" type="button" :disabled="workbenchPending() || rowPending(item) || !item.authIndex || !item.accountId" :aria-busy="props.consoleApp.isPending('row-refresh', item.key) ? 'true' : 'false'" @click="props.consoleApp.refreshOne(item.key)">
              <span class="button-label" :class="{ pending: props.consoleApp.isPending('row-refresh', item.key) }">{{ pendingText('row-refresh', '刷新', '刷新中', item.key) }}</span>
            </button>
            <button class="mini-btn" type="button" :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly" :aria-busy="props.consoleApp.isPending('row-toggle-disabled', item.key) ? 'true' : 'false'" @click="props.consoleApp.setFileDisabled(item, !item.disabled)">
              <span class="button-label" :class="{ pending: props.consoleApp.isPending('row-toggle-disabled', item.key) }">{{ pendingText('row-toggle-disabled', item.disabled ? '启用' : '停用', item.disabled ? '启用中' : '停用中', item.key) }}</span>
            </button>
          </div>
        </article>
      </div>

      <div v-else class="table-empty">
        当前筛选下没有额度对象。
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
  grid-template-columns: minmax(0, 1.2fr) repeat(5, minmax(132px, 0.22fr));
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
  grid-template-columns: 40px minmax(220px, 1.2fr) minmax(260px, 1.4fr) minmax(220px, 1fr) minmax(220px, 1fr) minmax(220px, 0.9fr);
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

.usage-stack {
  display: grid;
  gap: 6px;
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

.status-badge.tone-violet {
  color: var(--violet);
}

.status-badge.tone-info {
  color: var(--accent);
}

.status-badge.tone-success {
  color: var(--success);
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

@media (max-width: 1500px) {
  .control-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-head,
  .table-row {
    grid-template-columns: 40px minmax(180px, 1fr) minmax(220px, 1.2fr) minmax(180px, 0.9fr) minmax(200px, 0.9fr) minmax(210px, 0.9fr);
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
