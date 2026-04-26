<script setup>
import { computed, reactive, ref, watch } from "vue";
import ActionIconButton from "./ActionIconButton.vue";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, PENDING_GROUPS } from "../lib/constants.js";
import { buildPlanTypeOptions, fmt, planTypeFilterValue, sortItems } from "../lib/utils.js";

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
  group: "auth-401",
  search: "",
  planType: "all"
});
var pageSize = ref(DEFAULT_PAGE_SIZE);
var currentPage = ref(1);

var sourceItems = computed(function () {
  return sortItems(props.consoleApp.state.items.filter(function (item) {
    return item.tone === "bad";
  }));
});
var planTypeOptions = computed(function () {
  return buildPlanTypeOptions(sourceItems.value);
});

var groupCounts = computed(function () {
  return {
    "auth-401": sourceItems.value.filter(function (item) { return item.badReasonGroup === "auth-401"; }).length,
    quota: sourceItems.value.filter(function (item) { return item.badReasonGroup === "quota"; }).length,
    "non-quota": sourceItems.value.filter(function (item) { return item.badReasonGroup === "non-quota"; }).length
  };
});

var filteredItems = computed(function () {
  var keyword = String(filters.search || "").trim().toLowerCase();
  return sourceItems.value.filter(function (item) {
    var scope;
    if (item.badReasonGroup !== filters.group) {
      return false;
    }
    if (filters.planType !== "all" && planTypeFilterValue(item) !== filters.planType) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    scope = [item.name, item.email, item.reason, item.statusMessage, item.rawQuotaMessage, item.requestStatusText, item.badReasonLabel].join(" ").toLowerCase();
    return scope.indexOf(keyword) !== -1;
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
    deletable: selected.filter(function (item) { return item.name && !item.runtimeOnly; }).length,
    disableable: selected.filter(function (item) { return item.name && !item.runtimeOnly && !item.disabled; }).length,
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

var groupMeta = computed(function () {
  if (filters.group === "auth-401") {
    return {
      title: "401 认证异常",
      body: "这类文件优先先做认证续期；续期失败或仍未恢复时，再删除会更稳妥。",
      tone: "danger",
      button: "删除当前分类",
      pendingType: "delete-selected"
    };
  }
  if (filters.group === "quota") {
    return {
      title: "额度异常",
      body: "这类文件优先停用观察，额度恢复后再从停用池启用。",
      tone: "warn",
      button: "停用当前分类",
      pendingType: "disable-quota"
    };
  }
  return {
    title: "其他异常",
    body: "保持独立批次处理，避免和 401、额度异常互相误伤。",
    tone: "info",
    button: "删除当前分类",
    pendingType: "delete-selected"
  };
});

watch(function () {
  return filteredItems.value.length + "::" + pageSize.value + "::" + filters.group + "::" + filters.planType;
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

function pageChange(nextPage) {
  currentPage.value = Math.max(1, Math.min(nextPage, totalPages.value));
}

function togglePageSelection(checked) {
  props.consoleApp.togglePageSelection(checked, pagedItems.value);
}

function rowClass() {
  if (filters.group === "auth-401") {
    return "tone-danger";
  }
  if (filters.group === "quota") {
    return "tone-warn";
  }
  return "tone-info";
}

function actionAdvice(item) {
  if (item.badReasonGroup === "auth-401") {
    return "先做认证续期";
  }
  if (item.badReasonGroup === "quota") {
    return item.disabled ? "等待恢复后启用" : "建议停用";
  }
  return "建议先看详情再删";
}

async function handleGroupAction() {
  var list = filteredItems.value;

  if (!list.length) {
    return;
  }
  if (filters.group === "quota") {
    await props.consoleApp.setItemsDisabled(list, true, {
      confirmTitle: "确认停用额度异常",
      confirmMessage: "将停用当前筛选下的 " + list.length + " 个额度异常文件，确认继续吗？",
      confirmText: "确认停用",
      pendingType: "disable-quota",
      progressLabel: "正在准备停用额度异常…",
      sequenceLabel: "正在停用额度异常文件",
      startLog: "开始按当前筛选停用额度异常，共 " + list.length + " 个。",
      completeToastPrefix: "额度异常处理完成",
      completeLogPrefix: "额度异常处理完成",
      emptyLog: "当前没有可停用的额度异常。",
      emptyToast: "当前没有可停用的额度异常。"
    });
    return;
  }

  await props.consoleApp.deleteItems(list, {
    confirmTitle: filters.group === "auth-401" ? "确认删除 401 异常" : "确认删除其他异常",
    confirmMessage: "将删除当前筛选下的 " + list.length + " 个" + (filters.group === "auth-401" ? "401 异常" : "其他异常") + "文件，确认继续吗？",
    confirmText: "确认处理",
    pendingType: "delete-selected",
    progressLabel: "正在准备处理异常文件…",
    sequenceLabel: filters.group === "auth-401" ? "正在删除 401 异常文件" : "正在删除其他异常文件",
    startLog: "开始按当前筛选处理异常文件，共 " + list.length + " 个。",
    completeText: "异常处理完成",
    emptyLog: "当前分类下没有可处理的异常文件。",
    emptyToast: "当前分类下没有可处理的异常文件。"
  });
}

function pageSizeText(size) {
  return size + " / 页";
}
</script>

<template>
  <section class="view-shell">
    <article class="surface-card pool-toolbar">
      <div class="toolbar-main">
        <div class="title-block">
          <span class="eyebrow">Exception Center</span>
          <h3>异常处置</h3>
        </div>
        <div class="summary-tabs">
          <button class="tab-pill" :class="{ active: filters.group === 'auth-401' }" type="button" @click="filters.group = 'auth-401'">
            <span>401 异常</span>
            <strong>{{ groupCounts["auth-401"] }}</strong>
          </button>
          <button class="tab-pill" :class="{ active: filters.group === 'quota' }" type="button" @click="filters.group = 'quota'">
            <span>额度异常</span>
            <strong>{{ groupCounts.quota }}</strong>
          </button>
          <button class="tab-pill" :class="{ active: filters.group === 'non-quota' }" type="button" @click="filters.group = 'non-quota'">
            <span>其他异常</span>
            <strong>{{ groupCounts["non-quota"] }}</strong>
          </button>
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
          <button v-if="filters.group === 'quota'" class="secondary-btn" type="button" :disabled="workbenchPending() || !selectionStats.disableable" :aria-busy="props.consoleApp.isPending('disable-selected') ? 'true' : 'false'" @click="props.consoleApp.disableSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('disable-selected') }">{{ pendingText('disable-selected', '停用选中', '停用中') }}</span>
          </button>
          <button v-else class="danger-btn" type="button" :disabled="workbenchPending() || !selectionStats.deletable" :aria-busy="props.consoleApp.isPending('delete-selected') ? 'true' : 'false'" @click="props.consoleApp.deleteSelected">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('delete-selected') }">{{ pendingText('delete-selected', '删除选中', '删除中') }}</span>
          </button>
          <button class="ghost-btn" type="button" :disabled="workbenchPending() || !selectionStats.total" @click="props.consoleApp.clearSelection">清空勾选</button>
        </div>

        <button :class="filters.group === 'quota' ? 'secondary-btn' : 'danger-btn'" type="button" :disabled="workbenchPending() || !filteredItems.length" :aria-busy="props.consoleApp.isPending(groupMeta.pendingType) ? 'true' : 'false'" @click="handleGroupAction">
          <span class="button-label" :class="{ pending: props.consoleApp.isPending(groupMeta.pendingType) }">{{ pendingText(groupMeta.pendingType, groupMeta.button, '处理中') }}</span>
        </button>
      </div>
    </article>

    <article class="surface-card control-bar" :class="rowClass()">
      <div class="control-copy">
        <strong>{{ groupMeta.title }}</strong>
        <span>{{ groupMeta.body }}</span>
      </div>

      <label class="field search-field">
        <span>搜索当前分类</span>
        <input v-model="filters.search" class="text-input" placeholder="文件名、账号、异常说明">
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
    </article>

    <section class="surface-card table-shell">
      <header class="table-head">
        <label class="table-check">
          <input type="checkbox" :checked="pageSelectionState" @change="togglePageSelection($event.target.checked)">
        </label>
        <span>文件 / 账号</span>
        <span>异常说明</span>
        <span>动作建议</span>
        <span>当前状态</span>
        <span class="align-right">操作</span>
      </header>

      <div v-if="pagedItems.length" class="table-body">
        <article v-for="item in pagedItems" :key="item.key" class="table-row" :class="rowClass()">
          <div class="row-cell row-check">
            <input type="checkbox" :checked="props.consoleApp.isSelected(item.key)" :disabled="item.runtimeOnly" @change="props.consoleApp.selectRow(item.key, $event.target.checked)">
          </div>

          <div class="row-cell identity-cell">
            <strong>{{ item.name || item.email || "未命名文件" }}</strong>
            <span>{{ item.email || "未知账号" }}</span>
          </div>

          <div class="row-cell status-cell">
            <div class="status-line">
              <span class="status-badge" :class="rowClass()">{{ item.badReasonLabel || "异常" }}</span>
              <strong>{{ actionAdvice(item) }}</strong>
            </div>
            <p>{{ item.reason || item.statusMessage || "等待进一步判断" }}</p>
          </div>

          <div class="row-cell">
            <strong>{{ actionAdvice(item) }}</strong>
            <span>{{ filters.group === "quota" ? (item.disabled ? "当前已停用" : "建议停用观察") : (filters.group === "auth-401" ? "建议先做认证续期，失败后再删" : "删除前建议先打开详情确认") }}</span>
          </div>

          <div class="row-cell">
            <strong>{{ item.disabled ? "已停用" : "待处理" }}</strong>
            <span>{{ fmt(item.lastRefresh || item.updatedAt, true) }}</span>
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
            <ActionIconButton
              v-if="filters.group === 'quota'"
              :title="item.disabled ? '启用文件' : '停用文件'"
              :icon="item.disabled ? 'enable' : 'disable'"
              tone="warn"
              :disabled="workbenchPending() || rowPending(item) || !item.name || item.runtimeOnly"
              :pending="props.consoleApp.isPending('row-toggle-disabled', item.key)"
              @click="props.consoleApp.setFileDisabled(item, !item.disabled)"
            />
            <ActionIconButton
              v-else
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
        当前分类下没有异常文件。
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
.summary-tabs,
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

.summary-tabs {
  gap: 6px;
}

.tab-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-muted);
  cursor: pointer;
}

.tab-pill strong {
  color: var(--text-strong);
}

.tab-pill.active {
  background: rgba(22, 119, 255, 0.12);
  color: var(--accent-strong);
  border-color: rgba(22, 119, 255, 0.22);
}

.selection-inline {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.08);
  color: var(--text-muted);
}

.control-bar {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1fr) minmax(160px, 0.22fr) minmax(150px, 0.2fr);
  gap: 10px;
  align-items: end;
}

.control-copy {
  display: grid;
  gap: 4px;
}

.control-copy strong {
  color: var(--text-strong);
  font-size: 14px;
}

.control-copy span {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.55;
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
  grid-template-columns: 40px minmax(220px, 1.1fr) minmax(280px, 1.5fr) minmax(180px, 0.9fr) minmax(150px, 0.8fr) minmax(156px, 0.72fr);
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

.status-line,
.action-cell {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.82);
  color: currentColor;
  font-size: 11px;
  line-height: 1;
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

@media (max-width: 1360px) {
  .control-bar {
    grid-template-columns: 1fr;
  }

  .table-head,
  .table-row {
    grid-template-columns: 40px minmax(180px, 1fr) minmax(220px, 1.3fr) minmax(170px, 0.8fr) minmax(130px, 0.7fr) minmax(156px, 0.76fr);
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
}
</style>
