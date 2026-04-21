<script setup>
defineProps({
  dialog: {
    type: Object,
    required: true
  }
});

var emit = defineEmits(["confirm", "cancel"]);

function dialogTitle(dialog) {
  return dialog.title || "确认操作";
}

function dialogItems(dialog) {
  return Array.isArray(dialog.items) ? dialog.items : [];
}

function dialogListTitle(dialog) {
  return dialog.listTitle || "本次处理文件";
}
</script>

<template>
  <Teleport to="body">
    <transition name="confirm-fade">
      <div v-if="dialog.visible" class="confirm-mask" @click.self="emit('cancel')">
        <div class="confirm-panel">
          <span class="confirm-kicker">{{ dialog.tone === 'danger' ? 'Danger Zone' : (dialog.tone === 'warn' ? 'Please Confirm' : 'Confirm') }}</span>
          <h3>{{ dialogTitle(dialog) }}</h3>
          <div class="confirm-body">
            <pre v-if="dialog.message" class="confirm-message">{{ dialog.message }}</pre>

            <section v-if="dialogItems(dialog).length" class="confirm-list-card">
              <div class="confirm-list-head">
                <strong>{{ dialogListTitle(dialog) }}</strong>
                <span>{{ dialogItems(dialog).length }} 项</span>
              </div>

              <ul class="confirm-item-list">
                <li v-for="name in dialogItems(dialog)" :key="name">{{ name }}</li>
              </ul>
            </section>

            <p v-if="dialog.note" class="confirm-note">{{ dialog.note }}</p>
          </div>
          <div class="confirm-actions">
            <button class="confirm-btn ghost" type="button" @click="emit('cancel')">{{ dialog.cancelText || '取消' }}</button>
            <button class="confirm-btn" :class="dialog.tone || 'danger'" type="button" @click="emit('confirm')">{{ dialog.confirmText || '确认' }}</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(8px);
}

.confirm-panel {
  width: min(640px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  padding: 22px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  overflow: hidden;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.98), rgba(252, 248, 241, 0.98));
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-large);
}

.confirm-kicker {
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

.confirm-panel h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
  line-height: 1.08;
  letter-spacing: -0.05em;
  color: var(--ink-strong);
}

.confirm-body {
  min-height: 0;
  display: grid;
  gap: 12px;
  overflow: auto;
  padding-right: 4px;
}

.confirm-message {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--text-soft);
  font-size: 14px;
  line-height: 1.8;
}

.confirm-list-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(24, 34, 52, 0.06);
}

.confirm-list-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.confirm-list-head strong {
  color: var(--text-strong);
  font-size: 14px;
}

.confirm-list-head span,
.confirm-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.confirm-item-list {
  margin: 0;
  padding: 0 0 0 18px;
  display: grid;
  gap: 6px;
  max-height: min(34vh, 320px);
  overflow: auto;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.7;
}

.confirm-item-list li {
  overflow-wrap: anywhere;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.confirm-btn {
  border: 0;
  cursor: pointer;
  padding: 11px 16px;
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
}

.confirm-btn.ghost {
  background: rgba(20, 33, 61, 0.08);
  color: var(--text-strong);
}

.confirm-btn.danger {
  background: linear-gradient(135deg, #dc2626, #f97316);
  color: #fff8f7;
}

.confirm-btn.warn {
  background: linear-gradient(135deg, #d97706, #f59e0b);
  color: #fffaf2;
}

.confirm-btn.success {
  background: linear-gradient(135deg, #0f766e, #14b8a6);
  color: #f8fffd;
}

.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-fade-enter-active .confirm-panel,
.confirm-fade-leave-active .confirm-panel {
  transition: transform 0.22s ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

.confirm-fade-enter-from .confirm-panel,
.confirm-fade-leave-to .confirm-panel {
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 720px) {
  .confirm-panel {
    max-height: calc(100vh - 24px);
    padding: 18px;
  }

  .confirm-panel h3 {
    font-size: 24px;
  }

  .confirm-actions {
    justify-content: stretch;
  }

  .confirm-btn {
    flex: 1 1 auto;
  }
}
</style>
