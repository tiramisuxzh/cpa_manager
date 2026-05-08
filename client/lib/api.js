import { USAGE_URL } from "./constants.js";

function stringifyApiDetail(value) {
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

function extractApiMessage(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return String(value).trim();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return String(value);
  }

  // 管理接口和本地代理的错误结构不完全一致，这里递归提取常见字段，避免 toast 只显示成 [object Object]。
  return extractApiMessage(value.message)
    || extractApiMessage(value.error)
    || extractApiMessage(value.detail)
    || extractApiMessage(value.type)
    || stringifyApiDetail(value);
}

function parseResponse(response) {
  return response.text().then(function (text) {
    var data = {};
    var errorMessage = "";
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { raw: text };
    }
    if (!response.ok) {
      errorMessage = extractApiMessage(data) || stringifyApiDetail(data.raw) || ("HTTP " + response.status);
      // 这里保留 HTTP 状态码，方便上层把“接口不存在/版本不支持”和普通业务失败区分开。
      var error = new Error(errorMessage);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  });
}

export function createApi(getSettings) {
  function withSettings() {
    var settings = getSettings();
    if (!settings.baseUrl || !settings.key) {
      throw new Error("请先填写管理地址和 Management Key");
    }
    return settings;
  }

  // 所有管理接口都统一拼到 cliproxyapi 的管理前缀下，避免业务层再关心路径细节。
  function request(path, options) {
    var settings;
    var requestOptions = options || {};
    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    return fetch(settings.baseUrl + "/v0/management" + path, {
      method: requestOptions.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.key,
        "X-Management-Key": settings.key
      },
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
    }).then(parseResponse);
  }

  function localRequest(path, options) {
    var requestOptions = options || {};

    return fetch(path, {
      method: requestOptions.method || "GET",
      headers: {
        "Content-Type": "application/json"
      },
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
    }).then(parseResponse);
  }

  function uploadAuthFile(file) {
    var settings;
    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    var form = new FormData();
    form.append("file", file);
    return fetch(settings.baseUrl + "/v0/management/auth-files", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + settings.key,
        "X-Management-Key": settings.key
      },
      body: form
    }).then(parseResponse);
  }

  function quotaRequest(item) {
    return request("/api-call", {
      method: "POST",
      body: {
        authIndex: item.authIndex,
        method: "GET",
        url: USAGE_URL,
        header: {
          "Authorization": "Bearer $TOKEN$",
          "Chatgpt-Account-Id": item.accountId,
          "Content-Type": "application/json",
          "User-Agent": "codex_cli_rs/0.76.0 (WindowsTerminal)"
        }
      }
    });
  }

  function usageRequest() {
    return request("/usage");
  }

  function usageExportRequest() {
    return request("/usage/export");
  }

  function usageStatisticsEnabledRequest() {
    return request("/usage-statistics-enabled");
  }

  function getManagementValue(path) {
    return request("/" + String(path || "").replace(/^\/+/, ""));
  }

  function setManagementValue(path, value) {
    return request("/" + String(path || "").replace(/^\/+/, ""), {
      method: "PATCH",
      body: {
        value: value
      }
    });
  }

  function clearManagementValue(path) {
    return request("/" + String(path || "").replace(/^\/+/, ""), {
      method: "DELETE"
    });
  }

  function deleteAuthFile(name) {
    return request("/auth-files?name=" + encodeURIComponent(name), { method: "DELETE" });
  }

  function setAuthFileDisabled(name, disabled) {
    return request("/auth-files/status", {
      method: "PATCH",
      body: {
        name: name,
        disabled: !!disabled
      }
    });
  }

  function saveDefaultManagementConfig(management) {
    return localRequest("/api/app-config", {
      method: "PATCH",
      body: {
        management: management || {}
      }
    });
  }

  function saveDefaultIntegrationConfig(integrations) {
    return localRequest("/api/integrations-config", {
      method: "PATCH",
      body: {
        integrations: integrations || {}
      }
    });
  }

  // 本地代理接口和正式服务共用同一份 management 参数组装，避免后续新增 refresh/revive 类动作时再各自拼字段。
  function authFileOperationPayload(settings, item) {
    var target = item || {};

    return {
      management: {
        baseUrl: settings.baseUrl,
        key: settings.key,
        reviveProxyUrl: settings.reviveProxyUrl || ""
      },
      item: {
        name: target.name,
        authIndex: target.authIndex || "",
        accountId: target.accountId || "",
        runtimeOnly: !!target.runtimeOnly,
        source: target.source || ""
      }
    };
  }

  function authFileSyncPayload(settings, options) {
    var currentOptions = options || {};

    return {
      sourceManagement: {
        baseUrl: settings.baseUrl,
        key: settings.key
      },
      targetManagement: {
        baseUrl: settings.syncTargetBaseUrl,
        key: settings.syncTargetKey
      },
      options: {
        skipExisting: currentOptions.skipExisting !== false
      }
    };
  }

  function reviveAuthFile(item) {
    var settings;
    var target = item || {};

    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!target.name) {
      return Promise.reject(new Error("缺少文件名，无法尝试复活。"));
    }

    return localRequest("/api/revive-auth-file", {
      method: "POST",
      body: authFileOperationPayload(settings, target)
    });
  }

  function readAuthFileDetail(item) {
    var settings;
    var target = item || {};

    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!target.name) {
      return Promise.reject(new Error("缺少文件名，无法查看凭证信息。"));
    }

    return localRequest("/api/auth-file-detail", {
      method: "POST",
      body: authFileOperationPayload(settings, target)
    });
  }

  function exportAuthFile(item) {
    var settings;
    var target = item || {};

    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!target.name) {
      return Promise.reject(new Error("缺少文件名，无法导出原始文件。"));
    }

    return localRequest("/api/export-auth-file", {
      method: "POST",
      body: authFileOperationPayload(settings, target)
    });
  }

  function refreshAuthCredential(item) {
    var settings;
    var target = item || {};

    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!target.name) {
      return Promise.reject(new Error("缺少文件名，无法执行认证续期。"));
    }

    return localRequest("/api/refresh-auth-file", {
      method: "POST",
      body: authFileOperationPayload(settings, target)
    });
  }

  function syncAuthFiles(options) {
    var settings;

    try {
      settings = withSettings();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!String(settings.syncTargetBaseUrl || "").trim() || !String(settings.syncTargetKey || "").trim()) {
      return Promise.reject(new Error("缺少目标管理地址或目标 Management Key。"));
    }

    return localRequest("/api/sync-auth-files", {
      method: "POST",
      body: authFileSyncPayload(settings, options)
    });
  }

  function startOAuthAuth(provider, options) {
    var normalizedProvider = String(provider || "").trim();
    var isWebUi = !options || options.isWebUi !== false;
    var query = "is_webui=" + (isWebUi ? "true" : "false");
    var projectId = options && options.projectId != null ? String(options.projectId).trim() : "";

    if (!normalizedProvider) {
      return Promise.reject(new Error("缺少 OAuth provider。"));
    }
    if (projectId) {
      query += "&project_id=" + encodeURIComponent(projectId);
    }

    return request("/" + normalizedProvider + "-auth-url?" + query);
  }

  function getOAuthAuthStatus(state) {
    var normalizedState = String(state || "").trim();

    if (!normalizedState) {
      return Promise.reject(new Error("缺少 OAuth state。"));
    }

    return request("/get-auth-status?state=" + encodeURIComponent(normalizedState));
  }

  function submitOAuthCallback(provider, redirectUrl) {
    var normalizedProvider = String(provider || "").trim();
    var normalizedRedirectUrl = String(redirectUrl || "").trim();

    if (!normalizedProvider) {
      return Promise.reject(new Error("缺少 OAuth provider。"));
    }
    if (!normalizedRedirectUrl) {
      return Promise.reject(new Error("缺少回调地址。"));
    }

    return request("/oauth-callback", {
      method: "POST",
      body: {
        provider: normalizedProvider === "gemini-cli" ? "gemini" : normalizedProvider,
        redirect_url: normalizedRedirectUrl
      }
    });
  }

  return {
    request: request,
    localRequest: localRequest,
    uploadAuthFile: uploadAuthFile,
    quotaRequest: quotaRequest,
    usageRequest: usageRequest,
    usageExportRequest: usageExportRequest,
    usageStatisticsEnabledRequest: usageStatisticsEnabledRequest,
    getManagementValue: getManagementValue,
    setManagementValue: setManagementValue,
    clearManagementValue: clearManagementValue,
    deleteAuthFile: deleteAuthFile,
    setAuthFileDisabled: setAuthFileDisabled,
    saveDefaultManagementConfig: saveDefaultManagementConfig,
    saveDefaultIntegrationConfig: saveDefaultIntegrationConfig,
    readAuthFileDetail: readAuthFileDetail,
    exportAuthFile: exportAuthFile,
    reviveAuthFile: reviveAuthFile,
    refreshAuthCredential: refreshAuthCredential,
    syncAuthFiles: syncAuthFiles,
    startOAuthAuth: startOAuthAuth,
    getOAuthAuthStatus: getOAuthAuthStatus,
    submitOAuthCallback: submitOAuthCallback
  };
}
