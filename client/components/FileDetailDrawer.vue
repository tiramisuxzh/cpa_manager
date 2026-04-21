<script setup>
import { computed, onBeforeUnmount, onMounted } from "vue";
import { PENDING_GROUPS } from "../lib/constants.js";
import { fmt, isNum } from "../lib/utils.js";

var props = defineProps({
  item: {
    type: Object,
    default: null
  },
  isPending: {
    type: Function,
    required: true
  },
  hasPending: {
    type: Function,
    required: true
  }
});

var emit = defineEmits([
  "close",
  "refresh",
  "copy",
  "toggle-disabled",
  "delete"
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

var detailRows = computed(function () {
  if (!props.item) {
    return [];
  }

  return [
    ["文件名", props.item.name || "未命名"],
    ["账号", props.item.email || "未知"],
    ["平台", props.item.provider || "codex"],
    ["状态", props.item.status || "unknown"],
    ["额度接口", props.item.requestStatusText || "等待请求"],
    ["额度状态", props.item.quotaStateLabel || "等待额度"],
    ["健康度", props.item.health || "待获取"],
    ["套餐", props.item.planType || "unknown"],
    ["账号类型", props.item.accountType || "未标注"],
    ["异常分类", props.item.badReasonLabel || (props.item.tone === "warn" ? props.item.quotaStateLabel : "无")],
    ["文件开关", props.item.disabled ? "已停用" : "启用中"],
    ["会话重置", props.item.chatQuota && props.item.chatQuota.resetAt ? fmt(props.item.chatQuota.resetAt, true) : "等待返回"],
    ["代码重置", props.item.codeQuota && props.item.codeQuota.resetAt ? fmt(props.item.codeQuota.resetAt, true) : "等待返回"],
    ["最近刷新", fmt(props.item.lastRefresh || props.item.updatedAt, true)]
  ];
});

var advice = computed(function () {
  if (!props.item) {
    return { title: "", body: "", tone: "tone-neutral" };
  }
  if (props.item.badReasonGroup === "quota") {
    return {
      title: "建议优先停用观察",
      body: "这类异常更像额度耗尽，不建议第一时间删除。先停用，额度恢复后再回到池视图中启用。",
      tone: "tone-warn"
    };
  }
  if (props.item.badReasonGroup === "auth-401") {
    return {
      title: "建议优先替换或删除",
      body: "401 往往意味着认证凭证已失效，这类文件自恢复概率低，通常更适合直接替换或删除。",
      tone: "tone-danger"
    };
  }
  if (props.item.disabled && props.item.tone !== "bad") {
    return {
      title: "建议先刷新再启用",
      body: "当前文件已经停用且不在异常态，适合先刷新确认额度与 usage，再决定是否重新放回运行池。",
      tone: "tone-violet"
    };
  }
  if (props.item.tone === "bad") {
    return {
      title: "建议先核对详情再操作",
      body: "这类异常不一定都适合直接删除，先结合接口状态、额度窗口和 usage 统计判断会更稳。",
      tone: "tone-info"
    };
  }
  return {
    title: "当前状态稳定",
    body: "该文件目前没有明显异常，适合继续使用。如果要调整，优先用刷新与详情确认。",
    tone: "tone-success"
  };
});

var statusPills = computed(function () {
  if (!props.item) {
    return [];
  }
  var list = [
    { label: props.item.health || "待获取", tone: props.item.tone || "neutral" },
    { label: props.item.provider || "codex", tone: "neutral" },
    { label: props.item.planType || "unknown", tone: "neutral" }
  ];

  if (props.item.badReasonLabel) {
    list.push({
      label: props.item.badReasonLabel,
      tone: props.item.badReasonGroup === "quota" ? "warn" : "danger"
    });
  } else if (props.item.quotaStateLabel && props.item.quotaStateCode !== "healthy") {
    list.push({
      label: props.item.quotaStateLabel,
      tone: props.item.tone === "warn" ? "info" : "neutral"
    });
  }
  if (props.item.requestStatusText) {
    list.push({ label: props.item.requestStatusText, tone: props.item.badReasonGroup ? "danger" : "neutral" });
  }
  if (props.item.disabled) {
    list.push({ label: "disabled", tone: "violet" });
  }
  return list;
});

function badgeClass(tone) {
  return "pill tone-" + (tone || "neutral");
}

function pendingText(type, idleText, loadingText, key) {
  return props.isPending(type, key) ? loadingText : idleText;
}

function workbenchPending() {
  return props.hasPending(PENDING_GROUPS.workbench);
}

function currentRowPending() {
  return props.item ? props.hasPending(PENDING_GROUPS.row, props.item.key) : false;
}

function refreshDisabled() {
  return !props.item || !props.item.authIndex || !props.item.accountId || workbenchPending() || currentRowPending();
}

function toggleDisabled() {
  return !props.item || !props.item.name || props.item.runtimeOnly || workbenchPending() || currentRowPending();
}

function deleteDisabled() {
  return !props.item || !props.item.name || props.item.runtimeOnly || workbenchPending() || currentRowPending();
}
</script>

<template>
  <Teleport to="body">
    <transition name="drawer-fade">
      <div v-if="item" class="drawer-mask" @click.self="emit('close')">
        <aside class="drawer-panel">
          <header class="drawer-header">
            <div class="header-main">
              <span class="eyebrow">File Detail</span>
              <div class="title-row">
                <h3>{{ item.email || item.name }}</h3>
                <button class="ghost-btn" type="button" @click="emit('close')">关闭</button>
              </div>
              <p>{{ item.name || "未命名文件" }}</p>
              <div class="pill-row">
                <span
                  v-for="pill in statusPills"
                  :key="pill.label + pill.tone"
                  :class="badgeClass(pill.tone)"
                >
                  {{ pill.label }}
                </span>
              </div>
            </div>

            <div class="action-row">
              <button class="primary-btn" type="button" :disabled="refreshDisabled()" :aria-busy="isPending('row-refresh', item.key) ? 'true' : 'false'" @click="emit('refresh', item)">
                <span class="button-label" :class="{ pending: isPending('row-refresh', item.key) }">{{ pendingText('row-refresh', '刷新额度', '刷新中', item.key) }}</span>
              </button>
              <button class="secondary-btn" type="button" :disabled="!item.name" @click="emit('copy', item)">复制文件名</button>
              <button class="secondary-btn" type="button" :disabled="toggleDisabled()" :aria-busy="isPending('row-toggle-disabled', item.key) ? 'true' : 'false'" @click="emit('toggle-disabled', item)">
                <span class="button-label" :class="{ pending: isPending('row-toggle-disabled', item.key) }">{{ pendingText('row-toggle-disabled', item.disabled ? '启用文件' : '停用文件', item.disabled ? '启用中' : '停用中', item.key) }}</span>
              </button>
              <button class="danger-btn" type="button" :disabled="deleteDisabled()" :aria-busy="isPending('row-delete', item.key) ? 'true' : 'false'" @click="emit('delete', item)">
                <span class="button-label" :class="{ pending: isPending('row-delete', item.key) }">{{ pendingText('row-delete', '删除文件', '删除中', item.key) }}</span>
              </button>
            </div>
          </header>

          <section class="surface-card advice-card" :class="advice.tone">
            <div class="advice-head">
              <span class="section-kicker">Action</span>
              <strong>{{ advice.title }}</strong>
            </div>
            <p>{{ advice.body }}</p>
          </section>

          <section class="surface-card metric-card">
            <div class="section-head">
              <span class="section-kicker">Quota & Usage</span>
              <strong>额度与 Usage</strong>
            </div>

            <div class="metric-grid">
              <article class="metric-box">
                <small>会话剩余</small>
                <strong>{{ item.chatQuota && isNum(item.chatQuota.left) ? item.chatQuota.left + "%" : "--" }}</strong>
                <span>{{ item.chatQuota && item.chatQuota.resetAt ? fmt(item.chatQuota.resetAt, true) : "等待返回" }}</span>
              </article>
              <article class="metric-box">
                <small>代码剩余</small>
                <strong>{{ item.codeQuota && isNum(item.codeQuota.left) ? item.codeQuota.left + "%" : "--" }}</strong>
                <span>{{ item.codeQuota && item.codeQuota.resetAt ? fmt(item.codeQuota.resetAt, true) : "等待返回" }}</span>
              </article>
              <article class="metric-box success-box">
                <small>Usage 成功</small>
                <strong>{{ item.usageSuccessCount == null ? "-" : item.usageSuccessCount }}</strong>
                <span>成功请求累计数</span>
              </article>
              <article class="metric-box failure-box">
                <small>Usage 失败</small>
                <strong>{{ item.usageFailureCount == null ? "-" : item.usageFailureCount }}</strong>
                <span>失败请求累计数</span>
              </article>
            </div>
          </section>

          <section class="surface-card info-card">
            <div class="section-head">
              <span class="section-kicker">Snapshot</span>
              <strong>身份与状态</strong>
            </div>

            <dl class="detail-grid">
              <template v-for="row in detailRows" :key="row[0]">
                <dt>{{ row[0] }}</dt>
                <dd>{{ row[1] }}</dd>
              </template>
            </dl>
          </section>

          <section class="surface-card log-card">
            <div class="section-head">
              <span class="section-kicker">Detail</span>
              <strong>原始说明</strong>
            </div>

            <div class="message-grid">
              <article class="message-box">
                <small>当前说明</small>
                <p>{{ item.reason || "暂无" }}</p>
              </article>
              <article class="message-box">
                <small>原始额度返回</small>
                <p>{{ item.rawQuotaMessage || item.quotaError || "暂无" }}</p>
              </article>
              <article v-if="item.statusMessage" class="message-box">
                <small>文件状态消息</small>
                <p>{{ item.statusMessage }}</p>
              </article>
              <article v-if="item.promoMessage" class="message-box">
                <small>附加信息</small>
                <p>{{ item.promoMessage }}</p>
              </article>
              <article v-if="item.quotaError" class="message-box">
                <small>额度错误</small>
                <p>{{ item.quotaError }}</p>
              </article>
            </div>
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
  z-index: 50;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(8px);
}

.drawer-panel {
  width: min(620px, 100%);
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
.advice-card,
.metric-card,
.info-card,
.log-card {
  padding: 14px;
}

.drawer-header {
  display: grid;
  gap: 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-soft);
}

.header-main {
  display: grid;
  gap: 8px;
}

.title-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.title-row h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1.04;
  letter-spacing: -0.05em;
  color: var(--ink-strong);
  overflow-wrap: anywhere;
}

