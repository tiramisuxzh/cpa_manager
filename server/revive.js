const { execFile } = require("child_process");

const MULTIPART_FALLBACK_STATUS_CODES = [404, 405, 415];
const REQUEST_TIMEOUT_MS = 30000;
const REVIVE_WAIT_MS = 3000;
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
const AUTH_FILE_WRAPPER_KEYS = ["data", "content", "file", "authFile", "auth_file", "result", "value"];
const CREDENTIAL_DETAIL_FIELDS = [
  { key: "access_token", label: "Access Token" },
  { key: "refresh_token", label: "Refresh Token" },
  { key: "id_token", label: "ID Token" },
  { key: "last_refresh", label: "Last Refresh" },
  { key: "expired", label: "Expired" }
];

function trimText(value) {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringifyPayloadDetail(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return trimText(value);
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return trimText(value);
  }
}

function normalizeBaseUrl(value) {
  return trimText(value).replace(/\/+$/, "");
}

function resolveProxyUrl(management) {
  return normalizeBaseUrl(
    management && management.reviveProxyUrl
      ? management.reviveProxyUrl
      : (process.env.CPA_REVIVE_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "")
  );
}

function normalizeAuthFilesBase(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);

  if (!normalized) {
    return "";
  }
  if (normalized.endsWith("/auth-files")) {
    return normalized;
  }
  if (normalized.endsWith("/v0/management") || normalized.endsWith("/management")) {
    return normalized + "/auth-files";
  }
  if (normalized.endsWith("/v0")) {
    return normalized + "/management/auth-files";
  }
  return normalized + "/v0/management/auth-files";
}

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

function extractPayloadMessage(payload) {
  if (payload == null) {
    return "";
  }
  if (typeof payload === "string") {
    return trimText(payload);
  }
  if (!isPlainObject(payload)) {
    return trimText(payload);
  }

  return extractPayloadMessage(payload.message)
    || extractPayloadMessage(payload.error)
    || extractPayloadMessage(payload.detail)
    || extractPayloadMessage(payload.type)
    || stringifyPayloadDetail(payload);
}

function buildErrorMessage(response, payload, text, fallback) {
  return extractPayloadMessage(payload) || trimText(text) || fallback || ("HTTP " + response.status);
}

function requestTargetText(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch (_) {
    return trimText(url) || "unknown-url";
  }
}

function networkErrorMessage(url, error) {
  if (error && error.name === "AbortError") {
    return "请求超时：" + requestTargetText(url);
  }
  return "请求失败：" + requestTargetText(url) + " · " + (error && error.message ? error.message : "未知网络错误");
}

function withTimeout(options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs || REQUEST_TIMEOUT_MS);

  return {
    options: Object.assign({}, options, {
      signal: controller.signal
    }),
    cleanup() {
      clearTimeout(timer);
    }
  };
}

async function fetchText(url, options, timeoutMs) {
  const request = withTimeout(options, timeoutMs);

  try {
    const response = await fetch(url, request.options);
    const text = await response.text();
    return {
      response,
      text,
      payload: parseJsonSafe(text)
    };
  } catch (error) {
    throw new Error(networkErrorMessage(url, error));
  } finally {
    request.cleanup();
  }
}

function managementHeaders(key, headers) {
  return Object.assign({
    Authorization: "Bearer " + key,
    "X-Management-Key": key
  }, headers || {});
}

function unwrapAuthFileData(candidate) {
  let normalized = candidate;

  if (typeof normalized === "string") {
    normalized = parseJsonSafe(normalized);
  }
  if (!isPlainObject(normalized)) {
    return null;
  }
  if (
    normalized.refresh_token != null
    || normalized.access_token != null
    || normalized.id_token != null
    || normalized.account_id != null
    || normalized.email != null
  ) {
    return normalized;
  }

  return AUTH_FILE_WRAPPER_KEYS.reduce((result, key) => {
    if (result || normalized[key] == null) {
      return result;
    }
    return unwrapAuthFileData(normalized[key]);
  }, null);
}

