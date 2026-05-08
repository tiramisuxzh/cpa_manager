<script setup>
import { computed } from "vue";
import { PENDING_GROUPS } from "../lib/constants.js";

var emit = defineEmits(["open-route"]);
var props = defineProps({
  consoleApp: {
    type: Object,
    required: true
  }
});

var connectionReady = computed(function () {
  return !!String(props.consoleApp.settings.baseUrl || "").trim() && !!String(props.consoleApp.settings.key || "").trim();
});
var oauth = computed(function () {
  return props.consoleApp.oauthLogin || {};
});
var statusMeta = computed(function () {
  var status = String(oauth.value.status || "idle");

  if (status === "starting") {
    return {
      tone: "info",
      label: "启动中"
    };
  }
  if (status === "waiting") {
    return {
      tone: "info",
      label: oauth.value.polling ? "等待登录（轮询中）" : "等待登录"
    };
  }
  if (status === "success") {
    return {
      tone: "success",
      label: oauth.value.autoSyncing ? "登录成功（同步中）" : "登录成功"
    };
  }
  if (status === "error") {
    return {
      tone: "danger",
      label: "登录失败"
    };
  }
  return {
    tone: "neutral",
    label: "未开始"
  };
});
var callbackMeta = computed(function () {
  var status = String(oauth.value.callbackStatus || "idle");

  if (status === "submitting") {
    return {
      tone: "info",
      label: "提交中"
    };
  }
  if (status === "success") {
    return {
      tone: "success",
      label: "已提交"
    };
  }
  if (status === "error") {
    return {
      tone: "danger",
      label: "提交失败"
    };
  }
  return {
    tone: "neutral",
    label: "未提交"
  };
});
var statusFacts = computed(function () {
  return [
    {
      label: "启动时间",
      value: oauth.value.startedAt || "尚未开始"
    },
    {
      label: "最近检查",
      value: oauth.value.lastCheckedAt || "尚未轮询"
    },
    {
      label: "完成时间",
      value: oauth.value.completedAt || "尚未完成"
    },
    {
      label: "最近同步",
      value: oauth.value.lastSyncedAt || "尚未同步"
    }
  ];
});

function workbenchPending() {
  return props.consoleApp.hasPending(PENDING_GROUPS.workbench);
}

function pendingText(type, idleText, loadingText) {
  return props.consoleApp.isPending(type) ? loadingText : idleText;
}

function openAuthUrl() {
  if (!oauth.value.authUrl) {
    return;
  }
  window.open(oauth.value.authUrl, "_blank", "noopener,noreferrer");
}

async function copyAuthUrl() {
  if (!oauth.value.authUrl || !navigator.clipboard || !navigator.clipboard.writeText) {
    props.consoleApp.notify("当前环境不支持复制登录链接。", "info");
    return;
  }

  try {
    await navigator.clipboard.writeText(oauth.value.authUrl);
    props.consoleApp.notify("已复制 OAuth 登录链接。", "success");
  } catch (_) {
    props.consoleApp.notify("复制登录链接失败，请手动复制。", "danger");
  }
}

function openFilePool() {
  emit("open-route", "files");
}
</script>

