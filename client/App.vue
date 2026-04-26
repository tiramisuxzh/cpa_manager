<script setup>
import { computed, onMounted, ref } from "vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import CredentialInfoDrawer from "./components/CredentialInfoDrawer.vue";
import DisabledPoolView from "./components/DisabledPoolView.vue";
import ExceptionCenterView from "./components/ExceptionCenterView.vue";
import ExternalIntegrationView from "./components/ExternalIntegrationView.vue";
import FileDetailDrawer from "./components/FileDetailDrawer.vue";
import FilePoolView from "./components/FilePoolView.vue";
import IntegrationSettingsView from "./components/IntegrationSettingsView.vue";
import OperationProgressDialog from "./components/OperationProgressDialog.vue";
import QuotaPoolView from "./components/QuotaPoolView.vue";
import RequestEventsView from "./components/RequestEventsView.vue";
import SettingsView from "./components/SettingsView.vue";
import ToastStack from "./components/ToastStack.vue";
import { useManagementConsole } from "./composables/useManagementConsole.js";
import { PENDING_GROUPS } from "./lib/constants.js";

var consoleApp = useManagementConsole();
var activeRoute = ref("files");
var cachedRoutes = ref({
  "wenfxl-openai": false
});
var collapsedSections = ref({
  "file-management": false,
  usage: true,
  "external-integrations": true,
  settings: true
});

var SECTION_DEFINITIONS = [
  {
    id: "file-management",
    kicker: "Manage",
    title: "文件管理",
    desc: "围绕文件、额度、停用与异常处置的主工作区。"
  },
  {
    id: "usage",
    kicker: "Usage",
    title: "使用情况",
    desc: "围绕请求事件、消耗明细与结果追踪的分析区。"
  },
  {
    id: "external-integrations",
    kicker: "Integrate",
    title: "外部集成",
    desc: "把外部系统页面按配置地址嵌入到当前管理台。"
  },
  {
    id: "settings",
    kicker: "System",
    title: "系统设置",
    desc: "连接、阈值与外部集成地址等系统级配置。"
  }
];

var connectionReady = computed(function () {
  return !!String(consoleApp.settings.baseUrl || "").trim() && !!String(consoleApp.settings.key || "").trim();
});
var wenfxlIntegrationReady = computed(function () {
  return !!String(consoleApp.integrationSettings.wenfxlOpenaiUrl || "").trim();
});

var analytics = computed(function () {
  return consoleApp.analyticsCollections.value;
});

