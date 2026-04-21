import { enrichError, enrichItem } from "../lib/auth-file-state.js";

// 文件级动作统一放在这里，主 composable 只保留数据流和派生状态。
export function useConsoleFileActions(context) {
  var api = context.api;
  var state = context.state;
  var uploadInputRef = context.uploadInputRef;
  var currentClassifierOptions = context.currentClassifierOptions;
  var persistCurrentSnapshot = context.persistCurrentSnapshot;
  var updateItem = context.updateItem;
  var reload = context.reload;
  var setBusy = context.setBusy;
  var setProgress = context.setProgress;
  var computeProgressPercent = context.computeProgressPercent;
  var notify = context.notify;
  var log = context.log;
  var askConfirm = context.askConfirm;
  var startPending = context.startPending;
  var finishPending = context.finishPending;

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

  async function sequenceDelete(list, actionLabel) {
    var result = { ok: 0, fail: 0 };
    var index;

    for (index = 0; index < list.length; index += 1) {
      var item = list[index];
      setProgress((actionLabel || "正在删除文件") + "… " + (index + 1) + "/" + list.length + " · " + item.name, computeProgressPercent(index + 1, list.length));
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

  async function sequenceSetDisabled(list, disabled, actionLabel) {
    var result = { ok: 0, fail: 0 };
    var index;

    for (index = 0; index < list.length; index += 1) {
      var item = list[index];
      setProgress((actionLabel || (disabled ? "正在停用文件" : "正在启用文件")) + "… " + (index + 1) + "/" + list.length + " · " + item.name, computeProgressPercent(index + 1, list.length));
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
    setProgress(progressLabel, 8);

    try {
      log(startLog);
      result = await sequenceDelete(targetList, sequenceLabel);
      log((currentOptions.completeLogPrefix || completeText) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。");
      notify((currentOptions.completeToastPrefix || completeText) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。", result.fail ? "warn" : "success", 3200);
      setProgress((currentOptions.reloadProgressText || "操作完成，正在同步文件状态…"), 100);
      await reload({ silentToast: true });
      return result;
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
    setProgress(progressLabel, 8);

    try {
      log(currentOptions.startLog || ("开始批量" + actionLabel + "文件，共 " + targetList.length + " 个。"));
      result = await sequenceSetDisabled(targetList, disabled, sequenceLabel);
      log((currentOptions.completeLogPrefix || ("批量" + actionLabel + "完成")) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。");
      notify((currentOptions.completeToastPrefix || ("批量" + actionLabel + "完成")) + "：成功 " + result.ok + " 个，失败 " + result.fail + " 个。", result.fail ? "warn" : "success", 3200);
      setProgress((currentOptions.reloadProgressText || "操作完成，正在同步文件状态…"), 100);
      await reload({ silentToast: true });
      return result;
    } finally {
      setBusy(false);
      finishPending(pendingType, pendingKey);
    }
  }

  async function refreshOne(key) {
    var item = state.items.filter(function (current) {
      return current.key === key;
    })[0];

    if (!item || !item.authIndex || !item.accountId) {
      return;
    }

    startPending("row-refresh", key);
    updateItem(key, function (current) {
      return Object.assign({}, current, {
        quotaStatus: "loading",
        quotaError: "",
        reason: "正在单独刷新额度..."
      });
    });

    try {
      var result = await api.quotaRequest(item);
      updateItem(key, function (current) {
        return enrichItem(current, result, currentClassifierOptions());
      });
      persistCurrentSnapshot();
      log("单文件刷新完成：" + item.name);
      notify("已刷新 " + (item.name || item.email || "文件") + " 的额度状态。", "success");
    } catch (error) {
      updateItem(key, function (current) {
        return enrichError(current, {
          message: error.message || "额度获取失败"
        });
      });
      log("单文件刷新失败：" + item.name + " · " + (error.message || "额度获取失败"), true);
      notify("刷新失败：" + (item.name || item.email || "文件"), "danger", 3200);
    } finally {
      finishPending("row-refresh", key);
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

    if (!files.length) {
      log("没有可上传的 json 认证文件。", true);
      notify("没有可上传的 JSON 文件。", "info");
      return;
    }

    startPending("upload");
    setBusy(true);
    setProgress("正在准备上传认证文件…", 8);

    try {
      log("开始批量上传认证文件，共 " + files.length + " 个。");
      for (index = 0; index < files.length; index += 1) {
        var file = files[index];
        setProgress("正在上传认证文件… " + (index + 1) + "/" + files.length + " · " + file.name, computeProgressPercent(index + 1, files.length));
        try {
          await api.uploadAuthFile(file);
          log("上传成功：" + file.name);
        } catch (error) {
          log("上传失败：" + file.name + " · " + error.message, true);
        }
      }
      setProgress("上传完成，正在同步文件状态…", 100);
      notify("上传流程完成，正在同步最新文件状态。", "success");
      await reload({ silentToast: true });
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
    openUploadPicker: openUploadPicker,
    handleUploadFiles: handleUploadFiles,
    handleUploadChange: handleUploadChange,
    copyName: copyName,
    setFileDisabled: setFileDisabled,
    deleteFile: deleteFile
  };
}
