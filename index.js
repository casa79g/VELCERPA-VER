// CodeKit Web Application Server
// Enhanced deployment template
// ╔══════════════════════════════════════════════════════════════╗
// ║ 📋 部署前必改 (建议通过 Vercel 环境变量设置, 代码只作兜底)   ║
// ║                                                              ║
// ║  [必改①] UUID    → Vercel 环境变量 UUID 设你的节点UUID       ║
// ║  [必改②] DOMAIN  → Vercel 环境变量 DOMAIN 设反代域名        ║
// ║            (不含 https://, 如 xxx.vercel.app)                ║
// ║  [可选③] SUB_PATH → 订阅路径 (默认 /vercel)                  ║
// ║  [可选④] WSPATH   → WS 路径 (默认 = UUID 前8位, 短路径)     ║
// ║                                                              ║
// ║  本版为真隧道: VLESS/Trojan/SS 协议解析 + TCP 出站双向转发  ║
// ╚══════════════════════════════════════════════════════════════╝
const { WebSocket, WebSocketServer } = require('ws');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== Environment Variables ====================
// [必改①] 节点 UUID (Vercel 环境变量 UUID 覆盖)
const UUID = process.env.UUID || 'CHANGE_ME';
// [必改②] 反代域名, 不含 https:// (Vercel 环境变量 DOMAIN 覆盖)
const DOMAIN = process.env.DOMAIN || 'xxx.vercel.app';
// [可选③] 订阅路径 (Vercel 环境变量 SUB_PATH 覆盖)
const SUB_PATH = process.env.SUB_PATH || '/vercel';
// [可选④] WS 路径, 默认取 UUID 前8位 (短路径, 类似 /cb90ea3e)
const WSPATH = process.env.WSPATH || (UUID.replace(/-/g, '').slice(0, 8) || 'abc');

const UUIDS = UUID.split(',').map(u => u.trim()).filter(u => u);
const WSPATHS = WSPATH.split(',').map(p => p.trim()).filter(p => p);

// 测速域名封禁 (防滥用大流量)
const BLOCKED_HOSTS = ['speedtest', 'fast.com', 'ookla', 'cloudflare.com/speed'];

function isBlockedHost(host) {
  const h = (host || '').toLowerCase();
  return BLOCKED_HOSTS.some(b => h.includes(b));
}

// ==================== 订阅生成 ====================
function generateSub(protocol, uuid, wsPath, name) {
  const proto = { vless: 'vless', trojan: 'trojan', shadowsocks: 'ss' }[protocol] || 'vless';
  const params = new URLSearchParams({
    security: 'tls',
    type: 'ws',
    path: wsPath,
    sni: DOMAIN,
    host: DOMAIN,
  });
  if (proto === 'vless' || proto === 'trojan') {
    params.set('encryption', 'none');
  }
  return `${proto}://${uuid}@${DOMAIN}:443?${params.toString()}#${encodeURIComponent(name)}`;
}

function getFakePage() {
  try {
    return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  } catch {
    return '<!DOCTYPE html><html><head><title>CodeKit</title></head><body><h1>CodeKit</h1></body></html>';
  }
}

function handleHTTP(req) {
  const url = new URL(req.url, `https://${req.headers.host || DOMAIN}`);
  const hostname = req.headers['x-forwarded-host'] || req.headers.host || DOMAIN;

  // Fake page
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: getFakePage() };
  }

  // Subscription (vless / trojan / ss 三协议 + base64)
  if (req.method === 'GET' && url.pathname === SUB_PATH) {
    let sub = '';
    for (let i = 0; i < UUIDS.length; i++) {
      const u = UUIDS[i];
      const wspath = WSPATHS.length > i ? WSPATHS[i] : (WSPATHS[0] || u);
      const nodeName = `CodeKit [${i + 1}]`;
      sub += generateSub('vless', u, wspath, nodeName) + '\n';
      sub += generateSub('trojan', u, wspath, nodeName) + '\n';
      sub += generateSub('shadowsocks', u, wspath, nodeName) + '\n';
    }
    const subB64 = Buffer.from(sub).toString('base64');
    return {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'subscription-userinfo': 'upload=0; download=0; total=0; expire=0' },
      body: subB64 + '\n',
    };
  }

  // Blocked hosts
  if (isBlockedHost(hostname)) {
    return { status: 403, headers: { 'Content-Type': 'text/plain' }, body: 'Forbidden' };
  }

  // Default
  return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: getFakePage() };
}