// 统一维护路由元信息，避免导航、页头和主内容各写一套文案，后续继续扩菜单时只改这一处。
var routeItems = computed(function () {
  return [
    {
      id: "files",
      sectionId: "file-management",
      sectionTitle: "文件管理",
      eyebrow: "File Management",
      kicker: "FILES",
      title: "文件池",
      desc: "上传、启停、删除和定位文件状态",
      pageDesc: "整个系统的第一工作区，专门替代 CLI 处理上传、启停、删除和详情确认。",
      meta: consoleApp.state.items.length + " 个文件",
      showRefreshFiles: true,
      showRescan: true
    },
    {
      id: "quotas",
      sectionId: "file-management",
      sectionTitle: "文件管理",
      eyebrow: "File Management",
      kicker: "QUOTA",
      title: "额度池",
      desc: "处理可用、预警、耗尽与转停判断",
      pageDesc: "优先解决“还能不能跑、是不是低额度预警、是否该转入停用池”的判断问题。",
      meta: analytics.value.operable.length + " 个运行中",
      showRefreshFiles: true,
      showRescan: true
    },
    {
      id: "disabled",
      sectionId: "file-management",
      sectionTitle: "文件管理",
      eyebrow: "File Management",
      kicker: "DISABLED",
      title: "停用池",
      desc: "集中处理停用文件的恢复、刷新和清理",
      pageDesc: "把所有 disabled 文件集中到一个工作区里管理，不再藏在筛选条件里。",
      meta: analytics.value.disabled.length + " 个停用",
      showRefreshFiles: true,
      showRescan: true
    },
    {
      id: "exceptions",
      sectionId: "file-management",
      sectionTitle: "文件管理",
      eyebrow: "File Management",
      kicker: "EXCEPT",
      title: "异常处置",
      desc: "拆分 401、额度、其他异常工作流",
      pageDesc: "把 401、额度、其他异常真正拆开，不再让删除和停用混成一团。",
      meta: analytics.value.badAll.length + " 个异常",
      showRefreshFiles: true,
      showRescan: true
    },
    {
      id: "usage-events",
      sectionId: "usage",
      sectionTitle: "使用情况",
      eyebrow: "Usage Analytics",
      kicker: "EVENT",
      title: "请求事件明细",
      desc: "承接模型、来源、结果与 Token 消耗明细",
      pageDesc: "基于官方 /usage 接口查看请求事件、认证索引命中情况、结果状态和 Token 消耗，并支持筛选分页与导出。",
      meta: consoleApp.usageCenter && consoleApp.usageCenter.synced
        ? (consoleApp.usageCenter.summary.totalRequests + " 条请求")
        : (connectionReady.value ? "等待手动刷新" : "先配置连接"),
      showRefreshFiles: false,
      showRescan: false
    },
    {
      id: "settings",
      sectionId: "settings",
      sectionTitle: "系统设置",
      eyebrow: "System Settings",
      kicker: "SETUP",
      title: "基础设置",
      desc: "连接、阈值与管理台本地行为",
      pageDesc: "只保留连接、预警阈值和管理台行为配置，不让低频设置打断主工作链路。",
      meta: connectionReady.value ? "已配置" : "待配置",
      showRefreshFiles: false,
      showRescan: false
    },
    {
      id: "integration-settings",
      sectionId: "settings",
      sectionTitle: "系统设置",
      eyebrow: "System Settings",
      kicker: "INTEGRATION",
      title: "集成配置",
      desc: "配置外部集成页面的访问地址",
      pageDesc: "在这里维护外部集成的访问地址，供左侧“外部集成”菜单直接嵌入使用。",
      meta: wenfxlIntegrationReady.value ? "已配置" : "待配置",
      showRefreshFiles: false,
      showRescan: false
    },
    {
      id: "wenfxl-openai",
      sectionId: "external-integrations",
      sectionTitle: "外部集成",
      eyebrow: "External Integration",
      kicker: "WENFXL",
      title: "wenfxl-openai",
      desc: "嵌入已配置的 wenfxl-openai 页面",
      pageDesc: "把已配置的 wenfxl-openai 地址直接嵌入到当前工作台，减少在多个系统之间来回切换。",
      meta: wenfxlIntegrationReady.value ? "已配置" : "待配置",
      showRefreshFiles: false,
      showRescan: false
    }
  ];
});

// 一级菜单按业务域分组，二级菜单才是实际工作台，这样后续扩展 usage / system 时不会继续把导航摊平。
var navSections = computed(function () {
  return SECTION_DEFINITIONS.map(function (section) {
    var children = routeItems.value.filter(function (item) {
      return item.sectionId === section.id;
    });
    return Object.assign({}, section, {
      children: children,
      active: children.some(function (item) {
        return item.id === activeRoute.value;
      })
    });
  });
});

var currentRoute = computed(function () {
  return routeItems.value.find(function (item) {
    return item.id === activeRoute.value;
  }) || routeItems.value[0];
});
var immersiveRoute = computed(function () {
  return currentRoute.value && currentRoute.value.id === "wenfxl-openai";
});

var routeMeta = computed(function () {
  return {
    sectionTitle: currentRoute.value.sectionTitle,
    title: currentRoute.value.title
  };
});
var autoRefreshFooter = computed(function () {
  var info = consoleApp.state.autoRefreshInfo || {};

  if (!consoleApp.settings.autoRefresh) {
    return {
      tone: "neutral",
      title: "自动刷新已关闭",
      detail: "开启后会按设定间隔静默执行",
      nextRun: ""
    };
  }

  if (info.running) {
    return {
      tone: "info",
      title: "自动刷新执行中",
      detail: info.lastRunAt ? ("上次执行 " + info.lastRunAt) : ("间隔 " + consoleApp.settings.interval + " 分钟"),
      nextRun: info.nextRunAt ? ("下次预计 " + info.nextRunAt) : ""
    };
  }

  if (!info.lastRunAt) {
    return {
      tone: "neutral",
      title: "自动刷新已开启",
      detail: "等待首次执行",
      nextRun: info.nextRunAt ? ("下次预计 " + info.nextRunAt) : ""
    };
  }

  if (info.lastResult === "error") {
    return {
      tone: "danger",
      title: "最近失败 " + info.lastRunAt,
      detail: info.lastMessage || "自动刷新执行失败",
      nextRun: info.nextRunAt ? ("下次预计 " + info.nextRunAt) : ""
    };
  }

  return {
    tone: "success",
    title: "最近成功 " + info.lastRunAt,
    detail: info.lastMessage || "自动刷新执行成功",
    nextRun: info.nextRunAt ? ("下次预计 " + info.nextRunAt) : ""
  };
});
var progressTasks = computed(function () {
  return Array.isArray(consoleApp.state.progressTasks) ? consoleApp.state.progressTasks : [];
});

