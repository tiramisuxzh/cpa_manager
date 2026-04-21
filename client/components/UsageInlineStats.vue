<script setup>
var props = defineProps({
  success: {
    type: Number,
    default: null
  },
  failure: {
    type: Number,
    default: null
  }
});

function display(value) {
  return value == null ? "-" : value.toLocaleString("zh-CN");
}
</script>

<template>
  <div class="usage-inline">
    <span class="usage-pill success">
      <small>成功</small>
      <strong>{{ display(props.success) }}</strong>
    </span>
    <span class="usage-pill failure">
      <small>失败</small>
      <strong>{{ display(props.failure) }}</strong>
    </span>
  </div>
</template>

<style scoped>
.usage-inline {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.usage-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11px;
  line-height: 1;
}

.usage-pill small {
  font-size: 11px;
}

.usage-pill strong {
  font-size: 11px;
  line-height: 1;
}

.usage-pill.success {
  border-color: rgba(34, 197, 94, 0.2);
  background: rgba(34, 197, 94, 0.1);
  color: var(--success);
}

.usage-pill.failure {
  border-color: rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.08);
  color: var(--danger);
}
</style>