.header-main p,
.advice-card p {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.pill-row,
.action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.section-head,
.advice-head {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}

.section-kicker {
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.section-head strong,
.advice-head strong {
  color: var(--text-strong);
  font-size: 15px;
}

.metric-grid,
.message-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric-box,
.message-box {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(24, 34, 52, 0.06);
}

.metric-box small,
.message-box small {
  color: var(--text-muted);
  font-size: 12px;
}

.metric-box strong {
  color: var(--text-strong);
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
}

.metric-box.success-box {
  border-color: rgba(34, 197, 94, 0.16);
  background: rgba(34, 197, 94, 0.08);
}

.metric-box.failure-box {
  border-color: rgba(239, 68, 68, 0.16);
  background: rgba(239, 68, 68, 0.06);
}

.metric-box.success-box strong {
  color: var(--success);
}

.metric-box.failure-box strong {
  color: var(--danger);
}

.metric-box span,
.message-box p {
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.metric-box span,
.detail-grid dd,
.message-box p {
  min-width: 0;
}

.message-box p {
  max-height: 140px;
  overflow: auto;
  padding-right: 4px;
}

.detail-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px 12px;
  margin: 0;
}

.detail-grid dt {
  color: var(--text-muted);
  font-size: 12px;
}

.detail-grid dd {
  margin: 0;
  color: var(--text-strong);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.18s ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

@media (max-width: 760px) {
  .metric-grid,
  .message-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .title-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
