# VELCERPA-VER

> Vercel + Cloudflare Worker 高效节点部署方案
> 学习研究用途，非商业用途

## 架构总览

```
用户浏览器
    ↓
CF Worker.js（域名A）── ASN检测 + 动态路由 + 多项目分发
    ↓ 转发
Vercel Node.js（index.js）
    ├── GET /          → 伪装页（在线工具站）
    ├── GET /vercel    → 订阅链接生成（VLESS + Trojan + SS）
    └── WS /{UUID}     → WebSocket 代理连接（三协议）
```

## 文件结构

```
VELCERPA-VER/
├── README.md              ← 本文件
├── index.js               ← Vercel 代理服务器（三协议）
├── index.html             ← 伪装页（在线工具站）
├── vercel.json            ← Vercel 部署配置
├── package.json           ← Node.js 依赖
└── cf-worker.js           ← CF Worker 反代脚本（增强版）
```

## 部署流程

### 第一步：部署 Vercel

1. Fork 或 Clone 本仓库到 GitHub 私有仓库
2. 修改 `index.js` 中的环境变量：
   - `UUID`：你的节点 UUID
   - `DOMAIN`：CF 反代域名（部署后填入）
   - `NEZHA_SERVER` / `NEZHA_KEY`：哪吒监控（可选）
3. 替换 `index.html` 为你喜欢的伪装页
4. 用 https://www.jshaman.com/ 混淆 `index.js`
5. 打开 Vercel → New Project → Import → Deploy

### 第二步：部署 CF Worker

1. Cloudflare → Workers & Pages → Create Worker
2. 将 `cf-worker.js` 内容粘贴进去
3. 修改 `arrStr` 中的 Vercel 域名
4. 部署 Worker
5. 添加自定义域名（DNS → 加一条 CNAME 指向 Worker）

### 第三步：配置节点

1. 获取订阅链接：`https://你的域名/vercel`
2. 导入 V2RayN / Streisand 等客户端
3. 测试连接

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| UUID | 节点 UUID | ✅ |
| DOMAIN | CF 反代域名 | ✅ |
| NEZHA_SERVER | 哪吒监控地址 | ❌ |
| NEZHA_KEY | 哪吒监控密钥 | ❌ |
| AUTO_ACCESS | 自动保活 | ❌ |
| SUB_PATH | 订阅路径 | ❌ |
| NAME | 节点名前缀 | ❌ |

## 注意事项

- Vercel 免费版 maxDuration 300 秒
- 免费版禁止商业用途
- 代理连接超过 300 秒会被切断
- 哪吒监控注意不暴露真实 IP

---

*本方案仅供学习研究网络架构和云服务特性，非商业用途。*