<script setup>
import { computed, ref, watch } from "vue";
var RESULT_PAGE_SIZE = 5;

var props = defineProps({
  dialog: {
    type: Object,
    required: true
  }
});

var emit = defineEmits(["close"]);
var resultExpanded = ref(false);
var resultPage = ref(1);
var dialog = computed(function () {
  return props.dialog || {};
});

function progressPercent(dialog) {
  var percent = Number(dialog.percent);
  return Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
}

function progressText(dialog) {
  var currentIndex = Math.max(0, Number(dialog.currentIndex) || 0);
  var total = Math.max(0, Number(dialog.total) || 0);
  return currentIndex + " / " + total;
}

function activeNames(dialog) {
  return Array.isArray(dialog.activeNames) ? dialog.activeNames.filter(Boolean) : [];
}

function failureDetails(dialog) {
  return Array.isArray(dialog.failureDetails) ? dialog.failureDetails.filter(function (item) {
    return item && (item.name || item.message);
  }) : [];
}

function resultDetails(dialog) {
  return Array.isArray(dialog.resultDetails) ? dialog.resultDetails.filter(function (item) {
    return item && (item.name || item.message);
  }) : [];
}

function totalResultPages(dialog) {
  return Math.max(1, Math.ceil(resultDetails(dialog).length / RESULT_PAGE_SIZE));
}

function pagedResultDetails(dialog) {
  var totalPages = totalResultPages(dialog);
  var currentPage = Math.max(1, Math.min(resultPage.value, totalPages));
  var start = (currentPage - 1) * RESULT_PAGE_SIZE;
  return resultDetails(dialog).slice(start, start + RESULT_PAGE_SIZE);
}

function resultStatusText(item) {
  return item && item.status === "success" ? "成功" : "失败";
}

function resultStatusClass(item) {
  return item && item.status === "success" ? "tone-success" : "tone-danger";
}

function compareFields(item) {
  return Array.isArray(item && item.compareFields) ? item.compareFields : [];
}

function resultToggleText(dialog) {
  var total = resultDetails(dialog).length;
  if (resultExpanded.value) {
    return "收起结果明细";
  }
  return (dialog && dialog.completed ? "查看结果明细" : "查看已完成明细") + "（" + total + "）";
}

function pageChange(step, dialog) {
  resultPage.value = Math.max(1, Math.min(resultPage.value + step, totalResultPages(dialog)));
}

watch(function () {
  return [
    !!dialog.value.visible,
    dialog.value.title || "",
    resultDetails(dialog.value).length,
    dialog.value.completed ? "done" : "running"
  ].join("::");
}, function () {
  resultExpanded.value = false;
  resultPage.value = 1;
});
</script>