<template>
  <section class="view-shell">
    <article class="surface-card hero-panel">
      <div>
        <span class="eyebrow">OAuth</span>
        <h3>原生 OAuth 登录</h3>
      </div>
      <p>这里直接接入 cliproxyapi 官方管理中心同款的原生 OAuth 流程，不走 iframe。登录成功后，会先轻量刷新文件列表，再只给本次目标文件补拉凭证详情，避免整池重复刷新。</p>
    </article>

    <div class="content-grid">
      <article class="surface-card oauth-card wide-card">
        <div class="card-head">
          <div class="card-copy">
            <h4>Codex OAuth 登录</h4>
          <p class="meta-copy">先生成登录链接，再在浏览器中完成 OpenAI / Codex 授权。若服务端未自动拿到回调，可在下方手动提交最终跳转地址。</p>
          </div>
          <span class="pill" :class="'tone-' + statusMeta.tone">
            <span>当前状态</span>
            <strong>{{ statusMeta.label }}</strong>
          </span>
        </div>

        <div class="status-grid">
          <div v-for="fact in statusFacts" :key="fact.label" class="status-fact">
            <span>{{ fact.label }}</span>
            <strong>{{ fact.value }}</strong>
          </div>
        </div>

        <div class="action-row">
          <button
            class="primary-btn"
            type="button"
            :disabled="!connectionReady || workbenchPending()"
            :aria-busy="props.consoleApp.isPending('oauth-start') ? 'true' : 'false'"
            @click="props.consoleApp.startCodexOAuth"
          >
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('oauth-start') }">{{ pendingText('oauth-start', '生成登录链接', '生成中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="!oauth.authUrl" @click="openAuthUrl">
            打开登录链接
          </button>
          <button class="secondary-btn" type="button" :disabled="!oauth.authUrl" @click="copyAuthUrl">
            复制登录链接
          </button>
          <button class="secondary-btn" type="button" :disabled="workbenchPending() || (oauth.status === 'idle' && !oauth.authUrl)" @click="props.consoleApp.resetOAuthWorkspace">
            重置流程
          </button>
          <button v-if="oauth.status === 'success'" class="secondary-btn" type="button" @click="openFilePool">
            前往文件池
          </button>
        </div>

        <p v-if="!connectionReady" class="inline-note tone-danger">请先在“基础设置”里填写管理地址和 Management Key，再开始原生 OAuth 登录。</p>
        <p v-else class="inline-note" :class="'tone-' + statusMeta.tone">{{ oauth.message }}</p>
      </article>

      <article class="surface-card oauth-card wide-card">
        <div class="card-head">
          <div class="card-copy">
            <h4>登录链接</h4>
            <p class="meta-copy">这里展示 cliproxyapi 管理接口返回的原始 OAuth 登录地址。你可以直接打开，或复制到别的浏览器环境中使用。</p>
          </div>
          <span class="pill" :class="oauth.authUrl ? 'tone-success' : 'tone-neutral'">
            <span>链接状态</span>
            <strong>{{ oauth.authUrl ? "已生成" : "待生成" }}</strong>
          </span>
        </div>

        <div class="code-box" :class="{ empty: !oauth.authUrl }">
          <pre>{{ oauth.authUrl || "点击“生成登录链接”后，这里会显示完整 OAuth 地址。" }}</pre>
        </div>

        <div class="mini-grid">
          <div class="mini-card">
            <span>OAuth State</span>
            <strong>{{ oauth.authState || "未返回" }}</strong>
          </div>
          <div class="mini-card">
            <span>状态轮询</span>
            <strong>{{ oauth.polling ? "每 3 秒检查一次" : "未轮询" }}</strong>
          </div>
        </div>
      </article>

      <article class="surface-card oauth-card wide-card">
        <div class="card-head">
          <div class="card-copy">
            <h4>手动提交回调地址</h4>
            <p class="meta-copy">如果浏览器完成登录后，cliproxyapi 没有自动收到回调，可以把最终跳转到的完整地址粘贴到这里，再交给管理接口处理。</p>
          </div>
          <span class="pill" :class="'tone-' + callbackMeta.tone">
            <span>提交状态</span>
            <strong>{{ callbackMeta.label }}</strong>
          </span>
        </div>

        <label class="field">
          <span>浏览器最终跳转地址</span>
          <textarea
            v-model.trim="props.consoleApp.oauthLogin.callbackUrl"
            class="text-area"
            placeholder="例如把浏览器完成登录后最终跳转到的完整地址粘贴到这里"
          ></textarea>
        </label>

        <div class="action-row">
          <button
            class="primary-btn"
            type="button"
            :disabled="!connectionReady || workbenchPending() || !oauth.callbackUrl"
            :aria-busy="props.consoleApp.isPending('oauth-submit-callback') ? 'true' : 'false'"
            @click="props.consoleApp.submitCodexOAuthCallback"
          >
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('oauth-submit-callback') }">{{ pendingText('oauth-submit-callback', '提交回调地址', '提交中') }}</span>
          </button>
        </div>

        <p class="inline-note" :class="'tone-' + callbackMeta.tone">{{ oauth.callbackMessage || "如果当前网络或部署拓扑让服务端收不到浏览器回调，可以走这里的手动补提交流程。" }}</p>
      </article>

      <article class="surface-card oauth-card">
        <div class="card-head">
          <h4>操作步骤</h4>
        </div>

        <div class="hint-list">
          <p>1. 点击“生成登录链接”，等待管理接口返回 `Codex` 的 OAuth 登录地址。</p>
          <p>2. 点击“打开登录链接”，在浏览器里完成授权。</p>
          <p>3. 页面会自动轮询登录状态；如果服务端没收到回调，就把最终跳转地址粘贴到上面的输入框里提交。</p>
          <p>4. 成功后本页会先刷新文件列表，再只对本次识别到的目标文件补拉凭证详情，不会全量扫描整个文件池。</p>
        </div>
      </article>

      <article class="surface-card oauth-card">
        <div class="card-head">
          <h4>兼容提示</h4>
        </div>

        <div class="hint-list">
          <p>如果提示接口不存在、404 或“不支持原生 OAuth 管理接口”，通常不是你操作错了，而是当前 cliproxyapi 版本还没带这组能力。</p>
          <p>本页走的是官方管理中心同款的原生流程：生成登录链接、轮询状态、必要时补交回调地址，并不是在当前页面里直接嵌一个外站。</p>
          <p>登录成功只代表服务端已完成凭证写入；真正入池还是以自动刷新的文件列表结果为准，凭证详情也只会按目标文件做定向同步。</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.view-shell {
  min-height: 0;
  display: grid;
  gap: 12px;
  grid-template-rows: auto minmax(0, 1fr);
}

