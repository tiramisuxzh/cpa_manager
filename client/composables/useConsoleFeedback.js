import { onBeforeUnmount } from "vue";
import { addLog } from "../lib/auth-file-state.js";

// 日志、toast、进度和忙碌态集中管理，避免每个业务动作都重复维护一套反馈逻辑。
export function useConsoleFeedback(state) {
  var toastSeed = 0;
  var progressHideTimers = {};
  var busyCount = 0;

  function progressTaskId(options) {
    return options && options.taskId ? String(options.taskId) : "__global__";
  }

  function clearProgressHideTimer(taskId) {
    var normalizedTaskId = String(taskId || "__global__");
    if (progressHideTimers[normalizedTaskId]) {
      clearTimeout(progressHideTimers[normalizedTaskId]);
      delete progressHideTimers[normalizedTaskId];
    }
  }

  function orderedProgressTasks(list) {
    return (Array.isArray(list) ? list : []).slice().sort(function (left, right) {
      var leftActive = !!(left && left.active);
      var rightActive = !!(right && right.active);
      var leftUpdated = left && left.updatedAt ? left.updatedAt : 0;
      var rightUpdated = right && right.updatedAt ? right.updatedAt : 0;

      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }
      return rightUpdated - leftUpdated;
    });
  }

  function syncLegacyProgressView() {
    var tasks = orderedProgressTasks(state.progressTasks);
    var current = tasks[0] || null;

    state.progressTasks = tasks;
    state.progressVisible = !!current;
    state.progressText = current ? current.text : "等待任务开始…";
    state.progressPercent = current ? current.percent : 0;
  }

  function updateProgressTask(options) {
    var normalizedTaskId = progressTaskId(options);
    var now = Date.now();
    var existing = (Array.isArray(state.progressTasks) ? state.progressTasks : []).filter(function (item) {
      return item && item.id === normalizedTaskId;
    })[0];
    var nextTask = Object.assign({}, existing || {
      id: normalizedTaskId,
      tone: "info",
      active: true,
      text: "任务进行中…",
      percent: 0,
      done: 0,
      total: 0
    }, {
      id: normalizedTaskId,
      text: options && options.text != null ? options.text : (existing && existing.text ? existing.text : "任务进行中…"),
      percent: Math.max(0, Math.min(100, options && options.percent == null ? (existing && existing.percent ? existing.percent : 0) : options.percent)),
      done: options && options.done != null ? Number(options.done) || 0 : (existing && existing.done ? existing.done : 0),
      total: options && options.total != null ? Number(options.total) || 0 : (existing && existing.total ? existing.total : 0),
      tone: options && options.tone ? options.tone : (existing && existing.tone ? existing.tone : "info"),
      active: options && options.active != null ? !!options.active : true,
      updatedAt: now
    });

    clearProgressHideTimer(normalizedTaskId);
    state.progressTasks = (Array.isArray(state.progressTasks) ? state.progressTasks : []).filter(function (item) {
      return item && item.id !== normalizedTaskId;
    }).concat([nextTask]);
    syncLegacyProgressView();
    return nextTask;
  }

  function removeProgressTask(taskId) {
    var normalizedTaskId = String(taskId || "__global__");

    clearProgressHideTimer(normalizedTaskId);
    state.progressTasks = (Array.isArray(state.progressTasks) ? state.progressTasks : []).filter(function (item) {
      return item && item.id !== normalizedTaskId;
    });
    syncLegacyProgressView();
  }

  function completeProgressTask(taskId, text, options) {
    var normalizedTaskId = String(taskId || "__global__");
    var currentOptions = options || {};
    var task = updateProgressTask({
      taskId: normalizedTaskId,
      text: text != null ? text : null,
      percent: currentOptions.percent == null ? 100 : currentOptions.percent,
      done: currentOptions.done,
      total: currentOptions.total,
      tone: currentOptions.tone || "success",
      active: false
    });

    progressHideTimers[normalizedTaskId] = setTimeout(function () {
      removeProgressTask(normalizedTaskId);
    }, currentOptions.hideDelayMs == null ? 1400 : currentOptions.hideDelayMs);

    return task;
  }

  function log(message, bad) {
    addLog(state, message, !!bad);
  }

  function dismissToast(id) {
    state.toasts = state.toasts.filter(function (item) {
      return item.id !== id;
    });
  }

  function notify(message, tone, duration) {
    var id = String(Date.now()) + "-" + (toastSeed += 1);
    state.toasts = state.toasts.concat([{
      id: id,
      message: message,
      tone: tone || "info"
    }]);
    setTimeout(function () {
      dismissToast(id);
    }, duration == null ? 2600 : duration);
  }

  function setBusy(isBusy) {
    if (isBusy) {
      busyCount += 1;
      state.busy = true;
      return;
    }
    busyCount = Math.max(0, busyCount - 1);
    state.busy = busyCount > 0;
  }

  function setProgress(text, percent, options) {
    updateProgressTask(Object.assign({}, options || {}, {
      text: text || "任务进行中…",
      percent: percent == null ? 0 : percent,
      active: true
    }));
  }

  function computeProgressPercent(done, total) {
    if (!total) {
      return 18;
    }
    return Math.max(8, Math.min(100, Math.round((done / total) * 100)));
  }

  function setStatus(done, total, options) {
    state.progress = { done: done, total: total };
    state.statusText = (total ? ("额度抓取 " + done + "/" + total) : "等待连接") + (state.items.length ? (" · 已载入 " + state.items.length + " 个账号") : "");
    setProgress(total
      ? ("正在等待所有账号的额度请求完成… " + done + "/" + total)
      : "等待所有账号的额度请求完成…", computeProgressPercent(done, total), Object.assign({}, options || {}, {
      done: done,
      total: total
    }));
  }

  onBeforeUnmount(function () {
    Object.keys(progressHideTimers).forEach(function (taskId) {
      clearProgressHideTimer(taskId);
    });
  });

  return {
    log: log,
    notify: notify,
    dismissToast: dismissToast,
    setBusy: setBusy,
    setProgress: setProgress,
    completeProgressTask: completeProgressTask,
    removeProgressTask: removeProgressTask,
    computeProgressPercent: computeProgressPercent,
    setStatus: setStatus,
    clearProgressHideTimer: clearProgressHideTimer
  };
}
