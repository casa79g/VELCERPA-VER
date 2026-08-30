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
    ├── GET /vercel    → 订阅链接生成
    └── WS /{UUID}     → WebSocket 代理
```

## 文件结构

```
VELCERPA-VER/
├── README.md              ← 本文件
├── index.js               ← Vercel 应用服务器（HTTP + WebSocket）
├── index.html             ← 前端页面（伪装页）
├── vercel.json            ← Vercel 部署配置
├── package.json           ← Node.js 依赖
├── cf-worker.js           ← CF Worker 反代脚本（ASN 路由）
└── nezha.js               ← (备用) Nezha 上报模块，供 CF Worker 调用
```

## 部署流程

### 第一步：部署 Vercel

1. Fork 或 Clone 本仓库到 GitHub 私有仓库
2. 修改 `index.js` 中的环境变量：
   - `UUID`：你的应用 UUID（支持逗号分隔多个）
   - `DOMAIN`：CF 反代域名（部署后填入）
   - `SUB_PATH`：订阅路径（默认 `/vercel`）
   - `WSPATH`：WebSocket 路径（默认等于 UUID）
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
2. 访问订阅链接：`https://你的域名/vercel`
3. WebSocket 代理：`wss://你的域名/{UUID}`

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| UUID | 应用 UUID（支持多 UUID，逗号分隔） | ✅ |
| DOMAIN | CF 反代域名 | ✅ |
| SUB_PATH | 订阅路径（默认 `/vercel`） | ❌ |
| WSPATH | WebSocket 路径（默认等于 UUID） | ❌ |

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

### Vercel 超时限制

| 套餐 | 最大执行时间 | 备注 |
|------|-------------|------|
| Hobby（免费） | 10 秒 | HTTP 请求超时，WebSocket 受 300 秒 maxDuration 限制 |
| Pro ($20/月) | 60 秒 | 设置 `maxDuration: 300` 延长到 300 秒 |
| Enterprise | 900 秒 | 需申请开通 |

> ⚠️ Vercel 不适合长时间持续传输的数据（如 4K 视频）。  
> 建议：短请求（订阅生成、网页浏览）走 Vercel；大流量（视频、下载）走 CF 隧道。

---

*本方案仅供学习研究网络架构和云服务特性，非商业用途。*
