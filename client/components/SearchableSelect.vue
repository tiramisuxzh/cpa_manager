<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

var props = defineProps({
  modelValue: {
    type: String,
    default: "all"
  },
  options: {
    type: Array,
    default: function () {
      return [];
    }
  },
  allLabel: {
    type: String,
    default: "全部"
  },
  placeholder: {
    type: String,
    default: "选择"
  },
  searchable: {
    type: Boolean,
    default: true
  },
  emptyText: {
    type: String,
    default: "没有匹配项"
  }
});

var emit = defineEmits(["update:modelValue"]);

var rootRef = ref(null);
var triggerRef = ref(null);
var popoverRef = ref(null);
var open = ref(false);
var keyword = ref("");
var popupStyle = ref({});

function normalizedOption(option) {
  if (option && typeof option === "object") {
    return {
      value: String(option.value),
      label: option.label != null ? String(option.label) : String(option.value),
      keywords: option.keywords != null ? String(option.keywords) : ""
    };
  }
  return {
    value: String(option),
    label: String(option),
    keywords: ""
  };
}

var allOption = computed(function () {
  return {
    value: "all",
    label: props.allLabel,
    keywords: props.allLabel
  };
});

var normalizedOptions = computed(function () {
  return props.options.map(normalizedOption);
});

var selectedOption = computed(function () {
  if (props.modelValue === "all") {
    return allOption.value;
  }
  return normalizedOptions.value.find(function (option) {
    return option.value === props.modelValue;
  }) || allOption.value;
});

var filteredOptions = computed(function () {
  var search = String(keyword.value || "").trim().toLowerCase();
  var options = [allOption.value].concat(normalizedOptions.value);

  if (!props.searchable || !search) {
    return options;
  }

  return options.filter(function (option) {
    return [
      option.label,
      option.value,
      option.keywords
    ].join(" ").toLowerCase().indexOf(search) !== -1;
  });
});

function close() {
  open.value = false;
  keyword.value = "";
}

function updatePopoverPosition() {
  var rect;
  var viewportPadding = 16;
  var preferredWidth;
  var maxWidth;

  if (!open.value || !triggerRef.value) {
    return;
  }

  rect = triggerRef.value.getBoundingClientRect();
  preferredWidth = Math.max(rect.width, 220);
  maxWidth = Math.max(220, window.innerWidth - viewportPadding * 2);

  popupStyle.value = {
    top: (rect.bottom + 8) + "px",
    left: Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - Math.min(preferredWidth, maxWidth) - viewportPadding)
    ) + "px",
    width: Math.min(preferredWidth, maxWidth) + "px"
  };
}

function toggle() {
  open.value = !open.value;
  if (!open.value) {
    keyword.value = "";
    return;
  }
  nextTick(updatePopoverPosition);
}

function selectOption(value) {
  emit("update:modelValue", value);
  close();
}

function handleWindowPointer(event) {
  if (!rootRef.value || rootRef.value.contains(event.target)) {
    return;
  }
  if (popoverRef.value && popoverRef.value.contains(event.target)) {
    return;
  }
  close();
}

function handleViewportChange() {
  if (!open.value) {
    return;
  }
  updatePopoverPosition();
}

onMounted(function () {
  window.addEventListener("mousedown", handleWindowPointer);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(function () {
  window.removeEventListener("mousedown", handleWindowPointer);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
});

watch(open, function (value) {
  if (value) {
    nextTick(updatePopoverPosition);
  }
});
</script>

<template>
  <div ref="rootRef" class="searchable-select">
    <button
      ref="triggerRef"
      class="select-trigger"
      type="button"
      :class="{ active: open }"
      @click="toggle"
    >
      <span class="trigger-label">{{ selectedOption.label || props.placeholder }}</span>
      <span class="trigger-arrow" :class="{ open: open }"></span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popoverRef"
        class="select-popover"
        :style="popupStyle"
      >
        <div v-if="props.searchable" class="popover-search">
          <input
            v-model="keyword"
            class="text-input"
            type="text"
            placeholder="输入关键字过滤"
          >
        </div>

        <div class="popover-list">
          <button
            v-for="option in filteredOptions"
            :key="option.value"
            class="option-item"
            :class="{ selected: option.value === props.modelValue }"
            type="button"
            @click="selectOption(option.value)"
          >
            <span>{{ option.label }}</span>
            <strong v-if="option.value === props.modelValue">当前</strong>
          </button>

          <div v-if="!filteredOptions.length" class="empty-item">
            {{ props.emptyText }}
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
  width: 100%;
}

.select-trigger {
  width: 100%;
  min-height: 44px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 0 14px;
  border-radius: 18px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.88);
  color: var(--text-strong);
  cursor: pointer;
}

.select-trigger.active {
  border-color: rgba(22, 119, 255, 0.28);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.08);
}

.trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.trigger-arrow {
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}

.trigger-arrow.open {
  transform: rotate(-135deg);
}

.select-popover {
  position: fixed;
  z-index: 120;
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(24, 34, 52, 0.08);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.14);
}

.popover-search {
  display: grid;
}

.popover-list {
  max-height: min(280px, 42vh);
  overflow: auto;
  display: grid;
  gap: 6px;
}

.option-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: rgba(244, 247, 252, 0.9);
  color: var(--text-strong);
  text-align: left;
  cursor: pointer;
}

.option-item.selected {
  border-color: rgba(22, 119, 255, 0.22);
  background: rgba(22, 119, 255, 0.08);
}

.option-item:hover {
  border-color: rgba(24, 34, 52, 0.08);
  background: rgba(238, 244, 251, 0.96);
}

.option-item span,
.empty-item {
  font-size: 13px;
  line-height: 1.5;
}

.option-item strong {
  color: var(--accent-strong);
  font-size: 11px;
}

.empty-item {
  padding: 12px;
  color: var(--text-soft);
  text-align: center;
}
</style>
