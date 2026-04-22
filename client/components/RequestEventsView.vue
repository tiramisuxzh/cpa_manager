<script setup>
import { computed, reactive, ref, watch } from "vue";
import SearchableSelect from "./SearchableSelect.vue";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "../lib/constants.js";
import { fmt } from "../lib/utils.js";

var props = defineProps({
  consoleApp: {
    type: Object,
    required: true
  }
});

var TIME_RANGE_OPTIONS = [
  { value: "7h", label: "最近7小时", keywords: "7 hours" },
  { value: "24h", label: "最近24小时", keywords: "24 hours" },
  { value: "7d", label: "最近7天", keywords: "7 days" },
  { value: "custom", label: "自定义区间", keywords: "custom range" }
];

var RESULT_OPTIONS = [
  { value: "success", label: "成功", keywords: "success" },
  { value: "failure", label: "失败", keywords: "failure" }
];

var filters = reactive({
  search: "",
  timeRange: "all",
  timeStart: "",
  timeEnd: "",
  model: "all",
  source: "all",
  authIndex: "all",
  result: "all"
});
var pageSize = ref(DEFAULT_PAGE_SIZE);
var currentPage = ref(1);
var summaryDetailVisible = ref(false);

var FILE_SUMMARY_CARD_DEFINITIONS = [
  { label: "请求数", key: "totalRequests", tone: "neutral" },
  { label: "成功", key: "successCount", tone: "success" },
  { label: "失败", key: "failureCount", tone: "danger" },
  { label: "输入 Tokens", key: "inputTokens", tone: "info" },
  { label: "输出 Tokens", key: "outputTokens", tone: "info" },
  { label: "思考 Tokens", key: "reasoningTokens", tone: "warn" },
  { label: "缓存 Tokens", key: "cachedTokens", tone: "violet" },
  { label: "总 Tokens", key: "totalTokens", tone: "warn" }
];

var connectionReady = computed(function () {
  return !!String(props.consoleApp.settings.baseUrl || "").trim() && !!String(props.consoleApp.settings.key || "").trim();
});

var usageCenter = computed(function () {
  return props.consoleApp.usageCenter;
});

function numberText(value) {
  return value == null ? "-" : Number(value || 0).toLocaleString("zh-CN");
}

function pageSizeText(size) {
  return size + " / 页";
}

function csvSafe(value) {
  var text = value == null ? "" : String(value);
  return "\"" + text.replace(/"/g, "\"\"") + "\"";
}

function downloadText(name, text, type) {
  var blob = new Blob([text], { type: type });
  var href = URL.createObjectURL(blob);
  var link = document.createElement("a");

  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
}

