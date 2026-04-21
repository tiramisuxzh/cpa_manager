const Imap = require("imap");

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCode(text) {
  const match = String(text || "").match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

function flattenParts(parts, list) {
  parts.forEach((part) => {
    if (Array.isArray(part.parts)) {
      flattenParts(part.parts, list);
    } else {
      list.push(part);
    }
  });
}

function parseMail(imap, uid) {
  return new Promise((resolve, reject) => {
    const fetcher = imap.fetch(uid, { bodies: "", struct: true, markSeen: false });

    fetcher.on("message", (message) => {
      let body = "";
      let attributes = null;

      message.on("body", (stream) => {
        stream.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });
      });

      message.once("attributes", (attrs) => {
        attributes = attrs;
      });

      message.once("end", () => {
        resolve({ uid, body, attributes: attributes || {} });
      });
    });

    fetcher.once("error", reject);
  });
}

function createMailListener(config) {
  const codes = [];
  let imap = null;
  let pollTimer = null;
  let active = false;
  let lastUid = 0;
  const senders = (Array.isArray(config.senders) ? config.senders : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  function stop() {
    active = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (imap) {
      try {
        imap.end();
      } catch (_) {}
      imap = null;
    }
  }

  function oldestUnusedCode() {
    return codes.find((item) => !item.used) || null;
  }

  function newestUnusedCode() {
    for (let index = codes.length - 1; index >= 0; index -= 1) {
      if (!codes[index].used) {
        return codes[index];
      }
    }
    return null;
  }

  function markUsed(codeValue) {
    const item = codes.find((entry) => !entry.used && entry.code === codeValue);
    if (item) {
      item.used = true;
    }
  }

  function listCodes() {
    return codes.slice(-20);
  }

  function schedulePoll(handler) {
    if (!active) {
      return;
    }
    pollTimer = setTimeout(() => {
      poll(handler).catch((error) => {
        handler({ type: "stderr", data: (error.message || "邮件轮询失败") + "\n" });
      }).finally(() => {
        schedulePoll(handler);
      });
    }, 5000);
  }

  async function poll(handler) {
    if (!imap || !active) {
      return;
    }

    const criteria = lastUid ? [["UID", `${lastUid + 1}:*`]] : ["ALL"];
    const uids = await new Promise((resolve, reject) => {
      imap.search(criteria, (error, results) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(results || []);
      });
    });

    if (!uids.length) {
      return;
    }

    for (const uid of uids) {
      const mail = await parseMail(imap, uid);
      lastUid = Math.max(lastUid, uid);
      const body = mail.body;
      if (senders.length && !senders.some((sender) => body.toLowerCase().indexOf(sender) !== -1)) {
        continue;
      }
      const code = extractCode(body);
      if (!code) {
        continue;
      }
      if (codes.some((entry) => entry.code === code && entry.uid === uid)) {
        continue;
      }
      const entry = {
        uid,
        code,
        used: false,
        receivedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        source: senders.length ? senders.join(", ") : "未知来源"
      };
      codes.push(entry);
      handler({ type: "mail_codes", codes: listCodes() });
      handler({ type: "status", data: `已捕获邮箱验证码 ${code}\n` });
    }
  }

  function start(handler) {
    return new Promise((resolve, reject) => {
      imap = new Imap({
        user: config.qqAddress,
        password: config.authCode,
        host: config.imapHost || "imap.qq.com",
        port: Number(config.imapPort || 993),
        tls: config.secure !== false,
        connTimeout: 20000,
        authTimeout: 20000
      });

      active = true;

      imap.once("ready", () => {
        imap.openBox("INBOX", true, (error, box) => {
          if (error) {
            reject(error);
            return;
          }
          lastUid = box && box.uidnext ? Math.max(0, box.uidnext - 1) : 0;
          handler({ type: "status", data: "邮箱监听已连接，等待验证码邮件...\n" });
          handler({ type: "mail_codes", codes: listCodes() });
          schedulePoll(handler);
          resolve();
        });
      });

      imap.once("error", reject);
      imap.once("end", () => {
        active = false;
      });
      imap.connect();
    });
  }

  return {
    start,
    stop,
    listCodes,
    oldestUnusedCode,
    newestUnusedCode,
    markUsed
  };
}

module.exports = {
  createMailListener
};
