import { onBeforeUnmount } from "vue";
import { addLog } from "../lib/auth-file-state.js";

// 日志、toast、进度和忙碌态集中管理，避免每个业务动作都重复维护一套反馈逻辑。
export function useConsoleFeedback(state) {
  var toastSeed = 0;
  var progressHideTimer = null;
  var busyCount = 0;

  function clearProgressHideTimer() {
    if (progressHideTimer) {
      clearTimeout(progressHideTimer);
      progressHideTimer = null;
    }
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
      clearProgressHideTimer();
      state.progressVisible = true;
      return;
    }
    busyCount = Math.max(0, busyCount - 1);
    state.busy = busyCount > 0;
    if (state.busy) {
      return;
    }
    clearProgressHideTimer();
    progressHideTimer = setTimeout(function () {
      state.progressVisible = false;
    }, 1400);
  }

  function setProgress(text, percent) {
    state.progressVisible = true;
    state.progressText = text || "任务进行中…";
    state.progressPercent = Math.max(0, Math.min(100, percent == null ? 0 : percent));
  }

  function computeProgressPercent(done, total) {
    if (!total) {
      return 18;
    }
    return Math.max(8, Math.min(100, Math.round((done / total) * 100)));
  }

  function setStatus(done, total) {
    state.progress = { done: done, total: total };
    state.statusText = (total ? ("额度抓取 " + done + "/" + total) : "等待连接") + (state.items.length ? (" · 已载入 " + state.items.length + " 个账号") : "");
    setProgress(total
      ? ("正在等待所有账号的额度请求完成… " + done + "/" + total)
      : "等待所有账号的额度请求完成…", computeProgressPercent(done, total));
  }

  onBeforeUnmount(function () {
    clearProgressHideTimer();
  });

  return {
    log: log,
    notify: notify,
    dismissToast: dismissToast,
    setBusy: setBusy,
    setProgress: setProgress,
    computeProgressPercent: computeProgressPercent,
    setStatus: setStatus,
    clearProgressHideTimer: clearProgressHideTimer
  };
}
