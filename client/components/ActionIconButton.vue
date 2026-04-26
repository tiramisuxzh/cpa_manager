<script setup>
import { computed } from "vue";

var props = defineProps({
  title: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  pending: {
    type: Boolean,
    default: false
  },
  tone: {
    type: String,
    default: "neutral"
  }
});

var emit = defineEmits(["click"]);

var toneClass = computed(function () {
  if (props.tone === "danger") {
    return "tone-danger";
  }
  if (props.tone === "warn") {
    return "tone-warn";
  }
  if (props.tone === "accent") {
    return "tone-accent";
  }
  return "tone-neutral";
});

function handleClick(event) {
  emit("click", event);
}
</script>

<template>
  <button
    class="icon-btn"
    :class="[toneClass, { pending: props.pending }]"
    type="button"
    :title="props.title"
    :aria-label="props.title"
    :disabled="props.disabled"
    @click="handleClick"
  >
    <span v-if="props.pending" class="icon-spinner" aria-hidden="true"></span>

    <svg v-else-if="props.icon === 'detail'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h6l4 4v12H6V4z" />
      <path d="M14 4v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>

    <svg v-else-if="props.icon === 'credential-info'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 10a5 5 0 0 1 10 0a5 5 0 0 1-10 0z" />
      <path d="M17 10h4" />
      <path d="M19 10v3" />
      <path d="M9 15l-3 5" />
      <path d="M13 15l-3 5" />
    </svg>

    <svg v-else-if="props.icon === 'credential-refresh'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M18 12a6 6 0 0 0-10-4L5 12" />
      <path d="M6 12a6 6 0 0 0 10 4l3-4" />
    </svg>

    <svg v-else-if="props.icon === 'refresh'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M19 12a7 7 0 0 0-12-4L4 12" />
      <path d="M5 12a7 7 0 0 0 12 4l3-4" />
    </svg>

    <svg v-else-if="props.icon === 'copy'" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>

    <svg v-else-if="props.icon === 'enable'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>

    <svg v-else-if="props.icon === 'disable'" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M8 12h8" />
    </svg>

    <svg v-else-if="props.icon === 'delete'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M8 7l1 12h6l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>

    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  </button>
</template>

<style scoped>
.icon-btn {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(24, 34, 52, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.94);
  color: var(--text-strong);
  cursor: pointer;
  transition: transform 0.18s ease, opacity 0.18s ease, background 0.18s ease, border-color 0.18s ease;
}

.icon-btn:hover {
  transform: translateY(-1px);
}

.icon-btn:disabled {
  cursor: default;
  opacity: 0.5;
  transform: none;
}

.icon-btn svg,
.icon-spinner {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.icon-btn svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-spinner {
  display: inline-flex;
  border-radius: 999px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: icon-spin 0.7s linear infinite;
}

.tone-neutral {
  color: var(--text-strong);
}

.tone-accent {
  color: var(--accent-strong);
  background: rgba(239, 246, 255, 0.98);
  border-color: rgba(22, 119, 255, 0.16);
}

.tone-warn {
  color: var(--warn);
  background: rgba(255, 247, 237, 0.98);
  border-color: rgba(217, 119, 6, 0.18);
}

.tone-danger {
  color: var(--danger);
  background: rgba(255, 241, 241, 0.98);
  border-color: rgba(220, 38, 38, 0.18);
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