function timestampValue(value) {
  var parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function timeRangeLowerBound(range) {
  if (range === "7h") {
    return Date.now() - 7 * 60 * 60 * 1000;
  }
  if (range === "24h") {
    return Date.now() - 24 * 60 * 60 * 1000;
  }
  if (range === "7d") {
    return Date.now() - 7 * 24 * 60 * 60 * 1000;
  }
  return null;
}

function uniqueOptions(key) {
  var seen = {};
  return usageCenter.value.events.reduce(function (result, item) {
    var value = item && item[key] ? String(item[key]) : "";
    if (!value || seen[value]) {
      return result;
    }
    seen[value] = true;
    result.push({
      value: value,
      label: value,
      keywords: [
        item.fileName,
        item.email,
        item.source,
        item.authIndex
      ].join(" ")
    });
    return result;
  }, []).sort(function (left, right) {
    return left.label.localeCompare(right.label, "zh-CN");
  });
}

function uniqueValues(list) {
  var seen = {};

  return list.reduce(function (result, value) {
    var text = String(value || "").trim();
    if (!text || seen[text]) {
      return result;
    }
    seen[text] = true;
    result.push(text);
    return result;
  }, []);
}

function sumTokenField(list, key) {
  return list.reduce(function (total, item) {
    return total + Number(item && item[key] ? item[key] : 0);
  }, 0);
}

function eventIdentity(item) {
  if (item && item.authIndex) {
    return "authIndex::" + String(item.authIndex).trim();
  }
  if (item && item.fileName) {
    return "fileName::" + String(item.fileName).trim();
  }
  if (item && item.email) {
    return "email::" + String(item.email).trim();
  }
  return "";
}

var modelOptions = computed(function () {
  return uniqueOptions("model");
});

var sourceOptions = computed(function () {
  return uniqueOptions("source");
});

var authIndexOptions = computed(function () {
  return uniqueOptions("authIndex");
});

var summaryCards = computed(function () {
  var summary = usageCenter.value.summary || {};
  return [
    { label: "总请求", value: numberText(summary.totalRequests), tone: "neutral" },
    { label: "成功", value: numberText(summary.successCount), tone: "success" },
    { label: "失败", value: numberText(summary.failureCount), tone: "danger" },
    { label: "总 Tokens", value: numberText(summary.totalTokens), tone: "warn" },
    { label: "模型 / 来源", value: (summary.modelCount || 0) + " / " + (summary.sourceCount || 0), tone: "info" }
  ];
});

function matchesTimeRange(item) {
  var eventTime = timestampValue(item.timestamp);
  var startTime;
  var endTime;
  var lowerBound;

  if (filters.timeRange === "all") {
    return true;
  }
  if (!eventTime) {
    return false;
  }
  if (filters.timeRange === "custom") {
    startTime = filters.timeStart ? Date.parse(filters.timeStart) : null;
    endTime = filters.timeEnd ? Date.parse(filters.timeEnd) : null;

    if (startTime != null && !Number.isNaN(startTime) && eventTime < startTime) {
      return false;
    }
    if (endTime != null && !Number.isNaN(endTime) && eventTime > endTime) {
      return false;
    }
    return true;
  }

  lowerBound = timeRangeLowerBound(filters.timeRange);
  return lowerBound == null ? true : eventTime >= lowerBound;
}

function matchesEvent(item) {
  var keyword = String(filters.search || "").trim().toLowerCase();
  var scope;

  if (!matchesTimeRange(item)) {
    return false;
  }
  if (filters.model !== "all" && item.model !== filters.model) {
    return false;
  }
  if (filters.source !== "all" && item.source !== filters.source) {
    return false;
  }
  if (filters.authIndex !== "all" && item.authIndex !== filters.authIndex) {
    return false;
  }
  if (filters.result !== "all" && item.resultCode !== filters.result) {
    return false;
  }
  if (!keyword) {
    return true;
  }

  scope = [
    item.model,
    item.source,
    item.authIndex,
    item.fileName,
    item.email,
    item.apiLabel,
    item.resultLabel
  ].join(" ").toLowerCase();
  return scope.indexOf(keyword) !== -1;
}

var filteredEvents = computed(function () {
  return usageCenter.value.events.filter(matchesEvent);
});

var singleFileSummary = computed(function () {
  var events = filteredEvents.value;
  var identities;
  var sample;
  var resolvedAuthIndex;
  var resolvedFileName;
  var resolvedEmail;
  var latestEvent;
  var oldestEvent;
  var summaryValueMap;

  if (!events.length) {
    return null;
  }

  // 用户已经显式选了认证索引时，说明页面上下文就是“这个文件”，这里直接展示汇总，不再额外猜测。
  if (filters.authIndex === "all") {
    identities = uniqueValues(events.map(eventIdentity));
    if (identities.length !== 1) {
      return null;
    }
  }

  sample = events[0] || {};
  resolvedAuthIndex = String(filters.authIndex !== "all" ? filters.authIndex : (sample.authIndex || "")).trim();
  resolvedFileName = String(sample.fileName || "").trim();
  resolvedEmail = String(sample.email || "").trim();
  latestEvent = events.reduce(function (current, item) {
    return timestampValue(item.timestamp) > timestampValue(current.timestamp) ? item : current;
  }, events[0]);
  oldestEvent = events.reduce(function (current, item) {
    return timestampValue(item.timestamp) < timestampValue(current.timestamp) ? item : current;
  }, events[0]);
  summaryValueMap = {
    totalRequests: events.length,
    successCount: events.filter(function (item) { return item.resultCode === "success"; }).length,
    failureCount: events.filter(function (item) { return item.resultCode === "failure"; }).length,
    inputTokens: sumTokenField(events, "inputTokens"),
    outputTokens: sumTokenField(events, "outputTokens"),
    reasoningTokens: sumTokenField(events, "reasoningTokens"),
    cachedTokens: sumTokenField(events, "cachedTokens"),
    totalTokens: sumTokenField(events, "totalTokens")
  };

  return {
    title: resolvedFileName || resolvedEmail || resolvedAuthIndex || "当前筛选对象",
    subtitle: [
      resolvedEmail && resolvedEmail !== resolvedFileName ? resolvedEmail : "",
      resolvedAuthIndex ? ("认证索引 " + resolvedAuthIndex) : ""
    ].filter(Boolean).join(" · "),
    rangeText: "统计范围 " + fmt(oldestEvent.timestamp, true) + " 至 " + fmt(latestEvent.timestamp, true),
    cards: FILE_SUMMARY_CARD_DEFINITIONS.map(function (definition) {
      return {
        label: definition.label,
        tone: definition.tone,
        value: numberText(summaryValueMap[definition.key])
      };
    })
  };
});

var totalPages = computed(function () {
  return Math.max(1, Math.ceil(filteredEvents.value.length / pageSize.value));
});

var pagedEvents = computed(function () {
  var start = (currentPage.value - 1) * pageSize.value;
  return filteredEvents.value.slice(start, start + pageSize.value);
});

var activeFilterSummary = computed(function () {
  var parts = [];

  if (filters.timeRange !== "all") {
    parts.push(TIME_RANGE_OPTIONS.filter(function (option) {
      return option.value === filters.timeRange;
    })[0].label);
  }
  if (filters.model !== "all") {
    parts.push("模型 " + filters.model);
  }
  if (filters.source !== "all") {
    parts.push("来源 " + filters.source);
  }
  if (filters.authIndex !== "all") {
    parts.push("认证索引 " + filters.authIndex);
  }
  if (filters.result !== "all") {
    parts.push(filters.result === "success" ? "仅成功" : "仅失败");
  }
  return parts.length ? parts.join(" · ") : "当前未启用额外筛选";
});

watch(function () {
  return filteredEvents.value.length + "::" + pageSize.value;
}, function () {
  currentPage.value = Math.max(1, Math.min(currentPage.value, totalPages.value));
});

watch(function () {
  return !!singleFileSummary.value;
}, function (visible) {
  if (!visible) {
    summaryDetailVisible.value = false;
  }
});

function pageChange(nextPage) {
  currentPage.value = Math.max(1, Math.min(nextPage, totalPages.value));
}

function openSummaryDetail() {
  if (!singleFileSummary.value) {
    return;
  }
  summaryDetailVisible.value = true;
}

function closeSummaryDetail() {
  summaryDetailVisible.value = false;
}

function clearFilters() {
  filters.search = "";
  filters.timeRange = "all";
  filters.timeStart = "";
  filters.timeEnd = "";
  filters.model = "all";
  filters.source = "all";
  filters.authIndex = "all";
  filters.result = "all";
}

function pendingText(type, idleText, loadingText, key) {
  return props.consoleApp.isPending(type, key) ? loadingText : idleText;
}

function refreshDisabled() {
  return !connectionReady.value || props.consoleApp.isPending("usage-events-refresh");
}

function syncText() {
  if (props.consoleApp.isPending("usage-events-refresh")) {
    return "正在同步请求事件明细…";
  }
  if (usageCenter.value.loadedAt) {
    return "最近同步 " + usageCenter.value.loadedAt;
  }
  if (!connectionReady.value) {
    return "请先完成连接配置";
  }
  if (props.consoleApp.service.usageStatisticsEnabled === false) {
    return "服务端当前未开启 Usage 统计";
  }
  return "点击刷新后开始拉取请求事件明细";
}

async function refreshEvents() {
  await props.consoleApp.loadUsageEvents();
}

async function enableUsageStats() {
  await props.consoleApp.updateServiceFlag("usageStatisticsEnabled", true);
}

function exportCsv() {
  if (!filteredEvents.value.length) {
    return;
  }

  var header = [
    "时间",
    "模型名称",
    "来源",
    "认证索引",
    "结果",
    "文件名",
    "账号",
    "输入 Tokens",
    "输出 Tokens",
    "思考 Tokens",
    "缓存 Tokens",
    "总 Tokens"
  ];
  var rows = filteredEvents.value.map(function (item) {
    return [
      item.timestamp || "",
      item.model || "",
      item.source || "",
      item.authIndex || "",
      item.resultLabel || "",
      item.fileName || "",
      item.email || "",
      item.inputTokens,
      item.outputTokens,
      item.reasoningTokens,
      item.cachedTokens,
      item.totalTokens
    ].map(csvSafe).join(",");
  });

  downloadText(
    "usage-events-" + Date.now() + ".csv",
    [header.map(csvSafe).join(",")].concat(rows).join("\n"),
    "text/csv;charset=utf-8"
  );
}

function exportJson() {
  if (!filteredEvents.value.length) {
    return;
  }

  downloadText(
    "usage-events-filtered-" + Date.now() + ".json",
    JSON.stringify({
      exportedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      filters: {
        search: filters.search,
        timeRange: filters.timeRange,
        timeStart: filters.timeStart,
        timeEnd: filters.timeEnd,
        model: filters.model,
        source: filters.source,
        authIndex: filters.authIndex,
        result: filters.result
      },
      summary: usageCenter.value.summary,
      total: filteredEvents.value.length,
      events: filteredEvents.value
    }, null, 2),
    "application/json;charset=utf-8"
  );
}

function stateClass(code) {
  return code === "failure" ? "tone-danger" : "tone-success";
}

function emptyTitle() {
  if (!connectionReady.value) {
    return "请先配置管理连接";
  }
  if (props.consoleApp.service.usageStatisticsEnabled === false) {
    return "服务端未开启 Usage 统计";
  }
  if (usageCenter.value.error) {
    return usageCenter.value.error;
  }
  if (!usageCenter.value.synced) {
    return "请求事件明细尚未加载";
  }
  return "当前筛选下没有请求事件";
}

function emptyBody() {
  if (!connectionReady.value) {
    return "先在系统设置里填写管理地址和 Management Key，再回来刷新请求事件明细。";
  }
  if (props.consoleApp.service.usageStatisticsEnabled === false) {
    return "CliProxyApi 的 Usage 统计开关关闭时，管理接口不会返回可用的请求事件明细。";
  }
  if (!usageCenter.value.synced) {
    return "我查了官方管理 API 文档，/usage 文档里没有单独写时间范围查询参数，所以这版先基于事件时间戳做前端筛选；先刷新把明细拉下来就可以用了。";
  }
  return "可以调整时间范围、模型、来源、认证索引、结果或关键字筛选范围。";
}
</script>

<template>
  <section class="view-shell">
    <article class="surface-card hero-panel">
      <div class="hero-main">
        <div class="hero-copy">
          <span class="eyebrow">Usage Events</span>
          <h3>请求事件明细</h3>
          <p>{{ syncText() }}</p>
        </div>

        <div class="hero-actions">
          <button
            class="secondary-btn"
            type="button"
            :disabled="refreshDisabled()"
            :aria-busy="props.consoleApp.isPending('usage-events-refresh') ? 'true' : 'false'"
            @click="refreshEvents"
          >
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('usage-events-refresh') }">{{ pendingText('usage-events-refresh', '刷新明细', '同步中') }}</span>
          </button>
          <button
            v-if="props.consoleApp.service.usageStatisticsEnabled === false"
            class="primary-btn"
            type="button"
            :disabled="props.consoleApp.isPending('service-flags', 'usageStatisticsEnabled')"
            :aria-busy="props.consoleApp.isPending('service-flags', 'usageStatisticsEnabled') ? 'true' : 'false'"
            @click="enableUsageStats"
          >
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('service-flags', 'usageStatisticsEnabled') }">{{ pendingText('service-flags', '启用 Usage 统计', '启用中', 'usageStatisticsEnabled') }}</span>
          </button>
          <button class="ghost-btn" type="button" :disabled="!filteredEvents.length" @click="clearFilters">清空筛选</button>
          <button class="ghost-btn" type="button" :disabled="!filteredEvents.length" @click="exportCsv">导出 CSV</button>
          <button class="ghost-btn" type="button" :disabled="!filteredEvents.length" @click="exportJson">导出 JSON</button>
        </div>
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
    </article>

    <article class="surface-card filter-panel">
      <div class="filter-head">
        <div class="filter-copy">
          <span class="section-kicker">Filters</span>
          <strong>筛选与时间范围</strong>
          <p>{{ activeFilterSummary }}</p>
        </div>
        <div class="filter-head-actions">
          <button v-if="singleFileSummary" class="secondary-btn" type="button" @click="openSummaryDetail">汇总详情</button>
          <small>时间范围基于当前已拉取的事件时间戳做前端过滤。</small>
        </div>
      </div>

      <div class="filter-grid">
        <label class="field search-field">
          <span>搜索</span>
          <input v-model="filters.search" class="text-input" placeholder="模型、来源、认证索引、文件名、账号">
        </label>

        <label class="field">
          <span>时间范围</span>
          <SearchableSelect
            v-model="filters.timeRange"
            :options="TIME_RANGE_OPTIONS"
            :searchable="false"
            all-label="全部时间"
          />
        </label>

        <label v-if="filters.timeRange === 'custom'" class="field">
          <span>开始时间</span>
          <input v-model="filters.timeStart" class="text-input" type="datetime-local">
        </label>

        <label v-if="filters.timeRange === 'custom'" class="field">
          <span>结束时间</span>
          <input v-model="filters.timeEnd" class="text-input" type="datetime-local">
        </label>

        <label class="field">
          <span>模型</span>
          <SearchableSelect
            v-model="filters.model"
            :options="modelOptions"
            all-label="全部模型"
          />
        </label>

        <label class="field">
          <span>来源</span>
          <SearchableSelect
            v-model="filters.source"
            :options="sourceOptions"
            all-label="全部来源"
          />
        </label>

        <label class="field">
          <span>认证索引</span>
          <SearchableSelect
            v-model="filters.authIndex"
            :options="authIndexOptions"
            all-label="全部索引"
          />
        </label>

        <label class="field">
          <span>结果</span>
          <SearchableSelect
            v-model="filters.result"
            :options="RESULT_OPTIONS"
            :searchable="false"
            all-label="全部结果"
          />
        </label>

        <label class="field">
          <span>每页条数</span>
          <select v-model.number="pageSize" class="select-input">
            <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ pageSizeText(size) }}</option>
          </select>
        </label>
      </div>
    </article>

    <section class="surface-card table-shell">
      <header class="table-head">
        <span>时间</span>
        <span>模型名称</span>
        <span>来源</span>
        <span>认证索引</span>
        <span>结果</span>
        <span>输入 Tokens</span>
        <span>输出 Tokens</span>
        <span>思考 Tokens</span>
        <span>缓存 Tokens</span>
        <span>总 Tokens</span>
      </header>

      <div v-if="pagedEvents.length" class="table-body">
        <article v-for="item in pagedEvents" :key="item.id" class="table-row">
          <div class="row-cell time-row-cell">
            <strong>{{ fmt(item.timestamp, true) }}</strong>
            <span>{{ item.apiLabel || "usage" }}</span>
          </div>

          <div class="row-cell text-row-cell">
            <strong>{{ item.model || "--" }}</strong>
            <span>{{ item.fileName || item.email || "未匹配到文件" }}</span>
          </div>

          <div class="row-cell text-row-cell">
            <strong>{{ item.source || "--" }}</strong>
            <span>{{ item.email || item.fileName || "来源未附带账号" }}</span>
          </div>

          <div class="row-cell text-row-cell">
            <strong>{{ item.authIndex || "--" }}</strong>
            <span>{{ item.fileName || "未匹配文件名" }}</span>
          </div>

          <div class="row-cell">
            <span class="result-badge" :class="stateClass(item.resultCode)">{{ item.resultLabel }}</span>
          </div>

          <div class="row-cell token-cell">
            <strong>{{ numberText(item.inputTokens) }}</strong>
          </div>

          <div class="row-cell token-cell">
            <strong>{{ numberText(item.outputTokens) }}</strong>
          </div>

          <div class="row-cell token-cell">
            <strong>{{ numberText(item.reasoningTokens) }}</strong>
          </div>

          <div class="row-cell token-cell">
            <strong>{{ numberText(item.cachedTokens) }}</strong>
          </div>

          <div class="row-cell token-cell">
            <strong>{{ numberText(item.totalTokens) }}</strong>
          </div>
        </article>
      </div>

      <div v-else class="table-empty">
        <strong>{{ emptyTitle() }}</strong>
        <p>{{ emptyBody() }}</p>
      </div>
    </section>

    <footer class="surface-card page-footer">
      <span>共 {{ filteredEvents.length }} 条，当前每页 {{ pageSize }} 条</span>
      <div class="footer-actions">
        <button class="mini-btn" type="button" :disabled="currentPage <= 1" @click="pageChange(currentPage - 1)">上一页</button>
        <span class="page-indicator">{{ currentPage }} / {{ totalPages }}</span>
        <button class="mini-btn" type="button" :disabled="currentPage >= totalPages" @click="pageChange(currentPage + 1)">下一页</button>
      </div>
    </footer>

    <transition name="summary-fade">
      <div v-if="summaryDetailVisible && singleFileSummary" class="summary-mask" @click.self="closeSummaryDetail">
        <aside class="summary-panel">
          <header class="summary-panel-header">
            <div class="summary-panel-copy">
              <span class="section-kicker">Focused File</span>
              <strong>当前文件统计</strong>
              <p>{{ singleFileSummary.title }}</p>
              <small v-if="singleFileSummary.subtitle">{{ singleFileSummary.subtitle }}</small>
            </div>
            <button class="ghost-btn" type="button" @click="closeSummaryDetail">关闭</button>
          </header>

          <div class="summary-panel-meta">
            <span>{{ singleFileSummary.rangeText }}</span>
          </div>

          <div class="summary-panel-grid">
            <article
              v-for="card in singleFileSummary.cards"
              :key="card.label"
              class="summary-stat-card"
              :class="'tone-' + card.tone"
            >
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
            </article>
          </div>
        </aside>
      </div>
    </transition>
  </section>