var detailItem = computed(function () {
  return consoleApp.detailItem.value;
});
var credentialDetailItem = computed(function () {
  return consoleApp.credentialDetailItem.value;
});

function pendingText(type, idleText, loadingText) {
  return consoleApp.isPending(type) ? loadingText : idleText;
}

function workbenchPending() {
  return consoleApp.hasPending(PENDING_GROUPS.workbench);
}

function progressTaskStyle(task) {
  return {
    width: Math.max(0, Math.min(100, Number(task && task.percent) || 0)) + "%"
  };
}

function progressTaskCount(task) {
  if (task && task.total) {
    return (task.done || 0) + "/" + task.total;
  }
  return (Math.max(0, Math.min(100, Number(task && task.percent) || 0))) + "%";
}

function progressTaskTone(task) {
  return task && task.tone ? String(task.tone) : "info";
}

function progressTaskState(task) {
  if (task && task.active) {
    return "处理中";
  }
  if (progressTaskTone(task) === "danger") {
    return "失败";
  }
  if (progressTaskTone(task) === "warn") {
    return "已完成（部分异常）";
  }
  return "已完成";
}

function openDetail(item) {
  consoleApp.openDetail(item && item.key);
}

function openCredential(item) {
  consoleApp.openCredentialInfo(item && item.key);
}

function isSectionCollapsed(sectionId) {
  return !!collapsedSections.value[sectionId];
}

function toggleSection(sectionId) {
  collapsedSections.value[sectionId] = !collapsedSections.value[sectionId];
}

function expandRouteSection(routeId) {
  var route = routeItems.value.find(function (item) {
    return item.id === routeId;
  });
  if (route) {
    collapsedSections.value[route.sectionId] = false;
  }
}

function switchRoute(routeId) {
  if (activeRoute.value === routeId) {
    return;
  }
  // 外部集成页首次进入后保活，避免来回切换菜单时 iframe 被销毁后重新加载。
  if (routeId === "wenfxl-openai") {
    cachedRoutes.value["wenfxl-openai"] = true;
  }
  // 不同工作区的批量动作语义不同，切菜单时主动清空勾选，避免跨域残留选中项被误操作。
  consoleApp.clearSelection();
  expandRouteSection(routeId);
  activeRoute.value = routeId;
}

