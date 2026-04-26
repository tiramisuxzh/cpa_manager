<script setup>
import { computed, reactive, ref, watch } from "vue";
import ActionIconButton from "./ActionIconButton.vue";
import UsageInlineStats from "./UsageInlineStats.vue";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, PENDING_GROUPS, POOL_SORT_MODES, POOL_SORT_OPTIONS } from "../lib/constants.js";
import { accessTokenExpiryMeta, buildPlanTypeOptions, credentialRefreshMeta, fmt, planTypeFilterValue, quotaResetText, quotaText, sortItems } from "../lib/utils.js";

var props = defineProps({
  consoleApp: {
    type: Object,
    required: true
  },
  onOpenDetail: {
    type: Function,
    required: true
  },
  onOpenCredential: {
    type: Function,
    required: true
  }
});

var filters = reactive({
  search: "",
  status: "all",
  category: "all",
  planType: "all",
  sortMode: POOL_SORT_MODES.DEFAULT
});
var ui = reactive({
  dragActive: false
});
var pageSize = ref(DEFAULT_PAGE_SIZE);
var currentPage = ref(1);

function normalizedSearch() {
  return String(filters.search || "").trim().toLowerCase();
}

function matchesSearch(item) {
  var keyword = normalizedSearch();
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

function matchesStatus(item) {
  if (filters.status === "active") {
    return !item.disabled;
  }
  if (filters.status === "disabled") {
    return !!item.disabled;
  }
  if (filters.status === "runtime") {
    return !!item.runtimeOnly;
  }
  if (filters.status === "unavailable") {
    return !!item.unavailable;
  }
  return true;
}

function matchesCategory(item) {
  if (filters.category === "good") {
    return item.tone === "good";
  }
  if (filters.category === "warn") {
    return item.tone === "warn";
  }
  if (filters.category === "auth-401") {
    return item.badReasonGroup === "auth-401";
  }
  if (filters.category === "quota") {
    return item.badReasonGroup === "quota";
  }
  if (filters.category === "non-quota") {
    return item.badReasonGroup === "non-quota";
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
  return buildPlanTypeOptions(props.consoleApp.state.items);
});

var filteredItems = computed(function () {
  return sortItems(props.consoleApp.state.items.filter(function (item) {
    return matchesSearch(item) && matchesStatus(item) && matchesCategory(item) && matchesPlanType(item);
  }), filters.sortMode);
});
var sortOptions = POOL_SORT_OPTIONS;

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
    deletable: selected.filter(function (item) { return item.name && !item.runtimeOnly; }).length,
    disableable: selected.filter(function (item) { return item.name && !item.runtimeOnly && !item.disabled; }).length,
    enableable: selected.filter(function (item) { return item.name && !item.runtimeOnly && item.disabled; }).length,
    refreshable: selected.filter(function (item) { return item.authIndex && item.accountId; }).length,
    credentialInfoRefreshable: selected.filter(function (item) { return item.name && !item.runtimeOnly; }).length,
    credentialRefreshable: selected.filter(function (item) { return item.name && !item.runtimeOnly; }).length
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
    { label: "全部", value: items.length, tone: "neutral" },
    { label: "启用中", value: items.filter(function (item) { return !item.disabled; }).length, tone: "success" },
    { label: "已停用", value: items.filter(function (item) { return item.disabled; }).length, tone: "violet" },
    { label: "401", value: items.filter(function (item) { return item.badReasonGroup === "auth-401"; }).length, tone: "danger" },
    { label: "额度异常", value: items.filter(function (item) { return item.badReasonGroup === "quota"; }).length, tone: "warn" }
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

function handleDrop(event) {
  ui.dragActive = false;
  var files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length) {
    props.consoleApp.handleUploadFiles(files);
  }
}

function triggerUpload() {
  if (workbenchPending()) {
    return;
  }
  props.consoleApp.openUploadPicker();
}

function togglePageSelection(checked) {
  props.consoleApp.togglePageSelection(checked, pagedItems.value);
}

function pageChange(nextPage) {
  currentPage.value = Math.max(1, Math.min(nextPage, totalPages.value));
}

function rowTitle(item) {
  return props.consoleApp.settings.showFilename
    ? (item.name || item.email || "未命名文件")
    : (item.email || item.name || "未命名账号");
}

