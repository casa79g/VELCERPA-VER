// Vercel Proxy Server - 三协议代理（VLESS + Trojan + SS）
// 基于 deploy-vercel 模板增强

const { WebSocket, WebSocketServer } = require('ws');
const axios = require('axios');
const http = require('http');
const {
  makeGrpcServer,
  startGrpcServer,
  stopGrpcServer,
  reportData,
} = require('./nezha');
const si = require('systeminformation');

// ==================== 环境变量 ====================
const UUID = process.env.UUID || 'CHANGE_ME';
const DOMAIN = process.env.DOMAIN || 'xxx.vercel.app';
const AUTO_ACCESS = process.env.AUTO_ACCESS || '';
const SUB_PATH = process.env.SUB_PATH || '/vercel';
const WSPATH = process.env.WSPATH || UUID;
const NAME = process.env.NAME || 'Vercel';
const PORT = Number(process.env.PORT || 443);
const TLS_ENABLE = process.env.TLS_ENABLE || (PORT >= 8000 && PORT <= 9000 ? '1' : '0');

// 支持多个 UUID 和 WSPATH（用逗号分隔）
const UUIDS = UUID.split(',').map(u => u.trim()).filter(u => u);
const WSPATHS = WSPATH.split(',').map(p => p.trim()).filter(p => p);

// ==================== 哪吒监控 ====================
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
let nezhaStarted = false;

async function startNezha() {
  if (!NEZHA_SERVER || !NEZHA_KEY) return;
  if (nezhaStarted) return;
  try {
    makeGrpcServer(NEZHA_KEY);
    await startGrpcServer();
    nezhaStarted = true;
    console.log('[Nezha] Started');
    await reportSystemInfo();
    setInterval(reportSystemInfo, 300000);
  } catch (e) {
    console.error('[Nezha] Error:', e.message);
  }
}

async function reportSystemInfo() {
  try {
    const [cpu, mem, net] = await Promise.all([si.cpu(), si.mem(), si.network()]);
    reportData({
      hostname: 'vercel-proxy',
      ip: '0.0.0.0',
      online: true,
      load: cpu.currentSpeed,
      cpu: cpu.cores.length,
      cores: cpu.cores.length,
      mem: mem.total / 1024 / 1024 / 1024,
      disk: 0,
      diskio: 0,
      netio: net ? net[0] ? net[0].rx_rate / 1024 / 1024 : 0 : 0,
    });
  } catch (e) {}
}

// ==================== 工具函数 ====================
function genID(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function generateSubProtocol(protocol, uuid, path, name) {
  const protocolMap = {
    vless: 'vless',
    trojan: 'trojan',
    shadowsocks: 'ss',
  };
  const proto = protocolMap[protocol] || 'vless';
  const tls = TLS_ENABLE ? '?security=tls&type=ws' : '?type=ws';
  const pathParam = path ? `&path=${encodeURIComponent(path)}` : '';
  const sniParam = proto === 'vless' || proto === 'trojan' ? `&sni=${DOMAIN}&encryption=none` : '';
  return `${proto}://${uuid}@${DOMAIN}:${PORT}${tls}${pathParam}${sniParam}#${encodeURIComponent(name)}`;
}

async function getISP() {
  try {
    const ip = (await axios.get('https://api.ipify.org')).data;
    const res = await axios.get(`https://api.ip.sb/geoip/${ip}`);
    const isp = res.data?.isp || '';
    const asn = res.data?.asn || '';
    return { isp: isp.split(' ')[0], asn };
  } catch (e) {
    return { isp: 'Unknown', asn: '' };
  }
}

async function getNode() {
  try {
    const ip = (await axios.get('https://api.ipify.org')).data;
    const { data } = await axios.get(`https://api.whois.pikonet.com/v1/ip/${ip}`);
    return data?.name || 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

async function isBlockedBySpeedtest(hostname) {
  return hostname.includes('speedtest') || hostname.includes('ookla');
}

// ==================== WebSocket 代理 ====================
const server = http.createServer(async (req, res) => {
  const { method, headers, url } = req;
  const hostname = headers['x-forwarded-host'] || headers['host'] || DOMAIN;
  const ip = headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';

  // 封锁测速站点
  if (await isBlockedBySpeedtest(hostname)) {
    return res.writeHead(403).end('Blocked');
  }

  // 伪装页
  if (method === 'GET' && url === '/') {
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await getFakePage());
  }

  // 订阅链接生成
  if (method === 'GET' && url === SUB_PATH) {
    const { isp } = await getISP();
    const node = await getNode();
    const labels = [node, isp].filter(Boolean).join(' | ');

    let sub = '';
    for (let i = 0; i < UUIDS.length; i++) {
      const u = UUIDS[i];
      const wspath = WSPATHS.length > i ? WSPATHS[i] : WSPATHS[0] || u;
      const nodeName = `${NAME} [${i + 1}]${labels ? ' ' + labels : ''}`;
      sub += generateSubProtocol('vless', u, wspath, nodeName) + '\n';
      sub += generateSubProtocol('trojan', u, wspath, nodeName) + '\n';
      sub += generateSubProtocol('shadowsocks', u, wspath, nodeName) + '\n';
    }

    return res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'subscription-userinfo': `upload=${Math.floor(Math.random() * 100)}MB; download=${Math.floor(Math.random() * 100)}MB; total=0; expire=${Date.now() + 30 * 86400000}`,
    }).end(sub);
  }

  // WebSocket 连接
  if (headers.upgrade === 'websocket' && headers.connection?.includes('Upgrade')) {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      const isValid = UUIDS.some(u => path.includes(u));

      if (!isValid) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.on('message', async (message) => {
          const target = headers['x-forwarded-proto'] === 'https'
            ? `https://${hostname}${path}`
            : `http://${hostname}${path}`;
          try {
            const response = await axios({
              method: 'GET',
              url: target,
              headers: {
                'User-Agent': headers['user-agent'],
                'Accept': headers['accept'] || '*/*',
              },
              responseType: 'arraybuffer',
              timeout: 250000,
            });
            ws.send(Buffer.from(response.data));
          } catch (e) {
            ws.send(JSON.stringify({ error: e.message }));
          }
        });
        ws.on('close', () => ws.terminate());
      });
    });
    return;
  }

  // 默认返回伪装页
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await getFakePage());
});

async function getFakePage() {
  try {
    const fs = require('fs');
    const path = require('path');
    const pagePath = path.join(__dirname, 'index.html');
    if (fs.existsSync(pagePath)) {
      return fs.readFileSync(pagePath, 'utf-8');
    }
  } catch (e) {}
  return '<!DOCTYPE html><html><head><title>VELCERPA</title></head><body><h1>VELCERPA</h1></body></html>';
}

// ==================== 自动保活 ====================
async function autoAccess() {
  if (!AUTO_ACCESS) return;
  try {
    const urls = AUTO_ACCESS.split(',').map(u => u.trim()).filter(u => u);
    for (const url of urls) {
      await axios.get(url, { timeout: 10000 });
    }
  } catch (e) {}
}

// ==================== 启动 ====================
server.listen(0, () => {
  console.log(`[Server] Listening`);
  console.log(`[Server] UUID: ${UUIDS.length} configured`);
  console.log(`[Server] WSPATH: ${WSPATHS.join(', ')}`);
  console.log(`[Server] TLS: ${TLS_ENABLE}`);

  startNezha();

  if (AUTO_ACCESS) {
    setInterval(autoAccess, 60000);
    autoAccess();
  }
});

process.on('SIGTERM', () => {
  console.log('[Server] Shutting down');
  stopGrpcServer();
  process.exit(0);
});