<template>
  <Teleport to="body">
    <transition name="progress-fade">
      <div v-if="dialog.visible" class="progress-mask">
        <div class="progress-panel">
          <span class="progress-kicker">{{ dialog.completed ? "Task Summary" : "Running Task" }}</span>
          <div class="progress-head">
            <div class="progress-copy">
              <h3>{{ dialog.title || "批量处理中" }}</h3>
              <p>{{ dialog.stage || "正在执行操作…" }}</p>
            </div>
            <button class="close-btn" type="button" :disabled="!dialog.canClose" @click="emit('close')">{{ dialog.canClose ? "关闭" : "处理中" }}</button>
          </div>

          <section class="stats-grid">
            <article class="stat-card">
              <small>当前进度</small>
              <strong>{{ progressText(dialog) }}</strong>
              <span>{{ dialog.total ? "共 " + dialog.total + " 个文件" : "等待任务开始" }}</span>
            </article>
            <article class="stat-card">
              <small>已成功</small>
              <strong>{{ dialog.successCount || 0 }}</strong>
              <span>{{ dialog.successLabel || "本轮已处理成功" }}</span>
            </article>
            <article class="stat-card">
              <small>已失败</small>
              <strong>{{ dialog.failureCount || 0 }}</strong>
              <span>{{ dialog.failureLabel || "本轮处理失败或未通过" }}</span>
            </article>
          </section>

          <section class="detail-card">
            <div class="detail-head">
              <strong>{{ activeNames(dialog).length > 1 ? "当前活跃文件" : "当前操作文件" }}</strong>
              <span>{{ dialog.currentName || "等待开始" }}</span>
            </div>

            <div v-if="dialog.concurrency || dialog.intervalSeconds != null" class="detail-meta">
              <span v-if="dialog.concurrency">并发 {{ dialog.concurrency }}</span>
              <span v-if="dialog.intervalSeconds != null">间隔 {{ dialog.intervalSeconds }} 秒</span>
            </div>

            <ul v-if="activeNames(dialog).length" class="active-list">
              <li v-for="name in activeNames(dialog)" :key="name">{{ name }}</li>
            </ul>

            <div class="track-shell">
              <div class="track-bar">
                <span class="track-value" :style="{ width: progressPercent(dialog) + '%' }"></span>
              </div>
              <small>{{ progressPercent(dialog) }}%</small>
            </div>

            <p class="detail-message">{{ dialog.latestMessage || "批量任务执行中，过程会同步写入底部动态日志。" }}</p>

            <div v-if="resultDetails(dialog).length" class="detail-actions">
              <button class="detail-toggle" type="button" @click="resultExpanded = !resultExpanded">
                {{ resultToggleText(dialog) }}
              </button>
            </div>

            <section v-if="resultExpanded && resultDetails(dialog).length" class="result-card">
              <div class="result-card-head">
                <strong>结果明细</strong>
                <span>第 {{ resultPage }} / {{ totalResultPages(dialog) }} 页</span>
              </div>

              <ul class="result-list">
                <li v-for="item in pagedResultDetails(dialog)" :key="item.key || (item.name + item.message)" class="result-item">
                  <div class="result-item-head">
                    <div class="result-item-title">
                      <span class="result-pill" :class="resultStatusClass(item)">{{ resultStatusText(item) }}</span>
                      <strong>{{ item.name || "未命名文件" }}</strong>
                    </div>
                    <span class="result-message">{{ item.message || "未返回执行信息" }}</span>
                  </div>

                  <div v-if="compareFields(item).length" class="compare-list">
                    <article v-for="field in compareFields(item)" :key="field.key || field.label" class="compare-item">
                      <div class="compare-head">
                        <strong>{{ field.label }}</strong>
                        <span class="compare-pill" :class="field.changed ? 'tone-info' : 'tone-neutral'">{{ field.changed ? "已变化" : "未变化" }}</span>
                      </div>
                      <div class="compare-grid">
                        <div class="compare-block">
                          <small>旧值</small>
                          <pre>{{ field.before || "空" }}</pre>
                        </div>
                        <div class="compare-block">
                          <small>新值</small>
                          <pre>{{ field.after || "空" }}</pre>
                        </div>
                      </div>
                    </article>
                  </div>

                  <details v-if="item.beforeText || item.afterText" class="json-toggle">
                    <summary>查看完整旧 / 新内容</summary>
                    <div class="json-grid">
                      <div class="compare-block">
                        <small>旧内容</small>
                        <pre>{{ item.beforeText || "无" }}</pre>
                      </div>
                      <div class="compare-block">
                        <small>新内容</small>
                        <pre>{{ item.afterText || "无" }}</pre>
                      </div>
                    </div>
                  </details>
                </li>
              </ul>

              <div v-if="totalResultPages(dialog) > 1" class="pager-row">
                <button class="pager-btn" type="button" :disabled="resultPage <= 1" @click="pageChange(-1, dialog)">上一页</button>
                <span>{{ resultPage }} / {{ totalResultPages(dialog) }}</span>
                <button class="pager-btn" type="button" :disabled="resultPage >= totalResultPages(dialog)" @click="pageChange(1, dialog)">下一页</button>
              </div>
            </section>
          </section>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.progress-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(8px);
}

