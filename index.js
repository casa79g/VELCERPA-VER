// CodeKit Web Application Server
// Enhanced deployment template

const WebSocket = require('ws');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== Environment Variables ====================
const UUID = process.env.UUID || 'CHANGE_ME';
const DOMAIN = process.env.DOMAIN || 'xxx.vercel.app';
const SUB_PATH = process.env.SUB_PATH || '/vercel';
const WSPATH = process.env.WSPATH || UUID;

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

function createHTTPResponse(req) {
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

  // Subscription generation
  if (req.method === 'GET' && url.pathname === SUB_PATH) {
    let sub = '';
    for (let i = 0; i < UUIDS.length; i++) {
      const u = UUIDS[i];
      const wspath = WSPATHS.length > i ? WSPATHS[i] : (WSPATHS[0] || u);
      const nodeName = `CodeKit [${i + 1}]`;
      sub += generateSub('vless', u, wspath, nodeName) + '\n';
    }
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'subscription-userinfo': 'upload=0; download=0; total=0; expire=0',
      },
      body: sub,
    };
  }

  // Blocked: speedtest domains
  if (hostname.includes('speedtest') || hostname.includes('ookla')) {
    return { status: 403, headers: { 'Content-Type': 'text/plain' }, body: 'Forbidden' };
  }

  // Default: return fake page
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: getFakePage(),
  };
}

// ==================== WebSocket Server ====================
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request) => {
  const url = new URL(request.url, `https://${request.headers.host || DOMAIN}`);
  const hostname = request.headers['x-forwarded-host'] || request.headers.host || DOMAIN;
  const wsPath = url.pathname;

  // Validate UUID in path
  const uuidMatch = UUIDS.find(u => wsPath.includes(u));
  if (!uuidMatch) {
    ws.close(4001, 'Invalid path');
    return;
  }

  ws.on('message', async (message) => {
    try {
      const response = await axios({
        method: 'GET',
        url: `https://${hostname}${wsPath}`,
        headers: {
          'User-Agent': request.headers['user-agent'] || '',
          'Accept': request.headers['accept'] || '*/*',
        },
        responseType: 'arraybuffer',
        timeout: 30000, // 30 seconds max per request
      });
      ws.send(Buffer.from(response.data));
    } catch (e) {
      ws.send(JSON.stringify({ error: e.message }));
    }
  });

  ws.on('error', () => { /* Silently close on error */ });
  ws.on('close', () => ws.terminate());
});

// ==================== Vercel Handler ====================
module.exports = async (req, res) => {
  // Handle WebSocket upgrade
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    try {
      wss.handleUpgrade(req, req.socket, Buffer.from(''), (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch (e) {
      return new Response('Internal Error', { status: 500 });
    }
    return; // WebSocket handled manually, don't send Response
  }

  // Handle HTTP requests
  const result = createHTTPResponse(req);
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
};
