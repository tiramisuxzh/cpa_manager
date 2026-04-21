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

var integrationUrl = computed(function () {
  return String(props.consoleApp.integrationSettings.wenfxlOpenaiUrl || "").trim();
});
var integrationReady = computed(function () {
  return !!integrationUrl.value;
});
var integrationUrlValid = computed(function () {
  if (!integrationUrl.value) {
    return true;
  }
  return /^https?:\/\/.+/i.test(integrationUrl.value);
});

function pendingText(type, idleText, loadingText, key) {
  return props.consoleApp.isPending(type, key) ? loadingText : idleText;
}

function openIntegrationPage() {
  emit("open-route", "wenfxl-openai");
}
</script>

<template>
  <section class="view-shell">
    <article class="surface-card hero-panel">
      <div>
        <span class="eyebrow">Integration</span>
        <h3>集成配置</h3>
      </div>
      <p>这里专门维护外部集成页面的访问地址。保存后，左侧“外部集成 / wenfxl-openai”会直接把这个地址嵌入到当前工作台。</p>
    </article>

    <div class="settings-grid">
      <article class="surface-card settings-card wide-card">
        <div class="card-head">
          <h4>wenfxl-openai 访问地址</h4>
          <span class="pill" :class="integrationUrlValid ? (integrationReady ? 'tone-success' : 'tone-neutral') : 'tone-danger'">
            <span>当前状态</span>
            <strong>{{ !integrationUrlValid ? "地址无效" : (integrationReady ? "已配置" : "待填写") }}</strong>
          </span>
        </div>

        <div class="field-grid single-column">
          <label class="field">
            <span>访问地址</span>
            <input
              v-model.trim="props.consoleApp.integrationSettings.wenfxlOpenaiUrl"
              class="text-input"
              placeholder="http://127.0.0.1:3000/wenfxl-openai"
            >
          </label>
        </div>

        <div class="action-row">
          <button
            class="primary-btn"
            type="button"
            :disabled="!integrationUrlValid || props.consoleApp.hasPending(PENDING_GROUPS.service)"
            :aria-busy="props.consoleApp.isPending('save-integration-settings') ? 'true' : 'false'"
            @click="props.consoleApp.saveIntegrationSettings"
          >
            <span class="button-label" :class="{ pending: props.consoleApp.isPending('save-integration-settings') }">{{ pendingText('save-integration-settings', '保存集成配置', '保存中') }}</span>
          </button>
          <button class="secondary-btn" type="button" :disabled="!integrationReady || !integrationUrlValid" @click="openIntegrationPage">
            前往 wenfxl-openai
          </button>
        </div>

        <p class="meta-copy">
          地址建议填写完整的 `http://` 或 `https://` 链接。当前页面的输入会先保存在浏览器本地缓存，点击“保存集成配置”后会同步写回
          `config/app-config.json`。
        </p>
      </article>

      <article class="surface-card settings-card">
        <div class="card-head">
          <h4>嵌入说明</h4>
          <span class="meta-copy">帮助你判断为什么地址填了但页面没有显示。</span>
        </div>

        <div class="hint-list">
          <p>如果外部系统设置了 `X-Frame-Options` 或 CSP 的 `frame-ancestors` 限制，浏览器会拒绝被 iframe 嵌入。</p>
          <p>这种情况下地址本身仍然是可访问的，但需要让目标系统放开嵌入策略，或者改成新窗口打开的使用方式。</p>
          <p>为了减少歧义，建议这里填写最终访问页地址，而不是登录页前的一层跳转地址。</p>
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
.meta-copy,
.hint-list p {
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

.single-column {
  grid-template-columns: 1fr;
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

@media (max-width: 1080px) {
  .settings-grid,
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