// ==================== 真隧道: 协议解析 + TCP 双向转发 ====================

// UUID 字符串 → 16 字节 Buffer
function uuidBytes(uuid) {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

// 建立 TCP 连接并双向泵 (WS ↔ TCP)
function startPipe(ws, host, port, initialData) {
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    try { ws.off('message', onMsg); } catch (e) {}
    try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch (e) {}
  };
  const onMsg = (d) => {
    try { if (socket.writable) socket.write(d); } catch (e) {}
  };

  let socket;
  try {
    socket = net.connect(port, host);
  } catch (e) {
    finish(false);
    return;
  }
  socket.on('connect', () => {
    if (initialData && initialData.length) socket.write(initialData);
    ws.on('message', onMsg);
  });
  socket.on('data', (d) => {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(d); } catch (e) {}
  });
  socket.on('error', () => finish(false));
  socket.on('close', () => finish(true));
  ws.on('close', () => { try { socket.destroy(); } catch (e) {} });
  ws.on('error', () => { try { socket.destroy(); } catch (e) {} });
}

// ---- VLESS ----
async function handleVless(ws, buf, uuid) {
  try {
    const ub = uuidBytes(uuid);
    if (buf.length < 18 || buf[0] !== 0) return false;
    if (!buf.slice(1, 17).equals(ub)) return false;
    let i = buf[17] + 19;
    if (i + 3 > buf.length) return false;
    const port = buf.readUInt16BE(i); i += 2;
    const atyp = buf[i]; i += 1;
    let host;
    if (atyp === 1) { host = [...buf.slice(i, i + 4)].join('.'); i += 4; }
    else if (atyp === 2) { const l = buf[i]; i += 1; if (i + l > buf.length) return false; host = buf.slice(i, i + l).toString(); i += l; }
    else if (atyp === 3) {
      if (i + 16 > buf.length) return false;
      const parts = [];
      for (let j = 0; j < 16; j += 2) parts.push(buf.slice(i + j, i + j + 2).toString('hex'));
      host = parts.join(':'); i += 16;
    } else return false;
    if (isBlockedHost(host)) { try { ws.close(); } catch (e) {} return false; }
    // VLESS 应答头: 版本0 + 附加长度0
    try { if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from([0, 0])); } catch (e) {}
    startPipe(ws, host, port, buf.slice(i));
    return true;
  } catch (e) { return false; }
}

// ---- Trojan (SHA224 密码哈希认证) ----
async function handleTrojan(ws, buf, uuid) {
  try {
    if (buf.length < 58) return false;
    const recvHash = buf.slice(0, 56).toString('ascii');
    const expectHash = crypto.createHash('sha224').update(uuid).digest('hex');
    const expectHash2 = crypto.createHash('sha224').update(uuid.replace(/-/g, '')).digest('hex');
    if (recvHash !== expectHash && recvHash !== expectHash2) return false;
    let offset = 56;
    if (buf.slice(offset, offset + 2).toString() === '\r\n') offset += 2;
    const cmd = buf[offset]; offset += 1;
    if (cmd !== 1) return false;
    const atyp = buf[offset]; offset += 1;
    let host;
    if (atyp === 1) { host = [...buf.slice(offset, offset + 4)].join('.'); offset += 4; }
    else if (atyp === 3) { const l = buf[offset]; offset += 1; host = buf.slice(offset, offset + l).toString(); offset += l; }
    else if (atyp === 4) {
      const parts = [];
      for (let j = 0; j < 16; j += 2) parts.push(buf.slice(offset + j, offset + j + 2).toString('hex'));
      host = parts.join(':'); offset += 16;
    } else return false;
    const port = buf.readUInt16BE(offset); offset += 2;
    if (buf.slice(offset, offset + 2).toString() === '\r\n') offset += 2;
    if (isBlockedHost(host)) { try { ws.close(); } catch (e) {} return false; }
    startPipe(ws, host, port, buf.slice(offset));
    return true;
  } catch (e) { return false; }
}

