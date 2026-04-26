<script setup>
import { computed, onBeforeUnmount, onMounted } from "vue";
import { fmt, rawTimeText } from "../lib/utils.js";

var props = defineProps({
  item: {
    type: Object,
    default: null
  },
  isPending: {
    type: Function,
    required: true
  }
});

var emit = defineEmits([
  "close",
  "refresh"
]);

function closeOnEscape(event) {
  if (event.key === "Escape" && props.item) {
    emit("close");
  }
}

onMounted(function () {
  window.addEventListener("keydown", closeOnEscape);
});

onBeforeUnmount(function () {
  window.removeEventListener("keydown", closeOnEscape);
});

function buildTimeRow(label, value, emptyText) {
  if (!value) {
    return {
      label: label,
      value: emptyText || "未写入",
      hint: ""
    };
  }

  return {
    label: label + "（本地）",
    value: fmt(value, true, { withSeconds: true }),
    hint: "原始值 " + rawTimeText(value)
  };
}

var summaryRows = computed(function () {
  var item = props.item || {};
  var content = item.credentialContent || {};

  return [
    { label: "文件名", value: item.name || "未命名", hint: "" },
    { label: "账号", value: item.email || content.email || "未知", hint: "" },
    { label: "Account ID", value: content.account_id || item.accountId || "未写入", hint: "" },
    { label: "类型", value: content.type || item.provider || "unknown", hint: "" },
    buildTimeRow("最近刷新", item.lastRefresh, "未写入"),
    buildTimeRow("Access Token 过期", item.expired, "未写入"),
    buildTimeRow("凭证信息同步时间", item.credentialFetchedAt, "未同步")
  ];
});

var statusText = computed(function () {
  var item = props.item || {};

  if (props.isPending("row-credential-info", item.key)) {
    return "正在同步凭证信息";
  }
  if (item.credentialInfoStatus === "error") {
    return "同步失败";
  }
  if (item.credentialInfoStatus === "success") {
    return "已同步";
  }
  return "未同步";
});

var rawJsonText = computed(function () {
  return props.item && props.item.credentialText ? props.item.credentialText : "";
});
</script>

<template>
  <Teleport to="body">
    <transition name="drawer-fade">
      <div v-if="item" class="drawer-mask" @click.self="emit('close')">
        <aside class="drawer-panel">
          <header class="drawer-header">
            <div class="header-copy">
              <span class="eyebrow">Credential</span>
              <div class="title-row">
                <h3>凭证完整信息</h3>
                <button class="ghost-btn" type="button" @click="emit('close')">关闭</button>
              </div>
              <p>{{ item.name || item.email || "未命名文件" }}</p>
            </div>

            <div class="header-actions">
              <span class="pill" :class="item.credentialInfoStatus === 'error' ? 'tone-danger' : (item.credentialInfoStatus === 'success' ? 'tone-success' : 'tone-neutral')">
                <span>当前状态</span>
                <strong>{{ statusText }}</strong>
              </span>
              <button class="primary-btn" type="button" :disabled="!item.name || item.runtimeOnly" :aria-busy="isPending('row-credential-info', item.key) ? 'true' : 'false'" @click="emit('refresh', item)">
                <span class="button-label" :class="{ pending: isPending('row-credential-info', item.key) }">{{ isPending('row-credential-info', item.key) ? "同步中" : "同步凭证信息" }}</span>
              </button>
            </div>
          </header>

          <section class="surface-card info-card">
            <div class="section-head">
              <span class="section-kicker">Summary</span>
              <strong>关键字段</strong>
            </div>

            <dl class="detail-grid">
              <template v-for="row in summaryRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>
                  <span>{{ row.value }}</span>
                  <small v-if="row.hint" class="detail-hint">{{ row.hint }}</small>
                </dd>
              </template>
            </dl>
          </section>

          <section v-if="item.credentialInfoError" class="surface-card error-card">
            <div class="section-head">
              <span class="section-kicker">Error</span>
              <strong>错误信息</strong>
            </div>
            <p>{{ item.credentialInfoError }}</p>
          </section>

          <section class="surface-card json-card">
            <div class="section-head">
              <span class="section-kicker">JSON</span>
              <strong>原始凭证内容</strong>
            </div>
            <pre v-if="rawJsonText" class="json-box">{{ rawJsonText }}</pre>
            <p v-else class="empty-text">当前还没有拉取到凭证 JSON，先点击“同步凭证信息”。</p>
          </section>
        </aside>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(8px);
}

.drawer-panel {
  width: min(760px, 100%);
  height: 100%;
  padding: 16px;
  display: grid;
  gap: 12px;
  overflow: auto;
  background:
    radial-gradient(circle at 12% 12%, rgba(22, 119, 255, 0.1), transparent 28%),
    linear-gradient(180deg, rgba(250, 252, 255, 0.98), rgba(243, 247, 253, 0.98));
  box-shadow: -20px 0 60px rgba(15, 23, 42, 0.16);
}

.drawer-header,
.info-card,
.error-card,
.json-card {
  padding: 16px;
}

.drawer-header {
  display: grid;
  gap: 12px;
}

.header-copy,
.section-head {
  display: grid;
  gap: 6px;
}

.title-row,
.header-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.title-row h3,
.section-head strong {
  margin: 0;
  font-family: var(--font-display);
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.title-row h3 {
  font-size: 28px;
}

.header-copy p,
.error-card p,
.empty-text {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.8;
}

.section-kicker {
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.detail-grid {
  margin: 0;
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 10px 16px;
}

.detail-grid dt {
  color: var(--text-muted);
  font-size: 12px;
}

.detail-grid dd {
  margin: 0;
  display: grid;
  gap: 4px;
  color: var(--text-strong);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.detail-hint {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.6;
}

.error-card {
  border: 1px solid rgba(220, 38, 38, 0.12);
  background: rgba(255, 244, 244, 0.92);
}

.json-box {
  margin: 0;
  max-height: min(56vh, 620px);
  overflow: auto;
  padding: 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.92);
  color: #dbeafe;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.22s ease;
}

.drawer-fade-enter-active .drawer-panel,
.drawer-fade-leave-active .drawer-panel {
  transition: transform 0.24s ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-fade-enter-from .drawer-panel,
.drawer-fade-leave-to .drawer-panel {
  transform: translateX(16px);
}

@media (max-width: 720px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