onMounted(function () {
  if (activeRoute.value === "wenfxl-openai") {
    cachedRoutes.value["wenfxl-openai"] = true;
  }
  expandRouteSection(activeRoute.value);
  consoleApp.initialize();
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar-shell">
      <div class="brand-block">
        <span class="brand-tag">Proxy Sprint</span>
        <h1>反代快速管理台</h1>
        <p>按“文件管理 / 使用情况 / 外部集成 / 系统设置”分域组织，让后续接更多能力时不再把左侧导航越堆越乱。</p>
      </div>

      <nav class="nav-list">
        <section
          v-for="section in navSections"
          :key="section.id"
          class="nav-section"
          :class="{ active: section.active }"
        >
          <button
            class="section-toggle"
            type="button"
            @click="toggleSection(section.id)"
          >
            <div class="section-head">
              <span class="section-kicker">{{ section.kicker }}</span>
              <div class="section-title-row">
                <strong>{{ section.title }}</strong>
                <span class="section-count">{{ section.children.length }}</span>
              </div>
              <small>{{ section.desc }}</small>
            </div>
            <span class="section-arrow" :class="{ collapsed: isSectionCollapsed(section.id) }"></span>
          </button>

          <div v-show="!isSectionCollapsed(section.id)" class="subnav-list">
            <button
              v-for="item in section.children"
              :key="item.id"
              class="subnav-item"
              :class="{ active: activeRoute === item.id }"
              type="button"
              @click="switchRoute(item.id)"
            >
              <div class="subnav-main">
                <span class="nav-kicker">{{ item.kicker }}</span>
                <strong>{{ item.title }}</strong>
              </div>
              <small>{{ item.desc }}</small>
              <span class="nav-meta">{{ item.meta }}</span>
            </button>
          </div>
        </section>
      </nav>

      <div class="sidebar-footer">
        <div class="footer-chip">
          <span class="status-dot"></span>
          <strong>{{ consoleApp.state.busy ? "处理中" : "空闲" }}</strong>
        </div>
        <p>{{ consoleApp.state.statusText }}</p>
        <div class="auto-refresh-footer" :class="'tone-' + autoRefreshFooter.tone">
          <strong>{{ autoRefreshFooter.title }}</strong>
          <span>{{ autoRefreshFooter.detail }}</span>
          <span v-if="autoRefreshFooter.nextRun" class="auto-refresh-next">{{ autoRefreshFooter.nextRun }}</span>
        </div>
      </div>
    </aside>

    <section class="workspace-shell" :class="{ immersive: immersiveRoute }">
      <header v-if="!immersiveRoute" class="workspace-toolbar surface-card">
        <div class="toolbar-copy">
          <span class="eyebrow">Workspace</span>
          <div class="breadcrumb-row">
            <span class="breadcrumb-item">{{ routeMeta.sectionTitle }}</span>
            <span class="breadcrumb-sep">/</span>
            <strong>{{ routeMeta.title }}</strong>
          </div>
        </div>
        <div class="header-actions">
          <button
            v-if="currentRoute.showRefreshFiles"
            class="primary-btn"
            type="button"
            :disabled="workbenchPending()"
            :aria-busy="consoleApp.isPending('refresh-files') ? 'true' : 'false'"
            @click="consoleApp.loadFiles({ pendingType: 'refresh-files', includeCredentialInfo: true })"
          >
            <span class="button-label" :class="{ pending: consoleApp.isPending('refresh-files') }">{{ pendingText('refresh-files', '刷新文件与凭证', '刷新中') }}</span>
          </button>
          <button
            v-if="currentRoute.showRescan"
            class="secondary-btn"
            type="button"
            :disabled="workbenchPending()"
            :aria-busy="consoleApp.isPending('rescan') ? 'true' : 'false'"
            @click="consoleApp.rescan"
          >
            <span class="button-label" :class="{ pending: consoleApp.isPending('rescan') }">{{ pendingText('rescan', '重新归类', '归类中') }}</span>
          </button>
        </div>
      </header>

      <section v-if="!immersiveRoute && progressTasks.length" class="progress-strip surface-card">
        <div class="progress-strip-head">
          <strong>当前执行中的操作</strong>
          <span>{{ progressTasks.length }} 个任务</span>
        </div>
        <div class="progress-list">
          <article
            v-for="task in progressTasks"
            :key="task.id"
            class="progress-item"
            :data-tone="progressTaskTone(task)"
            :class="{ completed: !task.active }"
          >
            <div class="progress-copy">
              <strong>{{ task.text || "任务进行中…" }}</strong>
              <span>{{ progressTaskState(task) }}</span>
            </div>
            <div class="progress-meta">
              <span>{{ progressTaskCount(task) }}</span>
            </div>
            <div class="progress-track">
              <span class="progress-value" :style="progressTaskStyle(task)"></span>
            </div>
          </article>
        </div>
      </section>

      <main class="workspace-body" :class="{ immersive: immersiveRoute }">
        <FilePoolView v-if="activeRoute === 'files'" :console-app="consoleApp" :on-open-detail="openDetail" :on-open-credential="openCredential" />
        <QuotaPoolView v-else-if="activeRoute === 'quotas'" :console-app="consoleApp" :on-open-detail="openDetail" :on-open-credential="openCredential" />
        <DisabledPoolView v-else-if="activeRoute === 'disabled'" :console-app="consoleApp" :on-open-detail="openDetail" :on-open-credential="openCredential" />
        <ExceptionCenterView v-else-if="activeRoute === 'exceptions'" :console-app="consoleApp" :on-open-detail="openDetail" :on-open-credential="openCredential" />
        <RequestEventsView v-else-if="activeRoute === 'usage-events'" :console-app="consoleApp" />
        <SettingsView v-else-if="activeRoute === 'settings'" :console-app="consoleApp" />
        <IntegrationSettingsView v-else-if="activeRoute === 'integration-settings'" :console-app="consoleApp" @open-route="switchRoute" />
        <SettingsView v-else-if="activeRoute !== 'wenfxl-openai'" :console-app="consoleApp" />
        <ExternalIntegrationView
          v-if="cachedRoutes['wenfxl-openai']"
          v-show="activeRoute === 'wenfxl-openai'"
          :console-app="consoleApp"
          @open-route="switchRoute"
        />
      </main>
    </section>

    <input
      :ref="consoleApp.uploadInputRef"
      type="file"
      multiple
      accept=".json,application/json"
      class="hidden-input"
      @change="consoleApp.handleUploadChange"
    >

    <FileDetailDrawer
      :item="detailItem"
      :is-pending="consoleApp.isPending"
      :has-pending="consoleApp.hasPending"
      @close="consoleApp.closeDetail"
      @refresh="consoleApp.refreshOne($event.key)"
      @refresh-credential="consoleApp.refreshCredentialOne($event.key)"
      @credential="openCredential"
      @copy="consoleApp.copyName($event.name)"
      @toggle-disabled="consoleApp.setFileDisabled($event, !$event.disabled)"
      @delete="consoleApp.deleteFile"
    />
    <CredentialInfoDrawer
      :item="credentialDetailItem"
      :is-pending="consoleApp.isPending"
      @close="consoleApp.closeCredentialInfo"
      @refresh="consoleApp.readCredentialInfo($event.key, { pendingType: 'row-credential-info' })"
    />

    <ToastStack :toasts="consoleApp.state.toasts" @dismiss="consoleApp.dismissToast" />
    <ConfirmDialog :dialog="consoleApp.confirmDialog" @confirm="consoleApp.confirmAction" @cancel="consoleApp.cancelConfirm" />
    <OperationProgressDialog :dialog="consoleApp.operationDialog" @close="consoleApp.closeOperationDialog" />
  </div>
</template>

<style scoped>
.app-shell {
  width: min(1780px, calc(100vw - 24px));
  height: calc(100vh - 16px);
  margin: 8px auto;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.sidebar-shell,
.workspace-shell {
  min-height: 0;
}

.sidebar-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 14px;
  padding: 18px 14px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(13, 22, 36, 0.96), rgba(14, 28, 46, 0.98));
  border: 1px solid var(--sidebar-line);
  box-shadow: var(--shadow-large);
  color: #eff4ff;
}

.brand-block {
  display: grid;
  gap: 8px;
}

.brand-tag {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.brand-block h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
  line-height: 1.02;
  letter-spacing: -0.05em;
}

.brand-block p,
.sidebar-footer p {
  margin: 0;
  color: rgba(239, 244, 255, 0.72);
  font-size: 13px;
  line-height: 1.75;
}

.nav-list {
  display: grid;
  gap: 12px;
  align-content: start;
  overflow: auto;
  padding-right: 4px;
}

.nav-section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: border-color 0.18s ease, background 0.18s ease;
}