.hero-panel,
.oauth-card {
  padding: 18px;
}

.hero-panel {
  display: grid;
  gap: 8px;
}

.hero-panel h3,
.card-head h4 {
  margin: 8px 0 0;
  font-family: var(--font-display);
  color: var(--ink-strong);
  letter-spacing: -0.04em;
}

.hero-panel h3 {
  font-size: 24px;
}

.hero-panel p,
.meta-copy,
.hint-list p,
.inline-note {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
}

.content-grid {
  min-height: 0;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  overflow: auto;
  padding-right: 4px;
  padding-bottom: 6px;
}

.oauth-card {
  display: grid;
  gap: 14px;
}

.wide-card {
  grid-column: 1 / -1;
}

.card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.card-copy {
  display: grid;
  gap: 6px;
}

.status-grid,
.mini-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.status-fact,
.mini-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(24, 34, 52, 0.06);
  background: rgba(255, 255, 255, 0.78);
}

.status-fact span,
.mini-card span,
.field span {
  color: var(--text-muted);
  font-size: 12px;
}

.status-fact strong,
.mini-card strong {
  color: var(--text-strong);
  font-size: 14px;
  line-height: 1.5;
  word-break: break-all;
}

.field {
  display: grid;
  gap: 8px;
}

.code-box,
.text-area {
  width: 100%;
  border-radius: 18px;
  border: 1px solid rgba(24, 34, 52, 0.1);
  background: rgba(12, 18, 28, 0.96);
  color: #f4f8ff;
}

.code-box {
  min-height: 120px;
  padding: 16px;
}

.code-box.empty {
  background: rgba(12, 18, 28, 0.88);
}

.code-box pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: "JetBrains Mono", "Consolas", monospace;
  font-size: 12px;
  line-height: 1.7;
}

.text-area {
  min-height: 120px;
  padding: 14px 16px;
  resize: vertical;
  font: inherit;
}

.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.hint-list {
  display: grid;
  gap: 10px;
}

.inline-note.tone-danger {
  color: #dc2626;
}

.inline-note.tone-success {
  color: #15803d;
}

.inline-note.tone-info {
  color: #1d4ed8;
}

@media (max-width: 1180px) {
  .content-grid,
  .status-grid,
  .mini-grid {
    grid-template-columns: 1fr;
  }
}
</style>
