// CodeKit Web Application Server
// Enhanced deployment template
// ╔══════════════════════════════════════════════════════════════╗
// ║ 📋 部署前必改 (建议通过 Vercel 环境变量设置, 代码只作兜底)   ║
// ║                                                              ║
// ║  [必改①] UUID    → Vercel 环境变量 UUID 设你的节点UUID       ║
// ║  [必改②] DOMAIN  → Vercel 环境变量 DOMAIN 设反代域名        ║
// ║            (不含 https://, 如 xxx.vercel.app)                ║
// ║  [可选③] SUB_PATH → 订阅路径 (默认 /vercel)                  ║
// ║  [可选④] WSPATH   → WS 路径 (默认 = UUID, 一般不用改)        ║
// ╚══════════════════════════════════════════════════════════════╝

// CodeKit Web Application Server
// Enhanced deployment template

const WebSocket = require('ws');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== Environment Variables ====================
const UUID = process.env.UUID || 'CHANGE_ME';   // [必改①] 节点 UUID (环境变量 UUID 覆盖)
const DOMAIN = process.env.DOMAIN || 'xxx.vercel.app';   // [必改②] 反代域名, 不含 https:// (环境变量 DOMAIN 覆盖)
const SUB_PATH = process.env.SUB_PATH || '/vercel';   // [可选③] 订阅路径 (环境变量 SUB_PATH 覆盖)
const WSPATH = process.env.WSPATH || UUID;   // [可选④] WS 路径 (环境变量 WSPATH 覆盖)

// ==================== Utilities ====================
const UUIDS = UUID.split(',').map(u => u.trim()).filter(u => u);
const WSPATHS = WSPATH.split(',').map(p => p.trim()).filter(p => p);

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
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: getFakePage(),
    };
  }

  // Subscription
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
    // 三协议订阅, base64 包裹 (客户端通用格式)
    const subB64 = Buffer.from(sub).toString('base64');
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'subscription-userinfo': 'upload=0; download=0; total=0; expire=0',
      },
      body: subB64 + '\n',
    };
  }

  // Blocked hosts
  if (hostname.includes('speedtest') || hostname.includes('ookla')) {
    return { status: 403, headers: { 'Content-Type': 'text/plain' }, body: 'Forbidden' };
  }

  // Default
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: getFakePage(),
  };
}

// ==================== WebSocket ====================
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request) => {
  const url = new URL(request.url, `https://${request.headers.host || DOMAIN}`);
  const hostname = request.headers['x-forwarded-host'] || request.headers.host || DOMAIN;

  // Validate UUID in path
  if (!UUIDS.some(u => url.pathname.includes(u))) {
    ws.close(4001, 'Invalid path');
    return;
  }

  ws.on('message', async (message) => {
    try {
      const response = await axios({
        method: 'GET',
        url: `https://${hostname}${url.pathname}`,
        headers: {
          'User-Agent': request.headers['user-agent'] || '',
          'Accept': request.headers['accept'] || '*/*',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      ws.send(Buffer.from(response.data));
    } catch (e) {
      ws.send(JSON.stringify({ error: e.message }));
    }
  });

  ws.on('error', () => { /* Silent */ });
  ws.on('close', () => ws.terminate());
});

// ==================== Vercel Handler ====================
module.exports = (req, res) => {
  // WebSocket upgrade — MUST handle before HTTP
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    const url = new URL(req.url, `https://${req.headers.host || DOMAIN}`);
    const isValid = UUIDS.some(u => url.pathname.includes(u));
    if (!isValid) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // wss.handleUpgrade writes the 101 response to socket directly
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
