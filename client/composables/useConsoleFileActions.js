import { enrichError, enrichItem } from "../lib/auth-file-state.js";

// 文件级动作统一放在这里，主 composable 只保留数据流和派生状态。
export function useConsoleFileActions(context) {
  var api = context.api;
  var state = context.state;
  var uploadInputRef = context.uploadInputRef;
  var currentClassifierOptions = context.currentClassifierOptions;
  var currentTokenRefreshOptions = context.currentTokenRefreshOptions;
  var persistCurrentSnapshot = context.persistCurrentSnapshot;
  var updateItem = context.updateItem;
  var reload = context.reload;
  var setBusy = context.setBusy;
  var setProgress = context.setProgress;
  var completeProgressTask = context.completeProgressTask;
  var removeProgressTask = context.removeProgressTask;
  var computeProgressPercent = context.computeProgressPercent;
  var notify = context.notify;
  var log = context.log;
  var askConfirm = context.askConfirm;
  var startPending = context.startPending;
  var finishPending = context.finishPending;
  var clearSelectionKeys = context.clearSelectionKeys;
  var showOperationDialog = context.showOperationDialog;
  var updateOperationDialog = context.updateOperationDialog;
  var closeOperationDialog = context.closeOperationDialog;

  function progressTaskId(type, key) {
    return String(type || "__global__") + "::" + String(key || "");
  }

  function resolveProgressTaskId(options, type, key) {
    return options && options.progressTaskId
      ? String(options.progressTaskId)
      : progressTaskId(type, key);
  }

  function setTaskProgress(taskId, text, percent, options) {
    setProgress(text, percent, Object.assign({}, options || {}, {
      taskId: String(taskId || "__global__")
    }));
  }

  function completeTaskProgress(taskId, text, options) {
    completeProgressTask(String(taskId || "__global__"), text, options);
  }

  function removeTaskProgress(taskId) {
    removeProgressTask(String(taskId || "__global__"));
  }

  function manageableItems() {
    return state.items.filter(function (item) {
      return item.name && !item.runtimeOnly;
    });
  }

  function targetFileItems(list, options) {
    var settings = options || {};
    var normalized = Array.isArray(list) ? list : [];

    normalized = normalized.filter(function (item) {
      return item && item.name && !item.runtimeOnly;
    });

    if (!settings.allowDisabled) {
      normalized = normalized.filter(function (item) {
        return !item.disabled;
      });
    }

    return normalized;
  }

  function findItemByKey(key) {
    return state.items.filter(function (item) {
      return item.key === key;
    })[0] || null;
  }

  function revivable401Items(list) {
    return targetFileItems(list, { allowDisabled: true }).filter(function (item) {
      return item.badReasonGroup === "auth-401";
    });
  }

  function credentialRefreshableItems(list) {
    return targetFileItems(list, { allowDisabled: true });
  }

  // 批量确认统一输出结构化内容，避免文件一多时把确认弹窗直接撑爆。
  function buildConfirmOptions(list, options, fallback) {
    var currentOptions = options || {};
    var defaults = fallback || {};

    return {
      title: currentOptions.confirmTitle || defaults.title || "确认操作",
      message: currentOptions.confirmMessage || defaults.message || "",
      items: Array.isArray(currentOptions.confirmItems)
        ? currentOptions.confirmItems
        : list.map(function (item) { return item.name; }).filter(Boolean),
      listTitle: currentOptions.confirmListTitle || defaults.listTitle || "本次处理文件",
      note: currentOptions.confirmNote || defaults.note || "",
      confirmText: currentOptions.confirmText || defaults.confirmText || "确认",
      cancelText: currentOptions.cancelText || defaults.cancelText || "取消",
      tone: currentOptions.tone || defaults.tone || "danger"
    };
  }

  function waitMilliseconds(value) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(value) || 0));
    });
  }

  function stringifyActionDetail(value) {
    if (value == null) {
      return "";
    }
    if (typeof value === "string") {
      return String(value).trim();
    }
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function actionMessageText(value, fallback) {
    if (value == null || value === "") {
      return fallback || "";
    }
    if (typeof value === "string") {
      return String(value).trim() || fallback || "";
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return String(value);
    }

    return actionMessageText(value.message)
      || actionMessageText(value.error)
      || actionMessageText(value.detail)
      || stringifyActionDetail(value)
      || fallback
      || "";
  }

  function parseJsonSafe(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch (_) {
      return null;
    }
  }

  function reviveSecondCheckPassed(item) {
    return !!item && item.badReasonGroup !== "auth-401" && item.badReasonGroup !== "non-quota";
  }

  function reviveSuccessMessage(item) {
    if (!item) {
      return "401 已解除，认证状态已恢复。";
    }
    if (item.badReasonGroup === "quota") {
      return "401 已解除，当前账号已转为额度异常。";
    }
    if (item.disabled) {
      return "401 已解除，文件当前仍保持停用状态。";
    }
    return "401 已解除，认证状态已恢复。";
  }

  function reviveFailureMessage(item, fallbackText) {
    if (!item) {
      return fallbackText || "复活后的二次校验没有返回结果。";
    }
    return item.reason || item.quotaError || item.badReasonLabel || fallbackText || "复活后的二次校验仍未通过。";
  }

  function reviveDialogMessage(result, fallbackText) {
    return actionMessageText(result && result.message, fallbackText || "等待当前文件执行结果…");
  }

  function activeDialogNames(map) {
    return Object.keys(map || {}).map(function (key) {
      return map[key];
    }).filter(Boolean);
  }

  function appendFailureDetail(list, item, message) {
    var target = Array.isArray(list) ? list : [];

    target.push({
      key: item && item.key ? item.key : String(target.length),
      name: item && (item.name || item.email) ? (item.name || item.email) : "未命名文件",
      message: actionMessageText(message, "未返回明确失败原因") || "未返回明确失败原因"
    });

    return target.slice();
  }

  function appendResultDetail(list, item, result, success, message) {
    var target = Array.isArray(list) ? list : [];
    var detail = result && result.detail ? result.detail : {};
    var compareFields = Array.isArray(detail.changes) ? detail.changes.map(function (field, index) {
      return {
        key: field && field.key ? field.key : ("field-" + index),
        label: field && field.label ? field.label : (field && field.key ? field.key : ("字段 " + (index + 1))),
        before: field && field.before != null ? String(field.before) : "",
        after: field && field.after != null ? String(field.after) : "",
        changed: !!(field && field.changed)
      };
    }) : [];

    target.push({
      key: item && item.key ? (item.key + "::result::" + target.length) : ("result-" + target.length),
      name: item && (item.name || item.email) ? (item.name || item.email) : "未命名文件",
      status: success ? "success" : "failed",
      message: actionMessageText(message, success ? "执行成功" : "执行失败") || (success ? "执行成功" : "执行失败"),
      compareFields: compareFields,
      beforeText: detail && detail.beforeText ? detail.beforeText : "",
      afterText: detail && detail.afterText ? detail.afterText : ""
    });

    return target.slice();
  }

  // 认证续期只依赖文件名和 refresh_token，本身不额外做额度接口校验。
  async function executeCredentialRefresh(item) {
    var result;
    var message;

    if (!item || !item.name) {
      return {
        success: false,
        reason: "credential_refresh_missing_name",
        message: "缺少文件名，无法执行认证续期。"
      };
    }
    if (item.runtimeOnly) {
      return {
        success: false,
        reason: "credential_refresh_runtime_only",
        message: "运行时账号不支持认证续期。"
      };
    }

    try {
      result = await api.refreshAuthCredential(item);
    } catch (error) {
      return {
        success: false,
        reason: "credential_refresh_request_failed",
        message: error && error.message ? error.message : "认证续期失败"
      };
    }

    if (!result || result.success !== true) {
      message = actionMessageText(result && result.message, "认证续期失败");
      return Object.assign({}, result || {}, {
        success: false,
        message: message
      });
    }

    return Object.assign({}, result, {
      success: true,
      message: actionMessageText(result.message, "认证续期已完成并回写成功。")
    });
  }

  function applyCredentialTimeline(key, result) {
    if (!key || !result || (!result.lastRefresh && !result.expired)) {
      return;
    }

    updateItem(key, function (current) {
      var detail = result && result.detail ? result.detail : {};
      var nextContent = detail && detail.afterText ? parseJsonSafe(detail.afterText) : null;
      return Object.assign({}, current, {
        lastRefresh: result.lastRefresh || current.lastRefresh || "",
        expired: result.expired || current.expired || "",
        credentialInfoStatus: nextContent ? "success" : current.credentialInfoStatus,
        credentialInfoError: nextContent ? "" : current.credentialInfoError,
        credentialFetchedAt: nextContent ? (result.lastRefresh || current.credentialFetchedAt || "") : current.credentialFetchedAt,
        credentialContent: nextContent || current.credentialContent || null,
        credentialText: detail && detail.afterText ? detail.afterText : (current.credentialText || "")
      });
    });
    persistCurrentSnapshot();
  }

  async function sequenceDelete(list, actionLabel, taskId) {
    var result = { ok: 0, fail: 0 };
    var index;

    for (index = 0; index < list.length; index += 1) {
      var item = list[index];
      setTaskProgress(taskId, (actionLabel || "正在删除文件") + "… " + (index + 1) + "/" + list.length + " · " + item.name, computeProgressPercent(index + 1, list.length), {
        done: index + 1,
        total: list.length
      });
      try {
        await api.deleteAuthFile(item.name);
        result.ok += 1;
        log("删除成功：" + item.name);
      } catch (error) {
        result.fail += 1;
        log("删除失败：" + item.name + " · " + error.message, true);
      }
    }

    return result;
  }

  async function sequenceSetDisabled(list, disabled, actionLabel, taskId) {
    var result = { ok: 0, fail: 0 };
    var index;

    for (index = 0; index < list.length; index += 1) {
      var item = list[index];
      setTaskProgress(taskId, (actionLabel || (disabled ? "正在停用文件" : "正在启用文件")) + "… " + (index + 1) + "/" + list.length + " · " + item.name, computeProgressPercent(index + 1, list.length), {
        done: index + 1,
        total: list.length
      });
      try {
        await api.setAuthFileDisabled(item.name, disabled);
        result.ok += 1;
        log((disabled ? "停用成功：" : "启用成功：") + item.name);
      } catch (error) {
        result.fail += 1;
        log((disabled ? "停用失败：" : "启用失败：") + item.name + " · " + error.message, true);
      }
    }

    return result;
  }

  // 删除与启停是三大页面都会复用的主动作，这里统一成公共入口，避免每个页面各自拼确认与进度逻辑。
  async function deleteItems(list, options) {
    var currentOptions = options || {};
    var targetList = targetFileItems(list, { allowDisabled: true });
    var confirmTitle = currentOptions.confirmTitle || "确认删除文件";
    var confirmText = currentOptions.confirmText || "确认删除";
    var pendingType = currentOptions.pendingType || "delete-selected";
    var pendingKey = currentOptions.pendingKey || "";
    var progressLabel = currentOptions.progressLabel || "正在准备删除认证文件…";
    var sequenceLabel = currentOptions.sequenceLabel || "正在删除文件";
    var startLog = currentOptions.startLog || ("开始删除文件，共 " + targetList.length + " 个。");
    var completeText = currentOptions.completeText || "删除完成";
    var progressId = resolveProgressTaskId(currentOptions, pendingType, pendingKey);
    var confirmOptions;
    var result;

    if (!targetList.length) {
      log(currentOptions.emptyLog || "当前没有可删除的文件。");
      notify(currentOptions.emptyToast || "当前没有可删除的文件。", "info");
      return null;
    }

    confirmOptions = buildConfirmOptions(targetList, currentOptions, {
      title: confirmTitle,
      message: "即将删除 " + targetList.length + " 个文件，该操作不可恢复。",
      listTitle: "本次删除文件",
      note: "确认后会按当前列表顺序逐个删除，执行结果会写入底部动态日志。",
      confirmText: confirmText,
      tone: "danger"
    });

    if (!await askConfirm(confirmOptions)) {
      log(currentOptions.cancelLog || "用户取消了删除操作。");
      notify(currentOptions.cancelToast || "已取消删除操作。", "info");
      return null;
    }

    startPending(pendingType, pendingKey);
    setBusy(true);
    setTaskProgress(progressId, progressLabel, 8, {
      done: 0,
      total: targetList.length
    });

    try {
      log(startLog);
      result = await sequenceDelete(targetList, sequenceLabel, progressId);
      log((currentOptions.completeLogPrefix || completeText) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。");
      notify((currentOptions.completeToastPrefix || completeText) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。", result.fail ? "warn" : "success", 3200);
      clearSelectionKeys(targetList.map(function (item) {
        return item.key;
      }));
      setTaskProgress(progressId, currentOptions.reloadProgressText || "操作完成，正在同步文件状态…", 100, {
        done: targetList.length,
        total: targetList.length
      });
      await reload({
        silentToast: true,
        progressTaskId: progressId
      });
      completeTaskProgress(progressId, completeText + "。", {
        tone: result.fail ? "warn" : "success",
        done: targetList.length,
        total: targetList.length,
        hideDelayMs: result.fail ? 2200 : 1400
      });
      return result;
    } catch (error) {
      completeTaskProgress(progressId, "删除操作失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      throw error;
    } finally {
      setBusy(false);
      finishPending(pendingType, pendingKey);
    }
  }

  async function setItemsDisabled(list, disabled, options) {
    var currentOptions = options || {};
    var targetList = targetFileItems(list, { allowDisabled: true });
    var actionLabel = disabled ? "停用" : "启用";
    var pendingType = currentOptions.pendingType || (disabled ? "disable-selected" : "enable-selected");
    var pendingKey = currentOptions.pendingKey || "";
    var progressLabel = currentOptions.progressLabel || ("正在准备" + actionLabel + "认证文件…");
    var sequenceLabel = currentOptions.sequenceLabel || ("正在" + actionLabel + "文件");
    var progressId = resolveProgressTaskId(currentOptions, pendingType, pendingKey);
    var confirmOptions;
    var result;

    targetList = targetList.filter(function (item) {
      return disabled ? !item.disabled : item.disabled;
    });

    if (!targetList.length) {
      log(currentOptions.emptyLog || ("当前没有可" + actionLabel + "的文件。"));
      notify(currentOptions.emptyToast || ("当前没有可" + actionLabel + "的文件。"), "info");
      return null;
    }

    confirmOptions = buildConfirmOptions(targetList, currentOptions, {
      title: currentOptions.confirmTitle || ("确认批量" + actionLabel + "文件"),
      message: "即将" + actionLabel + " " + targetList.length + " 个文件，请确认是否继续。",
      listTitle: "本次" + actionLabel + "文件",
      note: disabled
        ? "停用后的文件会进入停用池，后续恢复后可以再次启用。"
        : "启用前建议先确认额度或认证状态已经恢复正常。",
      confirmText: currentOptions.confirmText || ("确认" + actionLabel),
      tone: disabled ? "warn" : "success"
    });

    if (!await askConfirm(confirmOptions)) {
      log(currentOptions.cancelLog || ("用户取消了批量" + actionLabel + "。"));
      notify(currentOptions.cancelToast || ("已取消批量" + actionLabel + "。"), "info");
      return null;
    }

    startPending(pendingType, pendingKey);
    setBusy(true);
    setTaskProgress(progressId, progressLabel, 8, {
      done: 0,
      total: targetList.length
    });

    try {
      log(currentOptions.startLog || ("开始批量" + actionLabel + "文件，共 " + targetList.length + " 个。"));
      result = await sequenceSetDisabled(targetList, disabled, sequenceLabel, progressId);
      log((currentOptions.completeLogPrefix || ("批量" + actionLabel + "完成")) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。");
      notify((currentOptions.completeToastPrefix || ("批量" + actionLabel + "完成")) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。", result.fail ? "warn" : "success", 3200);
      clearSelectionKeys(targetList.map(function (item) {
        return item.key;
      }));
      setTaskProgress(progressId, currentOptions.reloadProgressText || "操作完成，正在同步文件状态…", 100, {
        done: targetList.length,
        total: targetList.length
      });
      await reload({
        silentToast: true,
        progressTaskId: progressId
      });
      completeTaskProgress(progressId, "批量" + actionLabel + "完成。", {
        tone: result.fail ? "warn" : "success",
        done: targetList.length,
        total: targetList.length,
        hideDelayMs: result.fail ? 2200 : 1400
      });
      return result;
    } catch (error) {
      completeTaskProgress(progressId, "批量" + actionLabel + "失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      throw error;
    } finally {
      setBusy(false);
      finishPending(pendingType, pendingKey);
    }
  }

  async function refreshOne(key, options) {
    var currentOptions = options || {};
    var item = state.items.filter(function (current) {
      return current.key === key;
    })[0];
    var nextItem = null;
    var progressId = resolveProgressTaskId(currentOptions, "row-refresh", key);

    if (!item || !item.authIndex || !item.accountId) {
      return null;
    }

    startPending("row-refresh", key);
    if (currentOptions.manageBusy !== false) {
      setBusy(true);
    }
    setTaskProgress(progressId, currentOptions.progressLabel || ("正在刷新额度… " + (item.name || item.email || "文件")), currentOptions.progressPercent == null ? 18 : currentOptions.progressPercent);
    updateItem(key, function (current) {
      return Object.assign({}, current, {
        quotaStatus: "loading",
        quotaError: "",
        reason: currentOptions.loadingReason || "正在单独刷新额度..."
      });
    });

    try {
      var result = await api.quotaRequest(item);
      updateItem(key, function (current) {
        nextItem = enrichItem(current, result, currentClassifierOptions());
        return nextItem;
      });
      persistCurrentSnapshot();
      if (!currentOptions.silentLog) {
        log(currentOptions.successLog || ("单文件刷新完成：" + item.name));
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.successToast || ("已刷新 " + (item.name || item.email || "文件") + " 的额度状态。"), "success");
      }
      completeTaskProgress(progressId, currentOptions.finalProgressLabel || "额度刷新完成。", {
        tone: "success"
      });
      return nextItem;
    } catch (error) {
      updateItem(key, function (current) {
        nextItem = enrichError(current, {
          message: error.message || "额度获取失败"
        });
        return nextItem;
      });
      if (!currentOptions.silentLog) {
        log(currentOptions.errorLog || ("单文件刷新失败：" + item.name + " · " + (error.message || "额度获取失败")), true);
      }
      if (!currentOptions.silentToast) {
        notify(currentOptions.errorToast || ("刷新失败：" + (item.name || item.email || "文件")), "danger", 3200);
      }
      completeTaskProgress(progressId, currentOptions.errorProgressLabel || "额度刷新失败。", {
        tone: "danger",
        hideDelayMs: 2200
      });
      return nextItem;
    } finally {
      if (currentOptions.manageBusy !== false) {
        setBusy(false);
      }
      finishPending("row-refresh", key);
    }
  }

  async function refreshCredentialOne(key, options) {
    var currentOptions = options || {};
    var item = findItemByKey(key);
    var result;
    var resultMessage;
    var progressId = resolveProgressTaskId(currentOptions, "row-refresh-credential", key);

    if (!item || !item.name) {
      return null;
    }

    startPending("row-refresh-credential", key);
    if (currentOptions.manageBusy !== false) {
      setBusy(true);
    }

    try {
      setTaskProgress(progressId, currentOptions.progressLabel || "正在执行认证续期…", currentOptions.progressPercent == null ? 8 : currentOptions.progressPercent);
      if (!currentOptions.silentLog) {
        log(currentOptions.startLog || ("开始认证续期：" + item.name));
      }

      result = await executeCredentialRefresh(item);
      resultMessage = actionMessageText(result && result.message, "认证续期失败");

      if (result && result.success === true) {
        applyCredentialTimeline(key, result);
        if (!currentOptions.silentLog) {
          log("认证续期成功：" + item.name + " · " + resultMessage);
        }
        if (!currentOptions.silentToast) {
          notify("认证续期成功：" + item.name, "success", 3200);
        }
        completeTaskProgress(progressId, currentOptions.finalProgressLabel || "认证续期完成。", {
          tone: "success"
        });
        return result;
      }

      if (!currentOptions.silentLog) {
        log("认证续期失败：" + item.name + " · " + resultMessage, true);
      }
      if (!currentOptions.silentToast) {
        notify("认证续期失败：" + item.name + "\n" + resultMessage, "danger", 6200);
      }
      completeTaskProgress(progressId, currentOptions.finalFailedProgressLabel || "认证续期失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      return Object.assign({}, result || {}, {
        success: false,
        message: resultMessage
      });
    } finally {
      if (currentOptions.manageBusy !== false) {
        setBusy(false);
      }
      finishPending("row-refresh-credential", key);
    }
  }

  async function executeReviveAttempt(item, options) {
    var currentOptions = options || {};
    var currentItem = item && item.key ? (findItemByKey(item.key) || item) : item;
    var result;
    var refreshedItem;
    var verificationMessage;
    var progressId = resolveProgressTaskId(currentOptions, "row-revive", currentItem && currentItem.key ? currentItem.key : "");

    if (!currentItem || !currentItem.name) {
      return null;
    }
    if (currentItem.runtimeOnly) {
      verificationMessage = "运行时账号不支持尝试复活。";
      log("当前文件为运行时账号，不支持尝试复活：" + currentItem.name, true);
      if (!currentOptions.silentToast) {
        notify(verificationMessage, "info");
      }
      return {
        success: false,
        reason: "revive_skipped_runtime_only",
        message: verificationMessage
      };
    }

    startPending("row-revive", currentItem.key);
    if (currentOptions.manageBusy !== false) {
      setBusy(true);
    }

    try {
      setTaskProgress(progressId, currentOptions.progressLabel || "正在尝试复活 401 文件…", currentOptions.progressPercent == null ? 8 : currentOptions.progressPercent);
      if (!currentOptions.silentLog) {
        log(currentOptions.startLog || ("开始尝试复活 401 文件：" + currentItem.name));
      }
      result = await api.reviveAuthFile(currentItem);

      if (!result || result.success !== true) {
        verificationMessage = actionMessageText(result && result.message, "尝试复活失败");
        if (!currentOptions.silentLog) {
          log("尝试复活失败：" + currentItem.name + " · " + verificationMessage, true);
        }
        if (!currentOptions.silentToast) {
          notify("尝试复活失败：" + currentItem.name + "\n" + verificationMessage, "danger", 6200);
        }
        completeTaskProgress(progressId, currentOptions.finalFailedProgressLabel || "尝试复活失败。", {
          tone: "danger",
          hideDelayMs: 2400
        });
        return Object.assign({}, result || {}, {
          success: false,
          message: verificationMessage
        });
      }

      if (!currentItem.authIndex || !currentItem.accountId) {
        if (currentOptions.missingFieldProgressLabel) {
          setTaskProgress(progressId, currentOptions.missingFieldProgressLabel, currentOptions.missingFieldProgressPercent == null ? 84 : currentOptions.missingFieldProgressPercent);
        }
        await reload({
          silentToast: true,
          progressTaskId: progressId
        });
        verificationMessage = "凭证已回写，但当前文件缺少 authIndex/accountId，无法自动完成二次校验。";
        if (!currentOptions.silentLog) {
          log("尝试复活已回写：" + currentItem.name + " · " + verificationMessage);
        }
        if (!currentOptions.silentToast) {
          notify("尝试复活已回写，但当前无法自动二次校验。", "warn", 3600);
        }
        completeTaskProgress(progressId, currentOptions.finalProgressLabel || "尝试复活已回写。", {
          tone: "warn",
          hideDelayMs: 2200
        });
        return Object.assign({}, result, {
          success: false,
          reason: "revive_missing_second_check_fields",
          message: verificationMessage
        });
      }

      applyCredentialTimeline(currentItem.key, result);

      if (currentOptions.secondCheckProgressLabel) {
        setTaskProgress(progressId, currentOptions.secondCheckProgressLabel, currentOptions.secondCheckProgressPercent == null ? 72 : currentOptions.secondCheckProgressPercent);
      }
      await waitMilliseconds(result.waitMs || 3000);
      refreshedItem = await refreshOne(currentItem.key, {
        silentToast: true,
        silentLog: true,
        loadingReason: currentOptions.secondCheckLoadingReason || "正在执行复活后的二次校验...",
        manageBusy: false,
        progressTaskId: progressId
      });

      if (reviveSecondCheckPassed(refreshedItem)) {
        verificationMessage = reviveSuccessMessage(refreshedItem);
        if (!currentOptions.silentLog) {
          log("尝试复活成功：" + currentItem.name + " · " + verificationMessage);
        }
        if (!currentOptions.silentToast) {
          notify("尝试复活成功：" + currentItem.name, "success", 3200);
        }
        completeTaskProgress(progressId, currentOptions.finalProgressLabel || "尝试复活完成。", {
          tone: "success"
        });
        return Object.assign({}, result, {
          verified: true,
          message: verificationMessage,
          item: refreshedItem
        });
      }

      verificationMessage = reviveFailureMessage(refreshedItem, "复活后的二次校验仍未通过。");
      if (!currentOptions.silentLog) {
        log("尝试复活后仍未恢复：" + currentItem.name + " · " + verificationMessage, true);
      }
      if (!currentOptions.silentToast) {
        notify("尝试复活后仍未恢复：" + currentItem.name + "\n" + verificationMessage, "warn", 6200);
      }
      completeTaskProgress(progressId, currentOptions.finalFailedProgressLabel || "尝试复活已完成，但二次校验仍异常。", {
        tone: "warn",
        hideDelayMs: 2200
      });
      return Object.assign({}, result, {
        success: false,
        verified: false,
        reason: "revive_second_check_failed",
        message: verificationMessage,
        item: refreshedItem
      });
    } catch (error) {
      verificationMessage = error && error.message ? error.message : "未知错误";
      if (!currentOptions.silentLog) {
        log("尝试复活失败：" + currentItem.name + " · " + verificationMessage, true);
      }
      if (!currentOptions.silentToast) {
        notify("尝试复活失败：" + currentItem.name + "\n" + verificationMessage, "danger", 6200);
      }
      completeTaskProgress(progressId, "尝试复活失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      return {
        success: false,
        reason: "revive_request_failed",
        message: verificationMessage
      };
    } finally {
      if (currentOptions.manageBusy !== false) {
        setBusy(false);
      }
      finishPending("row-revive", currentItem.key);
    }
  }

  async function revive401Item(item) {
    if (!item || !item.name) {
      return null;
    }

    if (!await askConfirm({
      title: "确认尝试复活 401 文件",
      message: "将使用原始 JSON 中的 refresh_token 尝试刷新凭证，并在回写后自动做一次二次校验。",
      items: [item.name],
      listTitle: "本次尝试复活文件",
      note: "若原始 JSON 中缺少 refresh_token，或 OAuth 刷新失败，则只会返回失败结果，不会自动删除文件。",
      confirmText: "确认复活",
      cancelText: "取消",
      tone: "warn"
    })) {
      log("用户取消了尝试复活：" + item.name);
      notify("已取消尝试复活。", "info");
      return null;
    }

    return executeReviveAttempt(item, {
      manageBusy: true,
      progressLabel: "正在准备尝试复活 401 文件…",
      progressPercent: 8,
      missingFieldProgressLabel: "凭证回写完成，正在同步文件列表…",
      missingFieldProgressPercent: 84,
      secondCheckProgressLabel: "凭证回写成功，等待二次校验…",
      secondCheckProgressPercent: 72,
      finalProgressLabel: "尝试复活完成，当前状态已更新。",
      finalFailedProgressLabel: "尝试复活已完成，但二次校验仍异常。"
    });
  }

  async function reviveSelected401() {
    var selectedList = state.items.filter(function (item) {
      return state.selected[item.key];
    });
    var targetList = revivable401Items(selectedList);
    var index;
    var currentItem;
    var result;
    var successCount = 0;
    var failureCount = 0;
    var latestMessage = "";
    var failureDetails = [];
    var resultDetails = [];
    var progressId = progressTaskId("revive-selected", "batch");
    var selectionCleared = false;

    if (!targetList.length) {
      log("当前没有可批量尝试复活的 401 文件。");
      notify("当前没有可批量尝试复活的 401 文件。", "info");
      return null;
    }

    if (!await askConfirm({
      title: "确认批量尝试复活 401 文件",
      message: "将依次使用选中文件里的 refresh_token 尝试复活，并在每个文件回写后自动做一次二次校验。",
      items: targetList.map(function (item) { return item.name; }),
      listTitle: "本次批量尝试复活文件",
      note: "批量执行期间会弹出进度窗口，显示当前操作文件、进度位置和成功/失败计数。",
      confirmText: "确认批量复活",
      cancelText: "取消",
      tone: "warn"
    })) {
      log("用户取消了批量尝试复活。");
      notify("已取消批量尝试复活。", "info");
      return null;
    }

    startPending("revive-selected");
    setBusy(true);
    closeOperationDialog(true);
    showOperationDialog({
      title: "批量尝试复活",
      stage: "正在准备批量尝试复活 401 文件…",
      currentName: targetList[0] ? targetList[0].name : "",
      currentIndex: 0,
      total: targetList.length,
      percent: 0,
      successCount: 0,
      failureCount: 0,
      latestMessage: "批量任务启动后，会逐个执行复活与二次校验。",
      failureDetails: [],
      resultDetails: [],
      canClose: false,
      completed: false
    });
    setTaskProgress(progressId, "正在准备批量尝试复活 401 文件…", 8, {
      done: 0,
      total: targetList.length
    });

    try {
      log("开始批量尝试复活 401 文件，共 " + targetList.length + " 个。");

      for (index = 0; index < targetList.length; index += 1) {
        currentItem = findItemByKey(targetList[index].key) || targetList[index];
        latestMessage = "正在处理 " + (index + 1) + "/" + targetList.length + " · " + currentItem.name;
        updateOperationDialog({
          stage: "正在执行第 " + (index + 1) + " 个文件的复活与二次校验…",
          currentName: currentItem.name,
          currentIndex: index + 1,
          total: targetList.length,
          percent: computeProgressPercent(index, targetList.length),
          successCount: successCount,
          failureCount: failureCount,
          latestMessage: latestMessage,
          canClose: false,
          completed: false
        });
        setTaskProgress(progressId, "正在批量尝试复活… " + (index + 1) + "/" + targetList.length + " · " + currentItem.name, computeProgressPercent(index, targetList.length), {
          done: index,
          total: targetList.length
        });
        result = await executeReviveAttempt(currentItem, {
          manageBusy: false,
          silentToast: true,
          progressLabel: "正在刷新并回写认证凭证…",
          progressPercent: computeProgressPercent(index, targetList.length),
          missingFieldProgressLabel: "凭证回写完成，正在同步文件列表…",
          missingFieldProgressPercent: computeProgressPercent(index + 1, targetList.length),
          secondCheckProgressLabel: "凭证回写成功，等待二次校验…",
          secondCheckProgressPercent: computeProgressPercent(index + 1, targetList.length),
          secondCheckLoadingReason: "正在执行批量复活后的二次校验...",
          progressTaskId: progressId
        });

        if (result && result.success === true) {
          successCount += 1;
          latestMessage = currentItem.name + " 已复活成功";
          resultDetails = appendResultDetail(resultDetails, currentItem, result, true, result && result.message);
        } else {
          failureCount += 1;
          latestMessage = currentItem.name + " 失败：" + reviveDialogMessage(result, "尝试复活失败");
          failureDetails = appendFailureDetail(failureDetails, currentItem, result && result.message);
          resultDetails = appendResultDetail(resultDetails, currentItem, result, false, result && result.message);
        }

        updateOperationDialog({
          currentName: currentItem.name,
          currentIndex: index + 1,
          total: targetList.length,
          percent: computeProgressPercent(index + 1, targetList.length),
          successCount: successCount,
          failureCount: failureCount,
          latestMessage: latestMessage,
          failureDetails: failureDetails,
          resultDetails: resultDetails
        });
      }

      clearSelectionKeys(targetList.map(function (item) {
        return item.key;
      }));
      selectionCleared = true;
      setTaskProgress(progressId, "批量复活完成，正在同步文件状态…", 100, {
        done: targetList.length,
        total: targetList.length
      });
      await reload({
        silentToast: true,
        progressTaskId: progressId
      });
      updateOperationDialog({
        stage: failureCount ? "批量尝试复活已完成，部分文件仍未恢复。" : "批量尝试复活已全部完成。",
        currentName: targetList[targetList.length - 1] ? targetList[targetList.length - 1].name : "",
        currentIndex: targetList.length,
        total: targetList.length,
        percent: 100,
        successCount: successCount,
        failureCount: failureCount,
        latestMessage: "批量尝试复活完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。",
        failureDetails: failureDetails,
        resultDetails: resultDetails,
        canClose: true,
        completed: true
      });
      log("批量尝试复活完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。");
      notify("批量尝试复活完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。", failureCount ? "warn" : "success", 4200);
      completeTaskProgress(progressId, "批量尝试复活完成。", {
        tone: failureCount ? "warn" : "success",
        done: targetList.length,
        total: targetList.length,
        hideDelayMs: failureCount ? 2200 : 1400
      });
      return {
        ok: successCount,
        fail: failureCount
      };
    } catch (error) {
      latestMessage = error && error.message ? error.message : "批量尝试复活中断";
      updateOperationDialog({
        stage: "批量尝试复活中断，请查看底部动态日志。",
        percent: 100,
        successCount: successCount,
        failureCount: failureCount,
        latestMessage: latestMessage,
        failureDetails: failureDetails,
        resultDetails: resultDetails,
        canClose: true,
        completed: true
      });
      log("批量尝试复活中断：" + latestMessage, true);
      notify("批量尝试复活中断。\n" + latestMessage, "danger", 6200);
      completeTaskProgress(progressId, "批量尝试复活中断。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      return null;
    } finally {
      if (!selectionCleared) {
        clearSelectionKeys(targetList.map(function (item) {
          return item.key;
        }));
      }
      setBusy(false);
      finishPending("revive-selected");
    }
  }

  async function refreshSelectedCredentials() {
    var selectedList = state.items.filter(function (item) {
      return state.selected[item.key];
    });
    var targetList = credentialRefreshableItems(selectedList);
    var refreshOptions = currentTokenRefreshOptions();
    var progressId = progressTaskId("refresh-credentials-selected", "batch");
    var activeMap = {};
    var total;
    var done = 0;
    var cursor = 0;
    var successCount = 0;
    var failureCount = 0;
    var latestMessage = "";
    var failureDetails = [];
    var resultDetails = [];
    var selectionCleared = false;

    if (!targetList.length) {
      log("当前没有可批量执行认证续期的文件。");
      notify("当前没有可批量执行认证续期的文件。", "info");
      return null;
    }

    if (!await askConfirm({
      title: "确认批量认证续期",
      message: "将使用选中文件中的 refresh_token 主动执行 OAuth 认证续期，并把新 token 覆盖回原始文件。",
      items: targetList.map(function (item) { return item.name; }),
      listTitle: "本次批量认证续期文件",
      note: "该操作专注于 refresh_token 轮换与回写，不会额外做额度校验。并发数和间隔可在系统设置里调整。",
      confirmText: "确认续期",
      cancelText: "取消",
      tone: "warn"
    })) {
      log("用户取消了批量认证续期。");
      notify("已取消批量认证续期。", "info");
      return null;
    }

    total = targetList.length;
    startPending("refresh-credentials-selected");
    setBusy(true);
    closeOperationDialog(true);
    showOperationDialog({
      title: "批量认证续期",
      stage: "正在准备批量认证续期…",
      currentName: targetList[0] ? targetList[0].name : "",
      activeNames: [],
      currentIndex: 0,
      total: total,
      percent: 0,
      successCount: 0,
      failureCount: 0,
      successLabel: "认证续期成功",
      failureLabel: "认证续期失败",
      concurrency: refreshOptions.concurrency,
      intervalSeconds: refreshOptions.intervalSeconds,
      latestMessage: "任务启动后会按配置并发刷新 refresh_token，并在结束后统一同步文件状态。",
      failureDetails: [],
      resultDetails: [],
      canClose: false,
      completed: false
    });
    setTaskProgress(progressId, "正在准备批量认证续期…", 8, {
      done: 0,
      total: total
    });

    // 这里沿用额度刷新同款 worker 池语义：固定并发槽循环取任务，每个并发槽完成一次后再按配置等待间隔。
    async function worker() {
      var item;
      var currentItem;
      var result;
      var resultMessage;

      if (cursor >= total) {
        return;
      }

      item = targetList[cursor];
      cursor += 1;
      currentItem = findItemByKey(item.key) || item;
      activeMap[currentItem.key] = currentItem.name;
      latestMessage = "已启动认证续期：" + currentItem.name;
      updateOperationDialog({
        stage: "正在批量认证续期…",
        currentName: currentItem.name,
        activeNames: activeDialogNames(activeMap),
        currentIndex: done,
        total: total,
        percent: computeProgressPercent(done, total),
        successCount: successCount,
        failureCount: failureCount,
        latestMessage: latestMessage,
        canClose: false,
        completed: false
      });
      setTaskProgress(progressId, "正在批量认证续期… 已完成 " + done + "/" + total + " · 当前 " + currentItem.name, computeProgressPercent(done, total), {
        done: done,
        total: total
      });

      result = await executeCredentialRefresh(currentItem);
      resultMessage = actionMessageText(result && result.message, "认证续期失败");

      if (result && result.success === true) {
        applyCredentialTimeline(currentItem.key, result);
        successCount += 1;
        latestMessage = currentItem.name + " 认证续期成功";
        resultDetails = appendResultDetail(resultDetails, currentItem, result, true, resultMessage);
        log("认证续期成功：" + currentItem.name + " · " + resultMessage);
      } else {
        failureCount += 1;
        latestMessage = currentItem.name + " 失败：" + resultMessage;
        failureDetails = appendFailureDetail(failureDetails, currentItem, resultMessage);
        resultDetails = appendResultDetail(resultDetails, currentItem, result, false, resultMessage);
        log("认证续期失败：" + currentItem.name + " · " + resultMessage, true);
      }

      done += 1;
      delete activeMap[currentItem.key];
      updateOperationDialog({
        currentName: currentItem.name,
        activeNames: activeDialogNames(activeMap),
        currentIndex: done,
        total: total,
        percent: computeProgressPercent(done, total),
        successCount: successCount,
        failureCount: failureCount,
        latestMessage: latestMessage,
        failureDetails: failureDetails,
        resultDetails: resultDetails
      });

      if (refreshOptions.intervalSeconds > 0 && cursor < total) {
        await waitMilliseconds(refreshOptions.intervalSeconds * 1000);
      }

      return worker();
    }

    try {
      log("开始批量认证续期，共 " + total + " 个，并发 " + refreshOptions.concurrency + "，间隔 " + refreshOptions.intervalSeconds + " 秒。");
      await Promise.all(Array.from({ length: Math.min(refreshOptions.concurrency, total) }, function () {
        return worker();
      }));
      clearSelectionKeys(targetList.map(function (item) {
        return item.key;
      }));
      selectionCleared = true;
      setTaskProgress(progressId, "批量认证续期完成，正在同步文件状态…", 100, {
        done: total,
        total: total
      });
      await reload({
        silentToast: true,
        progressTaskId: progressId
      });
      updateOperationDialog({
        stage: failureCount ? "批量认证续期已完成，部分文件续期失败。" : "批量认证续期已全部完成。",
        activeNames: [],
        currentName: targetList[targetList.length - 1] ? targetList[targetList.length - 1].name : "",
        currentIndex: total,
        total: total,
        percent: 100,
        successCount: successCount,
        failureCount: failureCount,
        latestMessage: "批量认证续期完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。",
        failureDetails: failureDetails,
        resultDetails: resultDetails,
        canClose: true,
        completed: true
      });
      notify("批量认证续期完成：成功 " + successCount + " 个，失败 " + failureCount + " 个。", failureCount ? "warn" : "success", 4200);
      completeTaskProgress(progressId, "批量认证续期完成。", {
        tone: failureCount ? "warn" : "success",
        done: total,
        total: total,
        hideDelayMs: failureCount ? 2200 : 1400
      });
      return {
        ok: successCount,
        fail: failureCount
      };
    } catch (error) {
      latestMessage = error && error.message ? error.message : "批量认证续期中断";
      updateOperationDialog({
        stage: "批量认证续期中断，请查看底部动态日志。",
        activeNames: [],
        currentIndex: done,
        total: total,
        percent: 100,
        successCount: successCount,
        failureCount: failureCount,
        latestMessage: latestMessage,
        failureDetails: failureDetails,
        resultDetails: resultDetails,
        canClose: true,
        completed: true
      });
      log("批量认证续期中断：" + latestMessage, true);
      notify("批量认证续期中断。\n" + latestMessage, "danger", 6200);
      completeTaskProgress(progressId, "批量认证续期中断。", {
        tone: "danger",
        done: done,
        total: total,
        hideDelayMs: 2400
      });
      return null;
    } finally {
      if (!selectionCleared) {
        clearSelectionKeys(targetList.map(function (item) {
          return item.key;
        }));
      }
      setBusy(false);
      finishPending("refresh-credentials-selected");
    }
  }

  async function disableQuotaRelated() {
    var list = manageableItems().filter(function (item) {
      return item.badReasonGroup === "quota" && !item.disabled;
    });

    if (!list.length) {
      log("当前没有可停用的额度相关异常文件。");
      notify("当前没有可停用的额度相关异常文件。", "info");
      return;
    }

    await setItemsDisabled(list, true, {
      confirmTitle: "确认批量停用额度异常",
      confirmMessage: "即将停用识别为额度相关异常的文件。",
      confirmListTitle: "本次停用的额度异常文件",
      confirmNote: "停用后可在停用池继续观察，额度恢复后再启用会更稳妥。",
      confirmText: "确认停用",
      pendingType: "disable-quota",
      progressLabel: "正在准备停用额度相关异常文件…",
      sequenceLabel: "正在停用额度相关异常文件",
      startLog: "开始批量停用额度相关异常，共 " + list.length + " 个。",
      completeToastPrefix: "批量停用完成",
      completeLogPrefix: "批量停用完成",
      cancelLog: "用户取消了一键停用额度异常。",
      cancelToast: "已取消批量停用额度异常。",
      emptyLog: "当前没有可停用的额度相关异常文件。",
      emptyToast: "当前没有可停用的额度相关异常文件。"
    });
  }

  async function deleteSelected() {
    var list = state.items.filter(function (item) {
      return state.selected[item.key] && !item.runtimeOnly;
    });

    if (!list.length) {
      log("没有可删除的选中项。");
      notify("当前没有可删除的选中项。", "info");
      return;
    }

    await deleteItems(list, {
      confirmTitle: "确认删除选中文件",
      confirmMessage: "确认删除已选中的 " + list.length + " 个文件吗？\n\n该操作不可恢复。",
      confirmText: "确认删除",
      pendingType: "delete-selected",
      progressLabel: "正在准备删除选中文件…",
      sequenceLabel: "正在删除选中文件",
      startLog: "开始批量删除选中文件，共 " + list.length + " 个。",
      completeText: "选中删除完成",
      cancelLog: "用户取消了批量删除。",
      cancelToast: "已取消批量删除。",
      emptyLog: "没有可删除的选中项。",
      emptyToast: "当前没有可删除的选中项。"
    });
  }

  async function enableSelected() {
    var list = manageableItems().filter(function (item) {
      return state.selected[item.key] && item.disabled;
    });

    if (!list.length) {
      log("没有可启用的选中项。");
      notify("当前没有可启用的选中项。", "info");
      return;
    }

    await setItemsDisabled(list, false, {
      confirmTitle: "确认批量启用文件",
      confirmMessage: "确认启用已选中的 " + list.length + " 个 disabled 文件吗？\n\n建议先确保额度或认证状态已经恢复。",
      confirmText: "确认启用",
      pendingType: "enable-selected",
      progressLabel: "正在准备启用选中项…",
      sequenceLabel: "正在启用选中项",
      startLog: "开始批量启用选中项，共 " + list.length + " 个。",
      completeToastPrefix: "批量启用完成",
      completeLogPrefix: "批量启用完成",
      cancelLog: "用户取消了批量启用。",
      cancelToast: "已取消批量启用。",
      emptyLog: "没有可启用的选中项。",
      emptyToast: "当前没有可启用的选中项。"
    });
  }

  async function disableSelected() {
    var list = manageableItems().filter(function (item) {
      return state.selected[item.key] && !item.disabled;
    });

    if (!list.length) {
      log("没有可停用的选中项。");
      notify("当前没有可停用的选中项。", "info");
      return;
    }

    await setItemsDisabled(list, true, {
      confirmTitle: "确认批量停用文件",
      confirmMessage: "确认停用已选中的 " + list.length + " 个文件吗？\n\n停用后文件会进入已停用池。",
      confirmText: "确认停用",
      pendingType: "disable-selected",
      progressLabel: "正在准备停用选中项…",
      sequenceLabel: "正在停用选中项",
      startLog: "开始批量停用选中项，共 " + list.length + " 个。",
      completeToastPrefix: "批量停用完成",
      completeLogPrefix: "批量停用完成",
      cancelLog: "用户取消了批量停用。",
      cancelToast: "已取消批量停用。",
      emptyLog: "没有可停用的选中项。",
      emptyToast: "当前没有可停用的选中项。"
    });
  }

  function openUploadPicker() {
    if (!uploadInputRef.value) {
      return;
    }
    uploadInputRef.value.value = "";
    uploadInputRef.value.click();
  }

  async function handleUploadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      return file && /\.json$/i.test(file.name);
    });
    var index;
    var progressId = progressTaskId("upload", "batch");

    if (!files.length) {
      log("没有可上传的 json 认证文件。", true);
      notify("没有可上传的 JSON 文件。", "info");
      return;
    }

    startPending("upload");
    setBusy(true);
    setTaskProgress(progressId, "正在准备上传认证文件…", 8, {
      done: 0,
      total: files.length
    });

    try {
      log("开始批量上传认证文件，共 " + files.length + " 个。");
      for (index = 0; index < files.length; index += 1) {
        var file = files[index];
        setTaskProgress(progressId, "正在上传认证文件… " + (index + 1) + "/" + files.length + " · " + file.name, computeProgressPercent(index + 1, files.length), {
          done: index + 1,
          total: files.length
        });
        try {
          await api.uploadAuthFile(file);
          log("上传成功：" + file.name);
        } catch (error) {
          log("上传失败：" + file.name + " · " + error.message, true);
        }
      }
      setTaskProgress(progressId, "上传完成，正在同步文件状态…", 100, {
        done: files.length,
        total: files.length
      });
      notify("上传流程完成，正在同步最新文件状态。", "success");
      await reload({
        silentToast: true,
        progressTaskId: progressId
      });
      completeTaskProgress(progressId, "上传完成。", {
        tone: "success",
        done: files.length,
        total: files.length
      });
    } catch (error) {
      completeTaskProgress(progressId, "上传流程失败。", {
        tone: "danger",
        hideDelayMs: 2400
      });
      throw error;
    } finally {
      setBusy(false);
      finishPending("upload");
    }
  }

  function handleUploadChange(event) {
    var files = event && event.target ? event.target.files : null;
    if (files && files.length) {
      handleUploadFiles(files);
    }
  }

  async function copyName(name) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      log("当前环境不支持剪贴板复制。", true);
      notify("当前环境不支持剪贴板复制。", "danger");
      return;
    }
    try {
      await navigator.clipboard.writeText(name);
      log("已复制文件名：" + name);
      notify("已复制文件名：" + name, "success");
    } catch (_) {
      log("复制失败，请手动复制：" + name, true);
      notify("复制失败，请手动复制。", "danger");
    }
  }

  async function setFileDisabled(item, disabled) {
    var actionLabel = disabled ? "停用" : "启用";
    if (!item || !item.name) {
      return;
    }
    await setItemsDisabled([item], disabled, {
      confirmTitle: "确认" + actionLabel + "文件",
      confirmMessage: "确认" + actionLabel + " " + item.name + " 吗？\n\n" + (disabled ? "停用后文件会移入已停用列表。" : "启用后文件会重新回到对应工作台。"),
      confirmText: "确认" + actionLabel,
      pendingType: "row-toggle-disabled",
      pendingKey: item.key,
      progressLabel: "正在准备" + actionLabel + "认证文件…",
      sequenceLabel: "正在" + actionLabel + "认证文件",
      startLog: "开始" + actionLabel + "文件：" + item.name,
      completeToastPrefix: actionLabel + "完成",
      completeLogPrefix: actionLabel + "完成",
      cancelToast: "已取消" + actionLabel + "操作。",
      emptyLog: "当前没有可" + actionLabel + "的文件。",
      emptyToast: "当前没有可" + actionLabel + "的文件。"
    });
  }

  async function deleteFile(item) {
    if (!item || !item.name) {
      return;
    }
    await deleteItems([item], {
      confirmTitle: "确认删除文件",
      confirmMessage: "确认删除 " + item.name + " 吗？\n\n该操作不可恢复。",
      confirmText: "确认删除",
      pendingType: "row-delete",
      pendingKey: item.key,
      progressLabel: "正在准备删除认证文件…",
      sequenceLabel: "正在删除认证文件",
      startLog: "开始删除文件：" + item.name,
      completeText: "删除完成",
      cancelToast: "已取消删除操作。",
      emptyLog: "当前没有可删除的文件。",
      emptyToast: "当前没有可删除的文件。"
    });
  }

  return {
    deleteItems: deleteItems,
    setItemsDisabled: setItemsDisabled,
    refreshOne: refreshOne,
    disableQuotaRelated: disableQuotaRelated,
    deleteSelected: deleteSelected,
    disableSelected: disableSelected,
    enableSelected: enableSelected,
    revive401Item: revive401Item,
    reviveSelected401: reviveSelected401,
    refreshCredentialOne: refreshCredentialOne,
    refreshSelectedCredentials: refreshSelectedCredentials,
    openUploadPicker: openUploadPicker,
    handleUploadFiles: handleUploadFiles,
    handleUploadChange: handleUploadChange,
    copyName: copyName,
    setFileDisabled: setFileDisabled,
    deleteFile: deleteFile
  };
}
