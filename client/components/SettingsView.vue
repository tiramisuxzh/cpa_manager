<script setup>
import { computed } from "vue";
import { AUTO_REFRESH_MODE_OPTIONS, TOKEN_REFRESH_SCOPE_OPTIONS } from "../lib/constants.js";
import { PENDING_GROUPS } from "../lib/constants.js";

var props = defineProps({
  consoleApp: {
    type: Object,
    required: true
  }
});

var connectionReady = computed(function () {
  return !!String(props.consoleApp.settings.baseUrl || "").trim() && !!String(props.consoleApp.settings.key || "").trim();
});
var syncTargetReady = computed(function () {
  return !!String(props.consoleApp.settings.syncTargetBaseUrl || "").trim() && !!String(props.consoleApp.settings.syncTargetKey || "").trim();
});
var autoRefreshModes = AUTO_REFRESH_MODE_OPTIONS;
var tokenRefreshScopes = TOKEN_REFRESH_SCOPE_OPTIONS;
var autoRefreshModeHelpText = computed(function () {
  return [
    "自动刷新模式说明：",
    "只文件：只拉文件列表，不同步凭证，不刷新额度。",
    "文件 + 额度（含凭证）：拉文件列表，同时同步凭证信息，再刷新额度。",
    "文件 + 凭证：拉文件列表，同时同步凭证信息，不刷新额度。",
    "凭证 + 额度：不重拉文件列表，只针对当前已加载文件同步凭证并刷新额度。",
    "只凭证：只同步凭证信息。"
  ].join("\n");
});
var tokenRefreshScopeHelpText = computed(function () {
  var scope = String(props.consoleApp.settings.tokenRefreshScope || "all");

  if (scope === "expired-or-missing") {
    return "只处理 expired 已经过期，或原始 JSON 里还没写入 expired 的文件。";
  }
  if (scope === "within-1-day") {
    return "只处理 access_token 在 1 天内到期的文件；已经过期的文件也会一起命中。";
  }
  if (scope === "within-3-days") {
    return "只处理 access_token 在 3 天内到期的文件；已经过期的文件也会一起命中。";
  }
  if (scope === "within-7-days") {
    return "只处理 access_token 在 7 天内到期的文件；已经过期的文件也会一起命中。";
  }
  if (scope === "within-30-days") {
    return "只处理 access_token 在 30 天内到期的文件；已经过期的文件也会一起命中。";
  }
  return "不按过期时间筛选，直接对当前已加载文件全部执行认证续期。";
});

function pendingText(type, idleText, loadingText, key) {
  return props.consoleApp.isPending(type, key) ? loadingText : idleText;
}
</script>