</template>

<style scoped>
.view-shell {
  min-height: 0;
  display: grid;
  gap: 12px;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.hero-panel,
.filter-panel,
.table-shell,
.page-footer {
  padding: 14px 16px;
  min-width: 0;
}

.hero-panel {
  display: grid;
  gap: 14px;
}

.hero-main,
.summary-row,
.hero-actions,
.footer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.hero-main {
  justify-content: space-between;
}

.hero-copy {
  display: grid;
  gap: 8px;
}

.hero-copy h3,
.filter-copy strong {
  margin: 0;
  font-family: var(--font-display);
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.hero-copy h3 {
  font-size: 26px;
}

.hero-copy p,
.filter-copy p,
.filter-head small,
.table-empty p,
.page-footer span,
.page-indicator {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
}

.filter-panel,
.page-footer {
  display: grid;
  gap: 14px;
}

.filter-panel {
  position: relative;
  z-index: 2;
  overflow: visible;
}

.filter-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.filter-copy {
  display: grid;
  gap: 6px;
}

.filter-head-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.section-kicker {
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.filter-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) repeat(5, minmax(150px, 0.6fr));
  gap: 10px;
  align-items: end;
}

.search-field {
  grid-column: 1 / span 2;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 0;
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
  position: relative;
  z-index: 1;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.95fr) minmax(170px, 0.95fr) minmax(180px, 1fr) minmax(160px, 1fr) 90px repeat(5, minmax(105px, 0.72fr));
  gap: 12px;
  align-items: center;
}

