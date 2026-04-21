const { Client } = require("ssh2");

function normalizePath(scriptPath) {
  return String(scriptPath || "").replace(/\\/g, "/").trim();
}

function shellEscape(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function buildCommand(scriptPath) {
  const normalized = normalizePath(scriptPath);
  const lastSlash = normalized.lastIndexOf("/");
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : ".";
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  if (!file) {
    throw new Error("脚本完整路径无效");
  }

  return "cd " + shellEscape(dir || ".") + " && py39 " + shellEscape(file);
}

function createSshSession(config) {
  const conn = new Client();
  let stream = null;

  return new Promise((resolve, reject) => {
    conn.on("ready", () => {
      conn.shell({ term: "xterm-color", cols: 120, rows: 36 }, (error, shellStream) => {
        if (error) {
          reject(error);
          return;
        }
        stream = shellStream;
        resolve({ conn, stream });
      });
    });

    conn.on("error", reject);

    conn.connect({
      host: config.host,
      port: Number(config.port || 22),
      username: config.username,
      password: config.password,
      readyTimeout: 20000
    });
  }).then((session) => {
    session.command = buildCommand(config.scriptPath);
    return session;
  });
}

module.exports = {
  createSshSession,
  buildCommand
};

function connectSftp(config) {
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on("ready", () => {
      conn.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ conn, sftp });
      });
    });

    conn.on("error", reject);

    conn.connect({
      host: config.host,
      port: Number(config.port || 22),
      username: config.username,
      password: config.password,
      readyTimeout: 20000
    });
  });
}

function listTokenFiles(config) {
  const explicitDir = normalizePath(config.tokenDir || "");
  const normalized = normalizePath(config.scriptPath);
  const lastSlash = normalized.lastIndexOf("/");
  const dir = explicitDir || (lastSlash >= 0 ? normalized.slice(0, lastSlash) : ".");

  return connectSftp(config).then(({ conn, sftp }) => {
    return new Promise((resolve, reject) => {
      sftp.readdir(dir, (error, list) => {
        conn.end();
        if (error) {
          reject(error);
          return;
        }
        resolve({
          dir,
          files: (list || []).filter((item) => /^token_/i.test(item.filename || "")).map((item) => ({
            name: item.filename,
            path: dir.replace(/\/+$/, "") + "/" + item.filename,
            size: item.attrs && item.attrs.size ? item.attrs.size : 0,
            modifyTime: item.attrs && item.attrs.mtime ? item.attrs.mtime : 0
          }))
        });
      });
    });
  });
}

function downloadRemoteFile(config, remotePath) {
  return connectSftp(config).then(({ conn, sftp }) => {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = sftp.createReadStream(remotePath);

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", (error) => {
        conn.end();
        reject(error);
      });
      stream.on("end", () => {
        conn.end();
        resolve(Buffer.concat(chunks));
      });
    });
  });
}

function deleteRemoteFile(config, remotePath) {
  return connectSftp(config).then(({ conn, sftp }) => {
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (error) => {
        conn.end();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

module.exports.connectSftp = connectSftp;
module.exports.listTokenFiles = listTokenFiles;
module.exports.downloadRemoteFile = downloadRemoteFile;
module.exports.deleteRemoteFile = deleteRemoteFile;