.nav-section.active {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(22, 119, 255, 0.16);
}

.section-toggle {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.section-head {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.section-kicker {
  color: rgba(239, 244, 255, 0.52);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.section-title-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.section-title-row strong {
  font-size: 15px;
  line-height: 1.2;
}

.section-title-row small,
.section-head small {
  color: rgba(239, 244, 255, 0.7);
}

.section-count {
  display: inline-flex;
  min-width: 28px;
  justify-content: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(239, 244, 255, 0.92);
  font-size: 11px;
}

.section-head small {
  font-size: 12px;
  line-height: 1.6;
}

.section-arrow {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  margin-top: 10px;
  border-right: 2px solid rgba(239, 244, 255, 0.72);
  border-bottom: 2px solid rgba(239, 244, 255, 0.72);
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}

.section-arrow.collapsed {
  transform: rotate(-45deg);
}

.subnav-list {
  display: grid;
  gap: 8px;
}

.subnav-item {
  display: grid;
  gap: 6px;
  padding: 12px 12px 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(239, 244, 255, 0.92);
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
}

.subnav-item:hover {
  transform: translateY(-1px);
}

.subnav-item.active {
  background: linear-gradient(135deg, rgba(22, 119, 255, 0.16), rgba(22, 119, 255, 0.08));
  border-color: rgba(22, 119, 255, 0.28);
}

.subnav-main {
  display: grid;
  gap: 4px;
}

.nav-kicker {
  color: rgba(239, 244, 255, 0.56);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.subnav-item strong {
  font-size: 15px;
  line-height: 1.2;
}

.subnav-item small {
  color: rgba(239, 244, 255, 0.68);
  font-size: 12px;
  line-height: 1.6;
}

.nav-meta {
  display: inline-flex;
  width: fit-content;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(239, 244, 255, 0.88);
  font-size: 11px;
}

.sidebar-footer {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.footer-chip {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  color: rgba(239, 244, 255, 0.92);
}

.auto-refresh-footer {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.auto-refresh-footer strong {
  font-size: 12px;
  line-height: 1.4;
}

.auto-refresh-footer span {
  color: rgba(239, 244, 255, 0.72);
  font-size: 12px;
  line-height: 1.5;
}

.auto-refresh-next {
  color: rgba(239, 244, 255, 0.9);
}

.auto-refresh-footer.tone-success {
  border-color: rgba(22, 163, 74, 0.22);
  background: rgba(22, 163, 74, 0.08);
  color: #dcfce7;
}

.auto-refresh-footer.tone-danger {
  border-color: rgba(220, 38, 38, 0.22);
  background: rgba(220, 38, 38, 0.08);
  color: #fee2e2;
}

.auto-refresh-footer.tone-info {
  border-color: rgba(22, 119, 255, 0.22);
  background: rgba(22, 119, 255, 0.08);
  color: #dbeafe;
}

.workspace-shell {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
}

.workspace-shell.immersive {
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
}

.workspace-toolbar,
.progress-strip {
  padding: 12px 16px;
}

.workspace-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.toolbar-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.breadcrumb-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.breadcrumb-item,
.breadcrumb-sep {
  color: var(--text-muted);
  font-size: 12px;
}

.breadcrumb-row strong {
  color: var(--text-strong);
  font-size: 15px;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.progress-strip {
  display: grid;
  gap: 10px;
}

.progress-strip-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.progress-strip-head strong {
  color: var(--text-strong);
  font-size: 14px;
}

.progress-strip-head span {
  color: var(--text-soft);
  font-size: 12px;
}

.progress-list {
  display: grid;
  gap: 10px;
  max-height: 220px;
  overflow: auto;
}

.progress-item {
  display: grid;
  gap: 8px;
  padding: 12px 12px 10px;
  border-radius: 18px;
  border: 1px solid rgba(24, 34, 52, 0.06);
  background: rgba(255, 255, 255, 0.74);
}

.progress-item.completed {
  opacity: 0.92;
}

.progress-copy {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.progress-copy strong {
  color: var(--text-strong);
  font-size: 14px;
}

.progress-copy span {
  color: var(--text-soft);
  font-size: 12px;
}

.progress-meta {
  display: flex;
  justify-content: flex-end;
}

.progress-meta span {
  color: var(--text-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.progress-track {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(24, 34, 52, 0.08);
}

.progress-value {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #1677ff, #14b8a6, #22c55e);
  box-shadow: 0 0 28px rgba(22, 119, 255, 0.24);
  transition: width 0.2s ease;
}

.progress-item[data-tone="success"] .progress-value {
  background: linear-gradient(90deg, #16a34a, #22c55e);
  box-shadow: 0 0 24px rgba(22, 163, 74, 0.2);
}

.progress-item[data-tone="warn"] .progress-value {
  background: linear-gradient(90deg, #f59e0b, #d97706);
  box-shadow: 0 0 24px rgba(217, 119, 6, 0.2);
}

.progress-item[data-tone="danger"] .progress-value {
  background: linear-gradient(90deg, #ef4444, #dc2626);
  box-shadow: 0 0 24px rgba(220, 38, 38, 0.2);
}

.workspace-body {
  min-height: 0;
  overflow: hidden;
  display: flex;
}

.workspace-body.immersive {
  height: 100%;
}

.workspace-body > * {
  flex: 1 1 auto;
  min-height: 0;
}

.hidden-input {
  display: none;
}

@media (max-width: 1360px) {
  .app-shell {
    height: auto;
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .sidebar-shell,
  .workspace-body,
  .nav-list {
    overflow: visible;
  }

  .nav-list {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
}

@media (max-width: 960px) {
  .app-shell {
    width: calc(100% - 16px);
    margin: 8px auto 16px;
  }

  .workspace-toolbar,
  .breadcrumb-row,
  .header-actions,
  .progress-copy {
    flex-direction: column;
    align-items: flex-start;
  }

  .nav-list {
    grid-template-columns: 1fr;
  }
}
</style>