.table-head {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--text-muted);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  overflow: auto hidden;
}

.table-body {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 6px;
  padding-top: 8px;
}

.table-row {
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(24, 34, 52, 0.06);
}

.row-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
  align-content: start;
}

.row-cell strong {
  color: var(--text-strong);
  font-size: 13px;
  line-height: 1.45;
  min-width: 0;
}

.row-cell span {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.55;
  min-width: 0;
}

.time-row-cell strong,
.token-cell strong {
  white-space: nowrap;
}

.text-row-cell strong,
.text-row-cell span {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.text-row-cell span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.token-cell strong {
  font-family: var(--font-display);
  font-size: 18px;
}

.result-badge {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12px;
  line-height: 1;
}

.result-badge.tone-success {
  color: var(--success);
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.18);
}

.result-badge.tone-danger {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.16);
}

.table-empty {
  min-height: 0;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}

.table-empty strong {
  color: var(--text-strong);
  font-size: 16px;
}

.page-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.summary-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(6px);
}

.summary-panel {
  width: min(560px, 100vw);
  height: 100%;
  padding: 18px;
  background: rgba(255, 255, 255, 0.96);
  border-left: 1px solid var(--line-soft);
  box-shadow: -24px 0 60px rgba(15, 23, 42, 0.12);
  display: grid;
  gap: 16px;
  align-content: start;
  overflow: auto;
}

.summary-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.summary-panel-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.summary-panel-copy strong {
  margin: 0;
  font-family: var(--font-display);
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.summary-panel-copy p,
.summary-panel-copy small,
.summary-panel-meta span {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.summary-panel-meta {
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(22, 119, 255, 0.06);
  border: 1px solid rgba(22, 119, 255, 0.12);
}

.summary-panel-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-stat-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.9);
}

.summary-stat-card span {
  color: var(--text-muted);
  font-size: 12px;
}

.summary-stat-card strong {
  color: var(--text-strong);
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1.1;
}

.summary-fade-enter-active,
.summary-fade-leave-active {
  transition: opacity 0.18s ease;
}

.summary-fade-enter-from,
.summary-fade-leave-to {
  opacity: 0;
}

@media (max-width: 1680px) {
  .filter-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .search-field {
    grid-column: 1 / -1;
  }
}

@media (max-width: 1200px) {
  .filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }

  .filter-head-actions,
  .summary-panel-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-panel-grid {
    grid-template-columns: 1fr;
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

  .time-row-cell strong,
  .token-cell strong {
    white-space: normal;
  }
}
</style>