function compactIsoTime(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function stripJsonSuffix(name) {
  return trimText(name).replace(/\.json$/i, "");
}

function authFileCredentialSummary(fileData) {
  const normalized = isPlainObject(fileData) ? fileData : {};

  return {
    lastRefresh: trimText(normalized.last_refresh || normalized.lastRefresh),
    expired: trimText(normalized.expired || normalized.expires_at || normalized.expiresAt),
    fetchedAt: compactIsoTime(Date.now()),
    content: normalized,
    contentText: JSON.stringify(normalized, null, 2)
  };
}

function detailFieldText(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function buildCredentialDetail(beforeFile, afterFile) {
  const previous = isPlainObject(beforeFile) ? beforeFile : {};
  const current = isPlainObject(afterFile) ? afterFile : {};

  return {
    changes: CREDENTIAL_DETAIL_FIELDS.map((field) => {
      const beforeValue = detailFieldText(previous[field.key]);
      const afterValue = detailFieldText(current[field.key]);
      return {
        key: field.key,
        label: field.label,
        before: beforeValue,
        after: afterValue,
        changed: beforeValue !== afterValue
      };
    }),
    beforeText: JSON.stringify(previous, null, 2),
    afterText: JSON.stringify(current, null, 2)
  };
}

async function downloadAuthFile(authFilesBase, key, fileName) {
  let result;
  const url = authFilesBase + "/download?name=" + encodeURIComponent(fileName);

  try {
    result = await fetchText(
      url,
      {
        method: "GET",
        headers: managementHeaders(key, {
          Accept: "application/json, text/plain, */*"
        })
      }
    );
  } catch (error) {
    throw new Error("下载原始认证文件失败：" + (error && error.message ? error.message : "未知错误"));
  }
  const fileData = unwrapAuthFileData(result.payload || result.text);

  if (!result.response.ok) {
    throw new Error(buildErrorMessage(result.response, result.payload, result.text, "下载原始认证文件失败"));
  }
  if (!fileData || !Object.keys(fileData).length) {
    throw new Error("下载到的原始认证 JSON 为空");
  }
  return fileData;
}

async function refreshOpenAIToken(refreshToken) {
  return refreshOpenAITokenWithProxy(refreshToken, "");
}

function execFileAsync(file, args, options) {
  return new Promise(function (resolve, reject) {
    execFile(file, args, options || {}, function (error, stdout, stderr) {
      if (error) {
        reject(Object.assign(error, {
          stdout: stdout,
          stderr: stderr
        }));
        return;
      }
      resolve({
        stdout: stdout,
        stderr: stderr
      });
    });
  });
}

function curlRequestError(error) {
  if (!error) {
    return "curl 请求失败";
  }
  return trimText(error.stderr) || trimText(error.stdout) || trimText(error.message) || "curl 请求失败";
}

async function refreshOpenAITokenWithCurl(refreshToken, proxyUrl) {
  const form = new URLSearchParams();
  const args = ["-sS", "-X", "POST", OAUTH_TOKEN_URL, "-H", "Content-Type: application/x-www-form-urlencoded", "-H", "Accept: application/json", "--max-time", String(Math.max(1, Math.round(REQUEST_TIMEOUT_MS / 1000))), "--data", ""];
  let result;
  let separatorIndex;
  let bodyText;
  let statusText;
  let payload;
  let statusCode;
  let oauthAccessToken;
  let oauthIdToken;
  let oauthRefreshToken;
  let oauthExpiresIn;
  let lastRefresh;
  let expired;

  form.set("client_id", OAUTH_CLIENT_ID);
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  form.set("redirect_uri", OAUTH_REDIRECT_URI);
  args[args.length - 1] = form.toString();

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  // 通过 curl 输出状态码，既能复用本机 Clash/HTTP 代理，又不需要额外安装第三方 Node 代理库。
  args.push("-w", "\n__CPA_STATUS__:%{http_code}");

  try {
    result = await execFileAsync("curl.exe", args, {
      timeout: REQUEST_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    throw new Error("请求 OpenAI OAuth 刷新接口失败：" + curlRequestError(error));
  }

  separatorIndex = result.stdout.lastIndexOf("\n__CPA_STATUS__:");
  bodyText = separatorIndex >= 0 ? result.stdout.slice(0, separatorIndex) : result.stdout;
  statusText = separatorIndex >= 0 ? result.stdout.slice(separatorIndex + "\n__CPA_STATUS__:".length) : "";
  payload = parseJsonSafe(bodyText) || {};
  statusCode = Number(statusText);

  if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
    throw new Error("OpenAI OAuth 刷新失败：" + (extractPayloadMessage(payload) || trimText(bodyText) || ("HTTP " + (statusText || "unknown"))));
  }

  oauthAccessToken = trimText(payload.access_token);
  oauthIdToken = trimText(payload.id_token);
  oauthRefreshToken = trimText(payload.refresh_token);
  oauthExpiresIn = Number(payload.expires_in);
  lastRefresh = compactIsoTime(Date.now());
  expired = Number.isFinite(oauthExpiresIn) && oauthExpiresIn > 0
    ? compactIsoTime(Date.now() + oauthExpiresIn * 1000)
    : lastRefresh;

  if (!oauthAccessToken || !oauthIdToken) {
    throw new Error("OpenAI OAuth 刷新未返回完整 token");
  }

  return {
    accessToken: oauthAccessToken,
    refreshToken: oauthRefreshToken,
    idToken: oauthIdToken,
    lastRefresh,
    expired
  };
}

async function refreshOpenAITokenWithProxy(refreshToken, proxyUrl) {
  const form = new URLSearchParams();
  let result;

  form.set("client_id", OAUTH_CLIENT_ID);
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  form.set("redirect_uri", OAUTH_REDIRECT_URI);

  if (proxyUrl) {
    return refreshOpenAITokenWithCurl(refreshToken, proxyUrl);
  }

  try {
    result = await fetchText(
      OAUTH_TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: form.toString()
      }
    );
  } catch (error) {
    throw new Error("请求 OpenAI OAuth 刷新接口失败：" + (error && error.message ? error.message : "未知错误"));
  }

  const oauthPayload = isPlainObject(result.payload) ? result.payload : {};
  const oauthAccessToken = trimText(oauthPayload.access_token);
  const oauthIdToken = trimText(oauthPayload.id_token);
  const oauthRefreshToken = trimText(oauthPayload.refresh_token);
  const oauthExpiresIn = Number(oauthPayload.expires_in);
  const lastRefresh = compactIsoTime(Date.now());
  const expired = Number.isFinite(oauthExpiresIn) && oauthExpiresIn > 0
    ? compactIsoTime(Date.now() + oauthExpiresIn * 1000)
    : lastRefresh;

  if (!result.response.ok) {
    throw new Error(buildErrorMessage(result.response, result.payload, result.text, "OpenAI OAuth 刷新失败"));
  }
  if (!oauthAccessToken || !oauthIdToken) {
    throw new Error("OpenAI OAuth 刷新未返回完整 token");
  }

  return {
    accessToken: oauthAccessToken,
    refreshToken: oauthRefreshToken,
    idToken: oauthIdToken,
    lastRefresh,
    expired
  };
}

async function uploadWithMultipart(authFilesBase, key, fileName, contentText) {
  const form = new FormData();
  form.append("file", new Blob([contentText], { type: "application/json" }), fileName);
  try {
    return await fetchText(authFilesBase, {
      method: "POST",
      headers: managementHeaders(key),
      body: form
    });
  } catch (error) {
    throw new Error("上传更新后的认证文件失败：" + (error && error.message ? error.message : "未知错误"));
  }
}

async function uploadWithRawJson(authFilesBase, key, fileName, contentText) {
  try {
    return await fetchText(
      authFilesBase + "?name=" + encodeURIComponent(fileName),
      {
        method: "POST",
        headers: managementHeaders(key, {
          "Content-Type": "application/json"
        }),
        body: contentText
      }
    );
  } catch (error) {
    throw new Error("上传更新后的认证文件失败：" + (error && error.message ? error.message : "未知错误"));
  }
}

async function uploadAuthFile(authFilesBase, key, fileName, fileData) {
  const contentText = JSON.stringify(fileData, null, 2);
  const multipartResult = await uploadWithMultipart(authFilesBase, key, fileName, contentText);

  // 上传优先走 multipart，只有后端不接受该格式时才回退 raw json，避免把兼容逻辑分散到路由层。
  if (multipartResult.response.ok) {
    return {
      uploadMode: "multipart"
    };
  }
  if (MULTIPART_FALLBACK_STATUS_CODES.indexOf(multipartResult.response.status) === -1) {
    throw new Error(buildErrorMessage(multipartResult.response, multipartResult.payload, multipartResult.text, "上传更新后的认证文件失败"));
  }

  const rawResult = await uploadWithRawJson(authFilesBase, key, fileName, contentText);

  if (!rawResult.response.ok) {
    throw new Error(buildErrorMessage(rawResult.response, rawResult.payload, rawResult.text, "上传更新后的认证文件失败"));
  }
  return {
    uploadMode: "raw-json"
  };
}

function businessFailure(reason, message) {
  return {
    success: false,
    reason,
    message
  };
}

// 这里统一封装 token 刷新和回写本体，普通凭证保活与 401 复活共用同一套底层规则，避免两条链路后续越改越分叉。
async function refreshAuthCredential(input) {
  const body = isPlainObject(input) ? input : {};
  const management = isPlainObject(body.management) ? body.management : {};
  const item = isPlainObject(body.item) ? body.item : {};
  const baseUrl = normalizeBaseUrl(management.baseUrl);
  const key = trimText(management.key);
  const proxyUrl = resolveProxyUrl(management);
  const fileName = trimText(item.name);
  const authFilesBase = normalizeAuthFilesBase(baseUrl);
  let fullItemData;
  let tokenResult;
  let uploadResult;
  let detail;

  if (!baseUrl || !key || !fileName || !authFilesBase) {
    throw new Error("缺少复活所需的管理地址、Key 或文件名");
  }
  if (item.runtimeOnly) {
    return businessFailure("revive_skipped_memory_only", "运行时内存账号不支持尝试复活。");
  }

  try {
    fullItemData = await downloadAuthFile(authFilesBase, key, fileName);
  } catch (error) {
    return businessFailure("revive_download_failed", error && error.message ? error.message : "下载原始认证文件失败");
  }

  const originalRefreshToken = trimText(fullItemData.refresh_token);

  if (!originalRefreshToken) {
    return businessFailure("revive_missing_refresh_token", "原始 JSON 中缺少 refresh_token，无法尝试复活。");
  }

  try {
    tokenResult = await refreshOpenAITokenWithProxy(originalRefreshToken, proxyUrl);
  } catch (error) {
    return businessFailure("revive_oauth_refresh_failed", error && error.message ? error.message : "OpenAI OAuth 刷新失败");
  }

  const nextAuthFile = Object.assign({}, fullItemData, {
    access_token: tokenResult.accessToken,
    refresh_token: tokenResult.refreshToken || originalRefreshToken,
    id_token: tokenResult.idToken,
    last_refresh: tokenResult.lastRefresh,
    expired: tokenResult.expired
  });
  detail = buildCredentialDetail(fullItemData, nextAuthFile);

  if (!trimText(nextAuthFile.email)) {
    nextAuthFile.email = stripJsonSuffix(fileName);
  }

  try {
    uploadResult = await uploadAuthFile(authFilesBase, key, fileName, nextAuthFile);
  } catch (error) {
    return Object.assign(
      businessFailure("revive_upload_failed", error && error.message ? error.message : "上传更新后的认证文件失败"),
      { detail }
    );
  }

  return {
    success: true,
    reason: "credential_refreshed",
    message: "凭证已刷新并回写成功。",
    uploadMode: uploadResult.uploadMode,
    proxyUsed: !!proxyUrl,
    lastRefresh: tokenResult.lastRefresh,
    expired: tokenResult.expired,
    detail
  };
}

async function reviveAuthFile(input) {
  const result = await refreshAuthCredential(input);

  if (!result || result.success !== true) {
    return result;
  }

  return Object.assign({}, result, {
    reason: "revive_uploaded",
    message: "凭证已刷新并回写成功，请等待二次校验。",
    waitMs: REVIVE_WAIT_MS
  });
}

async function readAuthFileDetail(input) {
  const body = isPlainObject(input) ? input : {};
  const management = isPlainObject(body.management) ? body.management : {};
  const item = isPlainObject(body.item) ? body.item : {};
  const baseUrl = normalizeBaseUrl(management.baseUrl);
  const key = trimText(management.key);
  const fileName = trimText(item.name);
  const authFilesBase = normalizeAuthFilesBase(baseUrl);
  let fullItemData;

  if (!baseUrl || !key || !fileName || !authFilesBase) {
    throw new Error("缺少查看凭证信息所需的管理地址、Key 或文件名");
  }
  if (item.runtimeOnly) {
    return businessFailure("credential_info_runtime_only", "运行时内存账号不支持查看凭证信息。");
  }

  try {
    fullItemData = await downloadAuthFile(authFilesBase, key, fileName);
  } catch (error) {
    return businessFailure("credential_info_download_failed", error && error.message ? error.message : "下载原始认证文件失败");
  }

  return {
    success: true,
    reason: "credential_info_loaded",
    message: "凭证信息已同步。",
    credential: authFileCredentialSummary(fullItemData)
  };
}

module.exports = {
  readAuthFileDetail,
  refreshAuthCredential,
  reviveAuthFile,
  REVIVE_WAIT_MS
};