// ---- Shadowsocks (none 档: ATYP + 端口) ----
async function handleSS(ws, buf) {
  try {
    if (buf.length < 7) return false;
    let offset = 0;
    const atyp = buf[offset]; offset += 1;
    let host;
    if (atyp === 1) { host = [...buf.slice(offset, offset + 4)].join('.'); offset += 4; }
    else if (atyp === 3) { const l = buf[offset]; offset += 1; if (offset + l > buf.length) return false; host = buf.slice(offset, offset + l).toString(); offset += l; }
    else if (atyp === 4) {
      if (offset + 16 > buf.length) return false;
      const parts = [];
      for (let j = 0; j < 16; j += 2) parts.push(buf.slice(offset + j, offset + j + 2).toString('hex'));
      host = parts.join(':'); offset += 16;
    } else return false;
    if (offset + 2 > buf.length) return false;
    const port = buf.readUInt16BE(offset); offset += 2;
    if (isBlockedHost(host)) { try { ws.close(); } catch (e) {} return false; }
    startPipe(ws, host, port, buf.slice(offset));
    return true;
  } catch (e) { return false; }
}

// ==================== WebSocket ====================
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request) => {
  const url = new URL(request.url, `https://${request.headers.host || DOMAIN}`);
  const wsPath = url.pathname;

  // 路径鉴权: path 需包含任一 WSPATH (默认 UUID 前8位) 或完整 UUID
  const uuidText = UUID.replace(/-/g, '');
  const valid = WSPATHS.some(p => p && wsPath.includes(p)) ||
                UUIDS.some(u => wsPath.includes(u)) ||
                (uuidText && wsPath.includes(uuidText));
  if (!valid) {
    try { ws.close(4001, 'Invalid path'); } catch (e) {}
    return;
  }

  // 等首包 → 协议识别分流 (VLESS / Trojan / SS)
  const onFirst = (buf) => {
    try {
      if (!(buf instanceof Buffer)) return;
      for (const u of UUIDS) {
        if (buf.length > 17 && buf[0] === 0 && handleVless(ws, buf, u)) return;
      }
      for (const u of UUIDS) {
        if (buf.length >= 58 && handleTrojan(ws, buf, u)) return;
      }
      if (buf.length > 0 && [1, 3, 4].includes(buf[0]) && handleSS(ws, buf)) return;
      try { ws.close(); } catch (e) {}
    } catch (e) { /* ignore */ }
  };
  ws.on('message', onFirst);
  ws.on('error', () => {});
});

// ==================== Vercel Handler ====================
module.exports = (req, res) => {
  // WebSocket upgrade — MUST handle before HTTP
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    const url = new URL(req.url, `https://${req.headers.host || DOMAIN}`);
    const uuidText = UUID.replace(/-/g, '');
    const valid = WSPATHS.some(p => p && url.pathname.includes(p)) ||
                  UUIDS.some(u => url.pathname.includes(u)) ||
                  (uuidText && url.pathname.includes(uuidText));
    if (!valid) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    wss.handleUpgrade(req, req.socket, Buffer.from(''), (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }

  // HTTP request
  const result = handleHTTP(req);
  res.writeHead(result.status, result.headers);
  res.end(result.body);
};