function rowSubtitle(item) {
  return props.consoleApp.settings.showFilename
    ? (item.email || item.provider || "未识别账号")
    : (item.name || item.provider || "未命名文件");
}

function rowClass(item) {
  if (item.badReasonGroup === "auth-401") {
    return "tone-danger";
  }
  if (item.badReasonGroup === "quota") {
    return "tone-warn";
  }
  if (item.disabled) {
    return "tone-violet";
  }
  if (item.tone === "warn") {
    return "tone-info";
  }
  return "tone-success";
}

function statusChip(item) {
  if (item.badReasonLabel) {
    return item.badReasonLabel;
  }
  if (item.quotaStateLabel && item.quotaStateCode !== "healthy") {
    return item.quotaStateLabel;
  }
  if (item.disabled) {
    return "已停用";
  }
  if (item.tone === "warn") {
    return item.quotaStateLabel || "低额度预警";
  }
  return item.quotaStateLabel || "稳定可用";
}

function actionAdvice(item) {
  if (item.badReasonGroup === "auth-401") {
    return "建议删除或替换";
  }
  if (item.badReasonGroup === "quota") {
    return item.disabled ? "等待恢复后启用" : "建议先停用观察";
  }
  if (item.disabled) {
    return "恢复前建议先刷新";
  }
  if (item.tone === "warn") {
    return "建议优先观察";
  }
  return "当前可继续使用";
}

function syncStatusText(item) {
  var syncTime = fmt(item.lastRefresh || item.updatedAt, true);
  if (item.quotaStatus === "loading") {
    return "正在刷新额度 · 最近同步 " + syncTime;
  }
  return (item.requestStatusText || "状态已同步") + " · 最近同步 " + syncTime;
}

function lastRefreshText(item) {
  return item.lastRefresh ? fmt(item.lastRefresh, false) : (item.credentialInfoStatus === "success" ? "未写入" : "未同步");
}

function lastRefreshHint(item) {
  return credentialRefreshMeta(item);
}

function expiredText(item) {
  return item.expired ? fmt(item.expired, false) : (item.credentialInfoStatus === "success" ? "未写入" : "未同步");
}

function expiredHint(item) {
  return accessTokenExpiryMeta(item);
}

function pageSizeText(size) {
  return size + " / 页";
}
</script>

