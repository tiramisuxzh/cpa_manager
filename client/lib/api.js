import { USAGE_URL } from "./constants.js";

function parseResponse(response) {
  return response.text().then(function (text) {
    var data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { raw: text };
    }
    if (!response.ok) {
      throw new Error(data.message || data.error || data.raw || ("HTTP " + response.status));
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
    saveDefaultIntegrationConfig: saveDefaultIntegrationConfig
  };
}
