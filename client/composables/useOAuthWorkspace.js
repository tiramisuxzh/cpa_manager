import { onBeforeUnmount, reactive } from "vue";

const OAUTH_PROVIDER = "codex";
const OAUTH_STATUS_POLL_MS = 3000;
const OAUTH_VERSION_HINT = "当前 cliproxyapi 可能还不支持原生 OAuth 管理接口，请升级到支持该能力的版本后再试。官方管理中心 README 提到最低版本为 6.8.0，建议 6.8.15 及以上。";

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function trimmed(value) {
  return String(value || "").trim();
}

function initialOAuthState() {
  return {
    provider: OAUTH_PROVIDER,
    status: "idle",
    message: "准备开始原生 OAuth 登录。",
    error: "",
    authUrl: "",
    authState: "",
    callbackUrl: "",
    callbackStatus: "idle",
    callbackMessage: "",
    polling: false,
    lastCheckedAt: "",
    startedAt: "",
    completedAt: "",
    autoSyncing: false,
    lastSyncedAt: ""
  };
}

// 这里单独封装 OAuth 工作台，避免把登录启动、状态轮询和成功后同步文件的逻辑继续堆进 useManagementConsole。
export function useOAuthWorkspace(context) {
  var api = context.api;
  var loadFiles = context.loadFiles;
  var state = context.state;
  var readCredentialInfo = context.readCredentialInfo;
  var startPending = context.startPending;
  var finishPending = context.finishPending;
  var notify = context.notify;
  var log = context.log;
  var oauthLogin = reactive(initialOAuthState());
  var pollTimer = null;

  function clearPollTimer() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    oauthLogin.polling = false;
  }

  function compatibilityMessage(error, fallback) {
    var baseMessage = trimmed(error && error.message) || fallback || "OAuth 操作失败";

    if (error && error.status === 404) {
      return baseMessage + "；" + OAUTH_VERSION_HINT;
    }
    return baseMessage;
  }

  function resetOAuthWorkspace() {
    clearPollTimer();
    Object.assign(oauthLogin, initialOAuthState());
  }

  function itemIdentity(item) {
    return [
      item && item.name ? item.name : "",
      item && item.authIndex ? item.authIndex : "",
      item && item.accountId ? item.accountId : "",
      item && item.email ? item.email : "",
      item && item.provider ? item.provider : ""
    ].join("::");
  }

  function valueText(value) {
    return trimmed(value).toLowerCase();
  }

  function pushHint(list, value) {
    var text = valueText(value);

    if (text && list.indexOf(text) === -1) {
      list.push(text);
    }
  }

  function collectTargetHints(payload) {
    var hints = [];

    function collect(candidate) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return;
      }

      pushHint(hints, candidate.name);
      pushHint(hints, candidate.fileName);
      pushHint(hints, candidate.file_name);
      pushHint(hints, candidate.email);
      pushHint(hints, candidate.accountId);
      pushHint(hints, candidate.account_id);
      pushHint(hints, candidate.authIndex);
      pushHint(hints, candidate.auth_index);
    }

    collect(payload);
    collect(payload && payload.data);
    collect(payload && payload.result);
    collect(payload && payload.file);
    collect(payload && payload.authFile);
    collect(payload && payload.auth_file);
    return hints;
  }

  function matchesTargetHints(item, hints) {
    var values = [
      valueText(item && item.name),
      valueText(item && item.email),
      valueText(item && item.accountId),
      valueText(item && item.authIndex)
    ].filter(Boolean);

    return hints.some(function (hint) {
      return values.indexOf(hint) !== -1;
    });
  }

  function pickCredentialTargets(statusResult, previousItems, currentItems) {
    var previousByIdentity = {};
    var targetHints = collectTargetHints(statusResult);
    var matchedByHint = [];
    var newlyAdded = [];

    (Array.isArray(previousItems) ? previousItems : []).forEach(function (item) {
      var identity = itemIdentity(item);
      if (identity && !previousByIdentity[identity]) {
        previousByIdentity[identity] = true;
      }
    });

    (Array.isArray(currentItems) ? currentItems : []).forEach(function (item) {
      var identity = itemIdentity(item);

      if (!item || !item.name || item.runtimeOnly) {
        return;
      }
      if (targetHints.length && matchesTargetHints(item, targetHints)) {
        matchedByHint.push(item);
        return;
      }
      if (identity && !previousByIdentity[identity]) {
        newlyAdded.push(item);
      }
    });

    return matchedByHint.length ? matchedByHint : newlyAdded;
  }

  async function syncCredentialTargets(targetItems) {
    var list = Array.isArray(targetItems) ? targetItems : [];
    var successCount = 0;
    var failureCount = 0;
    var index;

    for (index = 0; index < list.length; index += 1) {
      var item = list[index];
      var result = await readCredentialInfo(item.key, {
        silentLog: true,
        silentToast: true
      });

      if (result && result.success === true) {
        successCount += 1;
      } else {
        failureCount += 1;
      }
    }

    return {
      successCount: successCount,
      failureCount: failureCount
    };
  }

  async function syncFilesAfterLogin(statusResult) {
    var previousItems = Array.isArray(state.items) ? state.items.slice() : [];
    var targetItems;
    var targetResult;

    oauthLogin.autoSyncing = true;
    oauthLogin.message = "OAuth 登录已完成，正在轻量同步文件列表…";

    // OAuth 登录通常只影响极少数文件，这里先刷新文件列表，再定向补拉目标文件凭证，避免整池重复下载 JSON。
    await loadFiles({
      pendingType: "oauth-sync-after-login",
      includeCredentialInfo: false,
      silentLog: true,
      silentToast: true,
      silentErrorToast: false
    });

    targetItems = pickCredentialTargets(statusResult, previousItems, state.items);

    if (targetItems.length) {
      oauthLogin.message = "文件列表已同步，正在只同步本次目标文件的凭证信息…";
      targetResult = await syncCredentialTargets(targetItems);
      oauthLogin.lastSyncedAt = nowText();
      oauthLogin.autoSyncing = false;

      if (targetResult.failureCount) {
        oauthLogin.message = "OAuth 登录已完成，文件列表已同步；目标文件凭证信息部分同步失败。";
        log("OAuth 登录成功：已同步文件列表，并定向补拉 " + targetResult.successCount + " 个文件的凭证信息，失败 " + targetResult.failureCount + " 个。", true);
        notify("OAuth 登录成功，文件列表已同步；目标文件凭证信息成功 " + targetResult.successCount + " 个，失败 " + targetResult.failureCount + " 个。", "warn", 4200);
        return;
      }

      oauthLogin.message = "OAuth 登录已完成，文件列表与目标文件凭证信息已同步。";
      log("OAuth 登录成功：已同步文件列表，并定向补拉 " + targetResult.successCount + " 个目标文件的凭证信息。");
      notify("OAuth 登录成功，已同步文件列表，并更新 " + targetResult.successCount + " 个目标文件的凭证信息。", "success", 3600);
      return;
    }

    oauthLogin.autoSyncing = false;
    oauthLogin.lastSyncedAt = nowText();
    oauthLogin.message = "OAuth 登录已完成，已只同步文件列表，未触发全量凭证刷新。";
    log("OAuth 登录成功：已同步文件列表，未触发全量凭证刷新。");
    notify("OAuth 登录成功，已同步文件列表；凭证详情改为按目标文件定向同步。", "success", 3600);
  }

  async function checkAuthStatus() {
    var result;
    var statusText;
    var messageText;

    if (!trimmed(oauthLogin.authState)) {
      return null;
    }

    try {
      result = await api.getOAuthAuthStatus(oauthLogin.authState);
    } catch (error) {
      clearPollTimer();
      oauthLogin.status = "error";
      oauthLogin.error = compatibilityMessage(error, "获取 OAuth 登录状态失败");
      oauthLogin.message = oauthLogin.error;
      log("OAuth 状态轮询失败：" + oauthLogin.error, true);
      notify("OAuth 状态轮询失败。\n" + oauthLogin.error, "danger", 5200);
      return null;
    }

    statusText = trimmed(result && result.status).toLowerCase();
    messageText = trimmed(result && result.message);
    oauthLogin.lastCheckedAt = nowText();

    if (statusText === "ok") {
      clearPollTimer();
      oauthLogin.status = "success";
      oauthLogin.completedAt = nowText();
      oauthLogin.error = "";
      oauthLogin.message = messageText || "OAuth 登录已完成。";
      log("OAuth 登录成功，服务端已完成凭证写入。");
      notify("OAuth 登录成功，正在轻量同步文件列表。", "success", 3200);
      await syncFilesAfterLogin(result);
      return result;
    }

    if (statusText === "error") {
      clearPollTimer();
      oauthLogin.status = "error";
      oauthLogin.error = messageText || "OAuth 登录失败";
      oauthLogin.message = oauthLogin.error;
      log("OAuth 登录失败：" + oauthLogin.error, true);
      notify("OAuth 登录失败。\n" + oauthLogin.error, "danger", 5200);
      return result;
    }

    oauthLogin.status = "waiting";
    oauthLogin.message = messageText || "等待在浏览器完成登录，或手动提交回调地址。";
    return result;
  }

  function scheduleNextPoll() {
    if (!trimmed(oauthLogin.authState) || oauthLogin.status === "success" || oauthLogin.status === "error") {
      clearPollTimer();
      return;
    }

    oauthLogin.polling = true;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async function () {
      await checkAuthStatus();
      if (oauthLogin.status === "waiting") {
        scheduleNextPoll();
      }
    }, OAUTH_STATUS_POLL_MS);
  }

  async function startCodexOAuth() {
    var result;
    var authUrl;
    var authState;

    startPending("oauth-start");
    clearPollTimer();

    // 每次重新开始都清空上一轮状态，但保留 provider，避免用户在历史失败态里继续操作产生歧义。
    Object.assign(oauthLogin, initialOAuthState(), {
      status: "starting",
      message: "正在向 cliproxyapi 申请 OAuth 登录地址…"
    });

    try {
      result = await api.startOAuthAuth(OAUTH_PROVIDER, {
        isWebUi: true
      });
      authUrl = trimmed(result && (result.url || result.auth_url));
      authState = trimmed(result && result.state);

      if (!authUrl) {
        throw new Error("管理接口未返回可用的 OAuth 登录地址。");
      }

      oauthLogin.status = "waiting";
      oauthLogin.authUrl = authUrl;
      oauthLogin.authState = authState;
      oauthLogin.startedAt = nowText();
      oauthLogin.error = "";
      oauthLogin.message = authState
        ? "登录链接已生成，等待在新窗口完成授权。"
        : "登录链接已生成，请完成授权后手动提交回调地址。";
      log("OAuth 登录链接已生成。");
      notify("OAuth 登录链接已生成，请打开新窗口完成授权。", "info");

      if (authState) {
        scheduleNextPoll();
      }
      return result;
    } catch (error) {
      oauthLogin.status = "error";
      oauthLogin.error = compatibilityMessage(error, "启动 OAuth 登录失败");
      oauthLogin.message = oauthLogin.error;
      log("启动 OAuth 登录失败：" + oauthLogin.error, true);
      notify("启动 OAuth 登录失败。\n" + oauthLogin.error, "danger", 5200);
      return null;
    } finally {
      finishPending("oauth-start");
    }
  }

  async function submitCodexOAuthCallback() {
    var callbackUrl = trimmed(oauthLogin.callbackUrl);
    var result;

    if (!callbackUrl) {
      oauthLogin.callbackStatus = "error";
      oauthLogin.callbackMessage = "请先粘贴浏览器回调地址。";
      notify("请先粘贴浏览器回调地址。", "info");
      return null;
    }

    startPending("oauth-submit-callback");
    oauthLogin.callbackStatus = "submitting";
    oauthLogin.callbackMessage = "正在把回调地址提交给 cliproxyapi…";

    try {
      result = await api.submitOAuthCallback(OAUTH_PROVIDER, callbackUrl);
      oauthLogin.callbackStatus = "success";
      oauthLogin.callbackMessage = trimmed(result && result.message) || "回调地址已提交，等待服务端完成登录。";
      oauthLogin.status = oauthLogin.status === "success" ? oauthLogin.status : "waiting";
      oauthLogin.message = oauthLogin.callbackMessage;
      log("OAuth 回调地址已提交。");
      notify("OAuth 回调地址已提交，正在等待服务端完成登录。", "success");

      if (trimmed(oauthLogin.authState)) {
        await checkAuthStatus();
        if (oauthLogin.status === "waiting") {
          scheduleNextPoll();
        }
      }
      return result;
    } catch (error) {
      oauthLogin.callbackStatus = "error";
      oauthLogin.callbackMessage = compatibilityMessage(error, "提交 OAuth 回调地址失败");
      oauthLogin.status = "error";
      oauthLogin.error = oauthLogin.callbackMessage;
      oauthLogin.message = oauthLogin.callbackMessage;
      log("提交 OAuth 回调地址失败：" + oauthLogin.callbackMessage, true);
      notify("提交 OAuth 回调地址失败。\n" + oauthLogin.callbackMessage, "danger", 5200);
      return null;
    } finally {
      finishPending("oauth-submit-callback");
    }
  }

  onBeforeUnmount(function () {
    clearPollTimer();
  });

  return {
    oauthLogin: oauthLogin,
    startCodexOAuth: startCodexOAuth,
    submitCodexOAuthCallback: submitCodexOAuthCallback,
    resetOAuthWorkspace: resetOAuthWorkspace
  };
}