.progress-panel {
  width: min(980px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 22px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(241, 245, 249, 0.98));
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-large);
}

.progress-kicker {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(20, 33, 61, 0.08);
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.progress-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.progress-copy {
  display: grid;
  gap: 6px;
}

.progress-copy h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
  line-height: 1.08;
  letter-spacing: -0.05em;
  color: var(--ink-strong);
}

.progress-copy p,
.stat-card span,
.detail-message,
.detail-head span,
.track-shell small {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
}

.close-btn {
  border: 0;
  cursor: pointer;
  padding: 10px 14px;
  border-radius: 16px;
  background: rgba(20, 33, 61, 0.08);
  color: var(--text-strong);
}

.close-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.stats-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stat-card,
.detail-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(24, 34, 52, 0.06);
}

.stat-card small {
  color: var(--text-muted);
  font-size: 12px;
}

.stat-card strong,
.detail-head strong {
  color: var(--text-strong);
  font-size: 22px;
  line-height: 1.2;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.detail-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.active-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
  max-height: 100px;
  overflow: auto;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.6;
}

.track-shell {
  display: grid;
  gap: 6px;
}

.detail-actions {
  display: flex;
  justify-content: flex-start;
}

.detail-toggle {
  border: 0;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 14px;
  background: rgba(255, 241, 241, 0.96);
  color: var(--danger);
  font-size: 12px;
}

.result-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(245, 248, 252, 0.9);
  border: 1px solid rgba(24, 34, 52, 0.08);
}

.result-card-head,
.result-item-head,
.result-item-title,
.compare-head,
.pager-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.result-card strong,
.result-item-title strong,
.compare-head strong {
  color: var(--text-strong);
  font-size: 13px;
  line-height: 1.5;
}

.result-card-head span,
.result-message,
.pager-row span {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.6;
}

.result-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}

.result-item,
.compare-item {
  display: grid;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(24, 34, 52, 0.06);
}

.result-pill,
.compare-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  font-size: 11px;
  line-height: 1;
}

.compare-list,
.json-grid {
  display: grid;
  gap: 8px;
}

.compare-grid,
.json-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.compare-block {
  display: grid;
  gap: 6px;
}

.compare-block small {
  color: var(--text-muted);
  font-size: 12px;
}

.compare-block pre {
  margin: 0;
  padding: 10px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-strong);
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.json-toggle {
  display: grid;
  gap: 8px;
}

.json-toggle summary {
  cursor: pointer;
  color: var(--accent-strong);
  font-size: 12px;
}

.pager-btn {
  border: 0;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 14px;
  background: rgba(20, 33, 61, 0.08);
  color: var(--text-strong);
  font-size: 12px;
}

.pager-btn:disabled {
  cursor: default;
  opacity: 0.56;
}

.track-bar {
  width: 100%;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.2);
}

.track-value {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(135deg, #0f766e, #14b8a6);
  transition: width 0.2s ease;
}

.progress-fade-enter-active,
.progress-fade-leave-active {
  transition: opacity 0.2s ease;
}

.progress-fade-enter-active .progress-panel,
.progress-fade-leave-active .progress-panel {
  transition: transform 0.22s ease;
}

.progress-fade-enter-from,
.progress-fade-leave-to {
  opacity: 0;
}

.progress-fade-enter-from .progress-panel,
.progress-fade-leave-to .progress-panel {
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 720px) {
  .progress-panel {
    padding: 18px;
  }

  .progress-copy h3 {
    font-size: 24px;
  }

  .progress-head,
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .compare-grid,
  .json-grid {
    grid-template-columns: 1fr;
  }

  .close-btn {
    width: 100%;
  }
}
</style>
