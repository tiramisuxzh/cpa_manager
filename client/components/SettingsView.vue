<script setup>
import { computed } from "vue";
import { AUTO_REFRESH_MODE_OPTIONS } from "../lib/constants.js";
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
var autoRefreshModes = AUTO_REFRESH_MODE_OPTIONS;

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
        </div>

        <div class="action-row">
          <button class="primary-btn" type="button" :disabled="!connectionReady || props.consoleApp.hasPending(PENDING_GROUPS.workbench)" :aria-busy="props.consoleApp.isPending('refresh-files') ? 'true' : 'false'" @click="props.consoleApp.loadFiles({ pendingType: 'refresh-files' })">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('refresh-files') }">{{ pendingText('refresh-files', '立即连接并加载文件', '连接中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="props.consoleApp.hasPending(PENDING_GROUPS.service)" :aria-busy="props.consoleApp.isPending('save-default-settings') ? 'true' : 'false'" @click="props.consoleApp.saveDefaultSettings">
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('save-default-settings') }">{{ pendingText('save-default-settings', '保存默认配置', '保存中') }}</span>
          </button>
        </div>
        <p class="meta-copy">“保存默认配置”会把当前 management 设置写回 `config/app-config.json`，供下次启动作为默认值使用；浏览器本地缓存仍然会继续保留。</p>
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
            <span>自动刷新模式</span>
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

        <p class="meta-copy">自动刷新关闭时会保留当前模式配置。开启后可按需选择只刷新文件列表，或同时补拉文件和额度。</p>
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
