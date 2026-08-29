# VELCERPA-VER

> Vercel + Cloudflare Worker 应用部署方案
> 学习研究用途，非商业用途

## 架构总览

```
用户浏览器
    ↓
CF Worker.js（域名A）── ASN检测 + 动态路由 + 多项目分发
    ↓ 转发
Vercel Node.js（index.js）
    ├── GET /          → 应用页面（在线工具站）
    ├── GET /vercel    → API 端点
    └── WS /{UUID}     → WebSocket 连接
```

## 文件结构

```
VELCERPA-VER/
├── README.md              ← 本文件
├── index.js               ← Vercel 应用服务器
├── index.html             ← 前端页面（在线工具站）
├── vercel.json            ← Vercel 部署配置
├── package.json           ← Node.js 依赖
├── cf-worker.js           ← CF Worker 反代脚本（增强版）
└── nezha.js               ← 监控模块（可选）
```

## 部署流程

### 第一步：部署 Vercel

1. Fork 或 Clone 本仓库到 GitHub 私有仓库
2. 修改 `index.js` 中的环境变量：
   - `UUID`：你的应用 UUID
   - `DOMAIN`：CF 反代域名（部署后填入）
   - `NEZHA_SERVER` / `NEZHA_KEY`：监控模块（可选）
3. 替换 `index.html` 为你喜欢的前端页面
4. 用 https://www.jshaman.com/ 混淆 `index.js`
5. 打开 Vercel → New Project → Import → Deploy

### 第二步：部署 CF Worker

1. Cloudflare → Workers & Pages → Create Worker
2. 将 `cf-worker.js` 内容粘贴进去
3. 修改 `cf-worker.js` 中的路由配置：
   - `ASN_ROUTES`：ASN 到 Vercel 项目的映射（中国电信→项目A，联通→项目B）
   - `FALLBACK_PROJECTS`：未知 ASN 时的备用项目列表
4. 部署 Worker
5. 添加自定义域名（DNS → 加一条 CNAME 指向 Worker）

### 第三步：使用

1. 访问应用页面：`https://你的域名/`
2. 访问 API 端点：`https://你的域名/vercel`
3. 测试连接

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| UUID | 应用 UUID | ✅ |
| DOMAIN | CF 反代域名 | ✅ |
| NEZHA_SERVER | 监控地址 | ❌ |
| NEZHA_KEY | 监控密钥 | ❌ |
| AUTO_ACCESS | 自动保活 | ❌ |
| SUB_PATH | API 路径 | ❌ |
| NAME | 应用名前缀 | ❌ |

## CF Worker 配置说明

### ASN 路由（运营商感知）

CF Worker 自动获取访问者的 ASN（`request.cf.asn`），根据运营商路由到对应项目：

| ASN | 运营商 | 示例配置 |
|-----|--------|---------|
| 4134 | 中国电信 | `project-a.vercel.app` |
| 9929 | 中国联通 | `project-b.vercel.app` |
| 4808 | 中国移动 | `project-c.vercel.app` |
| 4538 | 教育网 | `project-d.vercel.app` |
| 其他 | 未知/国外 | 随机分发到 `FALLBACK_PROJECTS` |

修改 `cf-worker.js` 中的 `ASN_ROUTES` 对象即可调整映射关系。

### 限流说明

- 限流基于内存 `Map`，**仅对单实例有效**
- CF Worker 会水平扩展，多个实例之间不共享状态
- 如需全局限流，需使用 CF Rate Limiting 规则或 KV 存储

### 注意事项

- Vercel 免费版 maxDuration 300 秒（仅 Pro 及以上套餐生效）
- 免费版禁止商业用途
- 监控模块注意不暴露真实 IP

---

*本方案仅供学习研究网络架构和云服务特性，非商业用途。*