<template>
  <section class="view-shell">
    <article class="surface-card hero-panel">
      <div>
        <span class="eyebrow">Settings</span>
        <h3>基础设置</h3>
      </div>
      <p>这里只保留真正会影响连接、显示和额度判定的配置，不再塞无关的服务扩展开关。</p>
    </article>

    <div class="settings-grid">
      <article class="surface-card settings-card wide-card">
        <div class="card-head">
          <h4>连接信息</h4>
          <span class="pill" :class="connectionReady ? 'tone-success' : 'tone-neutral'">
            <span>当前状态</span>
            <strong>{{ connectionReady ? "已配置" : "待填写" }}</strong>
          </span>
        </div>

        <div class="field-grid">
          <label class="field full-span">
            <span>管理地址</span>
            <input v-model.trim="props.consoleApp.settings.baseUrl" class="text-input" placeholder="http://127.0.0.1:8317">
          </label>

          <label class="field full-span">
            <span>Management Key</span>
            <input v-model.trim="props.consoleApp.settings.key" class="text-input" type="password" placeholder="输入管理密钥">
          </label>

          <label class="field full-span">
            <span>复活代理地址（可选）</span>
            <input v-model.trim="props.consoleApp.settings.reviveProxyUrl" class="text-input" placeholder="http://127.0.0.1:7890">
          </label>
        </div>

        <div class="action-row">
          <button class="primary-btn" type="button" :disabled="!connectionReady || props.consoleApp.hasPending(PENDING_GROUPS.workbench)" :aria-busy="props.consoleApp.isPending('refresh-files') ? 'true' : 'false'" @click="props.consoleApp.loadFiles({ pendingType: 'refresh-files', includeCredentialInfo: true })">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-files') }">{{ pendingText('refresh-files', '立即连接并加载文件与凭证', '连接中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="props.consoleApp.hasPending(PENDING_GROUPS.service)" :aria-busy="props.consoleApp.isPending('save-default-settings') ? 'true' : 'false'" @click="props.consoleApp.saveDefaultSettings">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('save-default-settings') }">{{ pendingText('save-default-settings', '保存默认配置', '保存中') }}</span>
          </button>
        </div>
        <p class="meta-copy">“保存默认配置”会把当前 management 设置写回 `config/app-config.json`，供下次启动作为默认值使用；浏览器本地缓存仍然会继续保留。若本地开了 Clash，可把 HTTP 代理端口填到“复活代理地址”，例如 `http://127.0.0.1:7890`。</p>
      </article>

      <article class="surface-card settings-card">
        <div class="card-head">
          <h4>文件同步目标</h4>
          <span class="pill" :class="syncTargetReady ? 'tone-success' : 'tone-neutral'">
            <span>当前状态</span>
            <strong>{{ syncTargetReady ? "已配置" : "待填写" }}</strong>
          </span>
        </div>

        <div class="field-grid">
          <label class="field full-span">
            <span>目标管理地址</span>
            <input v-model.trim="props.consoleApp.settings.syncTargetBaseUrl" class="text-input" placeholder="http://127.0.0.1:8318">
          </label>
          <label class="field full-span">
            <span>目标 Management Key</span>
            <input v-model.trim="props.consoleApp.settings.syncTargetKey" class="text-input" type="password" placeholder="输入目标端管理密钥">
          </label>
        </div>

        <div class="switch-grid">
          <label class="switch-row">
            <input v-model="props.consoleApp.settings.syncSkipExisting" type="checkbox">
            <span>目标端同名文件自动跳过</span>
          </label>
        </div>

        <div class="action-row">
          <button class="secondary-btn" type="button" :disabled="!connectionReady || !syncTargetReady || props.consoleApp.hasPending(PENDING_GROUPS.workbench)" :aria-busy="props.consoleApp.isPending('sync-all-files') ? 'true' : 'false'" @click="props.consoleApp.syncAllFilesToTarget">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('sync-all-files') }">{{ pendingText('sync-all-files', '立即同步全部文件', '同步中') }}</span>
          </button>
        </div>

        <p class="meta-copy">这里用于把当前源端 cliproxyapi 下的 Codex 文件直连同步到另一台 cliproxyapi。为了降低误覆盖风险，默认会跳过目标端已存在的同名文件；如果你确认要继续尝试上传同名文件，可以取消上面的勾选。</p>
      </article>

      <article class="surface-card settings-card">
        <div class="card-head">
          <h4>本地行为</h4>
          <span class="meta-copy">只影响当前管理台的显示方式和自动刷新策略，不再提供进入页面自动加载。</span>
        </div>

        <div class="field-grid">
          <label class="field">
            <span>文件列表自动刷新间隔（分钟）</span>
            <input v-model.number="props.consoleApp.settings.interval" class="text-input" type="number" min="1" max="1440">
          </label>
          <label class="field">
            <span class="label-row">
              <span>自动刷新模式</span>
              <span class="help-dot" :title="autoRefreshModeHelpText" aria-label="查看自动刷新模式说明" tabindex="0">?</span>
            </span>
            <select v-model="props.consoleApp.settings.autoRefreshMode" class="select-input">
              <option v-for="option in autoRefreshModes" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="switch-grid">
          <label class="switch-row">
            <input v-model="props.consoleApp.settings.autoRefresh" type="checkbox">
            <span>定时刷新</span>
          </label>
          <label class="switch-row">
            <input v-model="props.consoleApp.settings.showFilename" type="checkbox">
            <span>文件名优先显示</span>
          </label>
        </div>

        <div class="action-row">
          <button class="secondary-btn" type="button" :disabled="!connectionReady || props.consoleApp.hasPending(PENDING_GROUPS.workbench)" :aria-busy="props.consoleApp.isPending('run-auto-refresh-now') ? 'true' : 'false'" @click="props.consoleApp.runCurrentAutoRefreshMode">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('run-auto-refresh-now') }">{{ pendingText('run-auto-refresh-now', '立即按当前模式执行一次', '执行中') }}</span>
          </button>
        </div>

        <p class="meta-copy">自动刷新关闭时会保留当前模式配置。开启后可按需选择只刷新文件、补拉凭证信息，或执行带凭证同步的文件加额度刷新；“凭证 + 额度”仍适合不重拉文件列表的轻量巡检。</p>
      </article>

      <article class="surface-card settings-card">
        <div class="card-head">
          <h4>额度策略</h4>
          <span class="meta-copy">这里的数值会直接影响低额度预警判定，以及全池 / 选中额度刷新时的请求节奏。</span>
        </div>

        <div class="field-grid">
          <label class="field">
            <span>低额度预警阈值（%）</span>
            <input v-model.number="props.consoleApp.settings.lowQuotaThreshold" class="text-input" type="number" min="0" max="100">
          </label>
          <label class="field">
            <span>额度拉取并发数</span>
            <input v-model.number="props.consoleApp.settings.quotaConcurrency" class="text-input" type="number" min="1" max="20">
          </label>
          <label class="field">
            <span>并发间隔（秒）</span>
            <input v-model.number="props.consoleApp.settings.quotaRequestIntervalSeconds" class="text-input" type="number" min="0" max="30" step="0.5">
          </label>
        </div>

        <p class="meta-copy">低额度预警会在会话额度或代码额度低于等于阈值时生效。并发间隔表示每个并发槽完成一次请求后，等待多久再发下一个额度请求。</p>
      </article>

      <article class="surface-card settings-card">
        <div class="card-head">
          <h4>凭证相关</h4>
          <span class="meta-copy">这里控制凭证相关任务的并发和节奏，包括“批量认证续期”与“同步选中凭证信息”，不影响额度拉取。</span>
        </div>

        <div class="field-grid">
          <label class="field">
            <span>凭证刷新并发数</span>
            <input v-model.number="props.consoleApp.settings.tokenRefreshConcurrency" class="text-input" type="number" min="1" max="10">
          </label>
          <label class="field">
            <span>凭证刷新间隔（秒）</span>
            <input v-model.number="props.consoleApp.settings.tokenRefreshIntervalSeconds" class="text-input" type="number" min="0" max="30" step="0.5">
          </label>
          <label class="field full-span">
            <span>立即续期范围</span>
            <select v-model="props.consoleApp.settings.tokenRefreshScope" class="select-input">
              <option v-for="option in tokenRefreshScopes" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="action-row">
          <button class="secondary-btn" type="button" :disabled="!connectionReady || props.consoleApp.hasPending(PENDING_GROUPS.workbench)" :aria-busy="props.consoleApp.isPending('refresh-all-credentials') ? 'true' : 'false'" @click="props.consoleApp.refreshAllCredentials">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-all-credentials') }">{{ pendingText('refresh-all-credentials', '立即续期全部文件', '续期中') }}</span>
          </button>
        </div>

        <p class="meta-copy">并发数表示最多同时处理多少个文件；间隔表示每个并发槽完成一次凭证相关请求后，等待多久再启动下一个文件，适合在批量保活或同步凭证信息时减轻上游压力。“立即续期全部文件”只针对当前管理台里已经加载出来的文件执行，不会额外自动拉取新的文件列表。</p>
        <p class="meta-copy">{{ tokenRefreshScopeHelpText }}</p>
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
.settings-card {
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
.meta-copy {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
}

.settings-grid {
  min-height: 0;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  overflow: auto;
  padding-right: 4px;
  padding-bottom: 6px;
}

.settings-card {
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

.field-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field {
  display: grid;
  gap: 8px;
}

.field span {
  color: var(--text-muted);
  font-size: 12px;
}

.label-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.help-dot {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(24, 34, 52, 0.12);
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-soft);
  font-size: 11px;
  line-height: 1;
  cursor: help;
  user-select: none;
}

.full-span {
  grid-column: 1 / -1;
}

.switch-grid,
.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

@media (max-width: 1080px) {
  .settings-grid,
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
