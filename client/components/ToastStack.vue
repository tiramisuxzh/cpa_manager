<script setup>
defineProps({
  toasts: {
    type: Array,
    default: function () {
      return [];
    }
  }
});

var emit = defineEmits(["dismiss"]);

function toastLabel(tone) {
  if (tone === "success") {
    return "成功";
  }
  if (tone === "danger") {
    return "失败";
  }
  if (tone === "warn") {
    return "注意";
  }
  return "提示";
}
</script>

<template>
  <Teleport to="body">
    <div v-if="toasts.length" class="toast-stack">
      <article
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-card"
        :class="'tone-' + (toast.tone || 'info')"
      >
        <div class="toast-head">
          <span class="toast-badge">{{ toastLabel(toast.tone) }}</span>
          <button class="toast-close" type="button" @click="emit('dismiss', toast.id)">关闭</button>
        </div>
        <p>{{ toast.message }}</p>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 70;
  display: grid;
  gap: 10px;
  width: min(380px, calc(100vw - 24px));
}

.toast-card {
  padding: 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-large);
}

.toast-card.tone-success {
  background: rgba(239, 253, 247, 0.98);
}

.toast-card.tone-danger {
  background: rgba(255, 241, 239, 0.98);
}

.toast-card.tone-warn {
  background: rgba(255, 247, 237, 0.98);
}

.toast-card.tone-info {
  background: rgba(239, 246, 255, 0.98);
}

.toast-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.toast-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
}

.toast-close {
  border: 0;
  padding: 6px 8px;
  border-radius: 12px;
  cursor: pointer;
  background: rgba(20, 33, 61, 0.08);
  color: var(--text-soft);
  font-size: 12px;
}

.toast-card p {
  margin: 10px 0 0;
  color: var(--text-strong);
  font-size: 14px;
  line-height: 1.7;
  max-height: 112px;
  overflow: auto;
  overflow-wrap: anywhere;
  padding-right: 4px;
}

@media (max-width: 720px) {
  .toast-stack {
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
  }
}
</style>