<template>
  <section
    class="view-shell"
    @dragenter.prevent="ui.dragActive = true"
    @dragover.prevent="ui.dragActive = true"
    @dragleave.prevent="ui.dragActive = false"
    @drop.prevent="handleDrop"
  >
    <article class="surface-card pool-toolbar">
      <div class="toolbar-main">
        <div class="title-block">
          <span class="eyebrow">File Pool</span>
          <h3>文件池</h3>
        </div>
        <div class="summary-row">
          <span
            v-for="card in summaryCards"
            :key="card.label"
            class="pill"
            :class="'tone-' + card.tone"
          >
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
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.credentialInfoRefreshable" :aria-busy="props.consoleApp.isPending('refresh-credential-info-selected') ? 'true' : 'false'" @click="props.consoleApp.refreshSelectedCredentialInfo">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-credential-info-selected') }">{{ pendingText('refresh-credential-info-selected', '同步选中凭证信息', '同步凭证中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.credentialRefreshable" :aria-busy="props.consoleApp.isPending('refresh-credentials-selected') ? 'true' : 'false'" @click="props.consoleApp.refreshSelectedCredentials">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-credentials-selected') }">{{ pendingText('refresh-credentials-selected', '批量认证续期', '续期中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.disableable" :aria-busy="props.consoleApp.isPending('disable-selected') ? 'true' : 'false'" @click="props.consoleApp.disableSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('disable-selected') }">{{ pendingText('disable-selected', '停用选中', '停用中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.enableable" :aria-busy="props.consoleApp.isPending('enable-selected') ? 'true' : 'false'" @click="props.consoleApp.enableSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('enable-selected') }">{{ pendingText('enable-selected', '启用选中', '启用中') }}</span>
          </button>
          <button class="danger-btn" type="button" :disabled="workbenchPending() || !selectionStats.deletable" :aria-busy="props.consoleApp.isPending('delete-selected') ? 'true' : 'false'" @click="props.consoleApp.deleteSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('delete-selected') }">{{ pendingText('delete-selected', '删除选中', '删除中') }}</span>
          </button>
          <button class="ghost-btn" type="button" :disabled="workbenchPending() || !selectionStats.total" @click="props.consoleApp.clearSelection">清空勾选</button>
        </div>

        <button class="secondary-btn" type="button" :disabled="workbenchPending()" :aria-busy="props.consoleApp.isPending('upload') ? 'true' : 'false'" @click="triggerUpload">
          <span class="button-label" :class="{ pending: props.consoleApp.isPending('upload') }">{{ pendingText('upload', '导入文件', '上传中') }}</span>
        </button>
      </div>
    </article>

    <article class="surface-card upload-strip" :class="{ active: ui.dragActive }" tabindex="0" role="button" @click="triggerUpload" @keydown.enter.prevent="triggerUpload" @keydown.space.prevent="triggerUpload">
      <span class="upload-label">拖拽 JSON 到这里直接导入</span>
      <small>保留单一上传入口，但压成细条，不再占据主列表高度。</small>
    </article>

    <article class="surface-card control-bar">
      <label class="field search-field">
        <span>搜索</span>
        <input v-model="filters.search" class="text-input" placeholder="文件名、账号、异常说明">
      </label>

      <label class="field compact">
        <span>文件状态</span>
        <select v-model="filters.status" class="select-input">
          <option value="all">全部</option>
          <option value="active">启用中</option>
          <option value="disabled">已停用</option>
          <option value="runtime">Runtime Only</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </label>

      <label class="field compact">
        <span>分类</span>
        <select v-model="filters.category" class="select-input">
          <option value="all">全部</option>
          <option value="good">稳定可用</option>
          <option value="warn">风险预警</option>
          <option value="auth-401">401 异常</option>
          <option value="quota">额度异常</option>
          <option value="non-quota">其他异常</option>
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
        <span>文件 / 账号</span>
        <span>状态与建议</span>
        <span>额度与 Usage</span>
        <span>凭证最近刷新</span>
        <span>Access Token 过期</span>
        <span>额度重置 / 状态</span>
        <span class="align-right">操作</span>
      </header>

      <div v-if="pagedItems.length" class="table-body">
        <article v-for="item in pagedItems" :key="item.key" class="table-row" :class="rowClass(item)">
          <div class="row-cell row-check">
            <input type="checkbox" :checked="props.consoleApp.isSelected(item.key)" :disabled="item.runtimeOnly" @change="props.consoleApp.selectRow(item.key, $event.target.checked)">
          </div>

          <div class="row-cell identity-cell">
            <div class="identity-main">
              <strong>{{ rowTitle(item) }}</strong>
              <span>{{ rowSubtitle(item) }}</span>
            </div>
            <div class="tag-row">
              <span class="tag-pill">{{ item.provider || "codex" }}</span>
              <span class="tag-pill">{{ item.planType || "unknown" }}</span>
              <span v-if="item.disabled" class="tag-pill">disabled</span>
            </div>
          </div>

          <div class="row-cell status-cell">
            <div class="status-line">
              <span class="status-badge" :class="rowClass(item)">{{ statusChip(item) }}</span>
              <strong>{{ actionAdvice(item) }}</strong>
            </div>
            <p>{{ item.reason || item.statusMessage || "等待进一步判断" }}</p>
          </div>

          <div class="row-cell metric-cell">
            <strong>{{ quotaText(item) }}</strong>
            <UsageInlineStats :success="item.usageSuccessCount" :failure="item.usageFailureCount" />
          </div>

          <div class="row-cell auth-time-cell">
            <strong>{{ lastRefreshText(item) }}</strong>
            <span class="subtle-hint" :class="'tone-' + lastRefreshHint(item).tone" title="原始字段：last_refresh">{{ lastRefreshHint(item).hintText }}</span>
          </div>

          <div class="row-cell auth-time-cell">
            <strong>{{ expiredText(item) }}</strong>
            <span class="subtle-hint" :class="'tone-' + expiredHint(item).tone" title="原始字段：expired（当前 access_token 过期时间）">{{ expiredHint(item).hintText }}</span>
          </div>

          <div class="row-cell time-cell">
            <strong>{{ quotaResetText(item, false) }}</strong>
            <span>{{ syncStatusText(item) }}</span>
          </div>

          <div class="row-cell action-cell">
            <ActionIconButton title="查看详情" icon="detail" @click="props.onOpenDetail(item)" />
            <ActionIconButton
              title="同步凭证信息"
              icon="credential-info"
              tone="accent"
              :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly"
              :pending="props.consoleApp.isPending('row-credential-info', item.key)"
              @click="props.onOpenCredential(item)"
            />
            <ActionIconButton
              title="认证续期"
              icon="credential-refresh"
              tone="accent"
              :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly"
              :pending="props.consoleApp.isPending('row-refresh-credential', item.key)"
              @click="props.consoleApp.refreshCredentialOne(item.key)"
            />
            <ActionIconButton
              title="刷新额度"
              icon="refresh"
              :disabled="workbenchPending() || rowPending(item) || !item.authIndex || !item.accountId"
              :pending="props.consoleApp.isPending('row-refresh', item.key)"
              @click="props.consoleApp.refreshOne(item.key)"
            />
            <ActionIconButton title="复制文件名" icon="copy" :disabled="!item.name" @click="props.consoleApp.copyName(item.name)" />
            <ActionIconButton
              :title="item.disabled ? '启用文件' : '停用文件'"
              :icon="item.disabled ? 'enable' : 'disable'"
              tone="warn"
              :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly"
              :pending="props.consoleApp.isPending('row-toggle-disabled', item.key)"
              @click="props.consoleApp.setFileDisabled(item, !item.disabled)"
            />
            <ActionIconButton
              title="删除文件"
              icon="delete"
              tone="danger"
              :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly"
              :pending="props.consoleApp.isPending('row-delete', item.key)"
              @click="props.consoleApp.deleteFile(item)"
            />
          </div>
        </article>
      </div>

      <div v-else class="table-empty">
        当前筛选下没有文件。
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
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.pool-toolbar,
.upload-strip,
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

.upload-strip {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border: 1px dashed rgba(22, 119, 255, 0.18);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.upload-strip.active {
  background: rgba(239, 246, 255, 0.98);
  border-color: rgba(22, 119, 255, 0.36);
}

.upload-label {
  color: var(--text-strong);
  font-size: 14px;
  font-weight: 600;
}

.upload-strip small {
  color: var(--text-soft);
  font-size: 12px;
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
  overflow: auto;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 40px minmax(200px, 1.15fr) minmax(220px, 1.18fr) minmax(160px, 0.86fr) minmax(132px, 0.68fr) minmax(132px, 0.68fr) minmax(160px, 0.78fr) minmax(176px, 0.8fr);
  gap: 12px;
  align-items: center;
}

.table-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--panel);
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
  overflow: visible;
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
  box-shadow: none;
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

.identity-main {
  display: grid;
  gap: 2px;
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
.status-line {
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
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.auth-time-cell strong,
.time-cell strong {
  font-variant-numeric: tabular-nums;
}

.subtle-hint {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: rgba(113, 128, 154, 0.08);
  color: var(--text-soft);
  font-size: 11px;
  line-height: 1;
}

.subtle-hint.tone-success {
  color: var(--success);
  background: var(--success-soft);
}

.subtle-hint.tone-info {
  color: var(--accent);
  background: var(--accent-soft);
}

.subtle-hint.tone-warn {
  color: var(--warn);
  background: var(--warn-soft);
}

.subtle-hint.tone-danger {
  color: var(--danger);
  background: var(--danger-soft);
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

@media (max-width: 1360px) {
  .control-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-head,
  .table-row {
    grid-template-columns: 40px minmax(176px, 1.04fr) minmax(196px, 1.08fr) minmax(148px, 0.8fr) minmax(124px, 0.66fr) minmax(124px, 0.66fr) minmax(144px, 0.74fr) minmax(172px, 0.82fr);
  }
}

@media (max-width: 980px) {
  .view-shell {
    grid-template-rows: auto auto auto auto auto;
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
    justify-content: start;
    justify-items: start;
  }

  .control-bar {
    grid-template-columns: 1fr;
  }

  .upload-strip {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
