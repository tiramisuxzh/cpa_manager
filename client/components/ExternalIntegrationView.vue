<script setup>
import { computed } from "vue";

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
var integrationConfigured = computed(function () {
  return !!integrationUrl.value;
});
var integrationUrlValid = computed(function () {
  if (!integrationUrl.value) {
    return false;
  }
  return /^https?:\/\/.+/i.test(integrationUrl.value);
});
var frameSrc = computed(function () {
  return integrationUrlValid.value ? integrationUrl.value : "";
});

function openIntegrationSettings() {
  emit("open-route", "integration-settings");
}
</script>

<template>
  <section class="view-shell" :class="{ empty: !integrationUrlValid }">
    <article v-if="!integrationConfigured" class="surface-card empty-panel">
      <h4>未配置访问地址</h4>
      <div class="action-row">
        <button class="primary-btn" type="button" @click="openIntegrationSettings">前往集成配置</button>
      </div>
    </article>

    <article v-else-if="!integrationUrlValid" class="surface-card empty-panel">
      <h4>访问地址格式无效</h4>
      <div class="action-row">
        <button class="primary-btn" type="button" @click="openIntegrationSettings">前往集成配置</button>
      </div>
    </article>

    <iframe
      v-else
      :key="frameSrc"
      class="integration-frame"
      :src="frameSrc"
      title="wenfxl-openai 外部集成页面"
    ></iframe>
  </section>
</template>

<style scoped>
.view-shell {
  min-height: 0;
  height: 100%;
  display: flex;
}

.empty-panel h4,
.empty-panel {
  margin: 0;
}

.empty-panel h4 {
  font-family: var(--font-display);
  color: var(--ink-strong);
  letter-spacing: -0.04em;
  font-size: 24px;
}

.empty-panel {
  width: min(520px, 100%);
  margin: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
}

.integration-frame {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  border: 0;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: var(--shadow-soft);
}

.action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
