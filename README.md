# PY.KG NIC - 子域名注册局

基于 Cloudflare Pages + D1 + Cloudflare DNS 的子域名注册与 NS 委派平台，支持 LinuxDO Credit 支付。

## 功能特性

- LinuxDO OAuth2 登录认证
- LinuxDO Credit 积分支付
- 每用户一个子域名配额
- NS 记录委派管理
- 内容审核（敏感词过滤 + 人工审核）
- 管理后台（用户/域名/审核/设置管理）
- 完整的审计日志

## 目录结构

```
pykg-nic/
├── public/
│   ├── index.html              # 用户前端页面
│   └── admin.html              # 管理后台页面
├── functions/
│   ├── lib/
│   │   ├── types.ts            # 类型定义
│   │   ├── auth.ts             # 认证中间件
│   │   ├── cloudflare-dns.ts   # Cloudflare DNS API 客户端
│   │   ├── credit.ts           # LinuxDO Credit 支付
│   │   └── moderation.ts       # 内容审核
│   ├── auth/
│   │   ├── login.ts            # OAuth2 登录入口
│   │   ├── callback.ts         # OAuth2 回调处理
│   │   └── logout.ts           # 登出
│   └── api/
│       ├── me.ts               # 用户信息 API
│       ├── domains.ts          # 域名注册/管理 API
│       ├── ns.ts               # NS 记录管理 API
│       ├── orders/             # 订单管理 API
│       ├── payment/            # 支付回调 API
│       └── admin/              # 管理后台 API
│           ├── stats.ts        # 统计数据
│           ├── users.ts        # 用户管理
│           ├── domains.ts      # 域名管理
│           ├── reviews.ts      # 审核管理
│           ├── banned-words.ts # 敏感词管理
│           └── settings.ts     # 系统设置
├── schema.sql                  # D1 数据库 Schema
├── wrangler.jsonc              # Wrangler 配置
├── package.json
└── README.md
```

## 前置要求

1. Cloudflare 账号
2. LinuxDO Connect OAuth2 应用（需要 client_id 和 client_secret）
3. LinuxDO Credit 商户账号（用于支付）
4. PY.KG 域名已托管在 Cloudflare DNS

## 部署步骤

### 1. 创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create pykg-nic-db

# 记录返回的 database_id，更新到 wrangler.jsonc
```

### 2. 初始化数据库 Schema

```bash
# 本地开发环境
wrangler d1 execute pykg-nic-db --local --file=./schema.sql

# 生产环境
wrangler d1 execute pykg-nic-db --remote --file=./schema.sql
```

### 3. 配置环境变量

在 Cloudflare Dashboard 中配置 Pages 项目的环境变量（Settings > Environment variables）：

**必需的 Secrets（加密存储）：**

| 变量名 | 说明 |
|--------|------|
| `LINUXDO_CLIENT_ID` | LinuxDO Connect OAuth2 Client ID |
| `LINUXDO_CLIENT_SECRET` | LinuxDO Connect OAuth2 Client Secret |
| `JWT_SIGNING_KEY` | JWT 签名密钥（建议 32+ 字符随机字符串） |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需要 DNS 编辑权限） |
| `CLOUDFLARE_ZONE_ID` | PY.KG 域名的 Zone ID |
| `CREDIT_PID` | LinuxDO Credit 商户 Client ID |
| `CREDIT_KEY` | LinuxDO Credit 商户 Client Secret |

**⚠️ 注意变量名**：支付相关的环境变量名为 `CREDIT_PID` 和 `CREDIT_KEY`（不是 `LINUXDO_CREDIT_CLIENT_ID/SECRET`）

**可选的环境变量：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `BASE_DOMAIN` | `py.kg` | 基础域名 |
| `SESSION_COOKIE_NAME` | `session` | Session Cookie 名称 |
| `ADMIN_LINUXDO_IDS` | - | 管理员 LinuxDO ID（逗号分隔） |
| `ADMIN_SECRET` | - | 管理员提升密钥（用于自助提升） |

生成 JWT 签名密钥：
```bash
openssl rand -base64 32
```

### 4. 部署到 Cloudflare Pages

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 部署到生产
npm run deploy
```

### 5. 绑定自定义域名

1. 在 Cloudflare Pages 项目设置中添加自定义域名：`nic.py.kg`
2. 配置 DNS 记录指向 Pages 项目

### 6. 配置 LinuxDO OAuth2 回调地址

在 LinuxDO Connect 应用设置中，配置回调地址：
- 生产环境：`https://nic.py.kg/auth/callback`
- 测试环境：`https://pykg-nic.pages.dev/auth/callback`

### 7. 配置 LinuxDO Credit 支付回调 ⚠️ 重要

前往 [LinuxDO 集市中心](https://meta.linux.do/market)，在你的 Credit 应用配置中设置：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| **异步通知地址 (notify_url)** | `https://nic.py.kg/api/payment/notify` | 用于接收支付成功的服务器回调 |
| **同步返回地址 (return_url)** | `https://nic.py.kg/api/payment/return` | 用户支付完成后的跳转地址 |

**⚠️ 注意**：LinuxDO Credit 实际使用的是控制台配置的 URL，API 请求中传递的 URL 仅参与签名验证。

## 本地开发

```bash
# 安装依赖
npm install

# 启动本地开发服务器
npm run dev

# 访问 http://localhost:8788
```

## API 文档

### 认证

所有 `/api/*` 端点需要有效的 JWT Session Cookie。

### 用户 API

#### GET /api/me

获取当前用户信息和配额。

**响应：**
```json
{
  "success": true,
  "data": {
    "user": {
      "linuxdo_id": 12345,
      "username": "example",
      "trust_level": 2,
      "is_admin": false
    },
    "price": 10,
    "quota": {
      "maxDomains": 1,
      "used": 0
    }
  }
}
```

### 域名 API

#### GET /api/domains

获取当前用户的域名或待处理订单。

**响应（有域名）：**
```json
{
  "success": true,
  "data": {
    "domain": {
      "label": "example",
      "fqdn": "example.py.kg",
      "status": "active",
      "nameservers": ["ns1.example.com.", "ns2.example.com."],
      "created_at": "2024-01-01T00:00:00Z"
    }
  }
}
```

**响应（有待支付订单）：**
```json
{
  "success": true,
  "data": {
    "pendingOrder": {
      "order_no": "ORD123456",
      "label": "example",
      "amount": 10,
      "created_at": "2024-01-01T00:00:00Z"
    }
  }
}
```

#### POST /api/domains

创建域名注册订单（需支付）。

**请求：**
```json
{
  "label": "example"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "order_no": "ORD123456",
    "payment_url": "https://credit.linux.do/pay/..."
  }
}
```

#### DELETE /api/domains

删除当前用户的域名。

### NS 记录 API

#### GET /api/ns

获取域名的 NS 记录。

**响应：**
```json
{
  "success": true,
  "data": {
    "nameservers": ["ns1.example.com.", "ns2.example.com."]
  }
}
```

#### PUT /api/ns

设置 NS 记录（需要 2-8 个 NS 服务器）。

**请求：**
```json
{
  "nameservers": ["ns1.example.com.", "ns2.example.com."]
}
```

#### DELETE /api/ns

清除所有 NS 记录。

### 订单 API

#### DELETE /api/orders/:order_no

取消待支付订单。

### 管理员 API

所有管理员 API 需要管理员权限。

#### GET /api/admin/stats

获取统计数据。

**响应：**
```json
{
  "success": true,
  "data": {
    "totalUsers": 100,
    "totalDomains": 50,
    "pendingReviews": 5,
    "totalOrders": 60,
    "totalRevenue": 600
  }
}
```

#### GET /api/admin/users

获取用户列表。

**查询参数：**
- `search`: 搜索用户名或 ID
- `filter`: `all` | `banned` | `admin`
- `limit`: 每页数量（默认 50，最大 100）
- `offset`: 偏移量

#### POST /api/admin/users

管理用户（封禁/解封/设置管理员）。

**请求：**
```json
{
  "linuxdo_id": 12345,
  "action": "ban" | "unban" | "set_admin" | "remove_admin",
  "reason": "封禁原因"
}
```

#### GET /api/admin/domains

获取域名列表。

**查询参数：**
- `search`: 搜索域名或用户名
- `status`: `all` | `active` | `suspended` | `pending` | `review`
- `limit`: 每页数量
- `offset`: 偏移量

#### POST /api/admin/domains

管理域名（暂停/激活/删除）。

**请求：**
```json
{
  "id": 1,
  "action": "suspend" | "activate" | "delete",
  "reason": "暂停原因"
}
```

#### GET /api/admin/reviews

获取待审核列表。

**查询参数：**
- `status`: `pending` | `approved` | `rejected`
- `limit`: 每页数量
- `offset`: 偏移量

#### POST /api/admin/reviews

审核域名申请。

**请求：**
```json
{
  "id": 1,
  "action": "approve" | "reject",
  "banUser": false
}
```

#### GET /api/admin/banned-words

获取敏感词列表。

#### POST /api/admin/banned-words

添加敏感词。

**请求：**
```json
{
  "word": "example",
  "category": "reserved" | "inappropriate" | "general"
}
```

#### DELETE /api/admin/banned-words

删除敏感词。

**请求：**
```json
{
  "id": 1
}
```

#### GET /api/admin/settings

获取系统设置。

#### PUT /api/admin/settings

更新系统设置。

**请求：**
```json
{
  "domain_price": "10",
  "require_review": "false"
}
```

## 数据库表结构

### users
用户表，存储 LinuxDO 用户信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| linuxdo_id | INTEGER | 主键，LinuxDO 用户 ID |
| username | TEXT | 用户名 |
| trust_level | INTEGER | 信任等级 |
| is_admin | INTEGER | 是否管理员 |
| is_banned | INTEGER | 是否被封禁 |
| ban_reason | TEXT | 封禁原因 |

### domains
域名表，每用户最多一个域名。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| label | TEXT | 子域名标签（唯一） |
| fqdn | TEXT | 完整域名（唯一） |
| owner_linuxdo_id | INTEGER | 所有者 ID（唯一） |
| status | TEXT | 状态：pending/active/suspended/review |

### orders
订单表，记录支付订单。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| order_no | TEXT | 订单号（唯一） |
| trade_no | TEXT | 支付平台交易号 |
| linuxdo_id | INTEGER | 用户 ID |
| label | TEXT | 申请的域名标签 |
| amount | REAL | 金额 |
| status | TEXT | 状态：pending/paid/failed/refunded |

### pending_reviews
待审核表，存储需要人工审核的域名申请。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| order_no | TEXT | 关联订单号 |
| linuxdo_id | INTEGER | 用户 ID |
| label | TEXT | 申请的域名标签 |
| reason | TEXT | 需要审核的原因 |
| status | TEXT | 状态：pending/approved/rejected |

### banned_words
敏感词表。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| word | TEXT | 敏感词（唯一） |
| category | TEXT | 分类：reserved/inappropriate/general |

### settings
系统设置表。

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 设置键（主键） |
| value | TEXT | 设置值 |

### audit_logs
审计日志表。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| linuxdo_id | INTEGER | 操作者 ID |
| action | TEXT | 操作类型 |
| target | TEXT | 操作目标 |
| details | TEXT | 详细信息（JSON） |
| ip_address | TEXT | IP 地址 |

## 安全措施

### 已实现的安全措施

1. **OAuth2 State 校验**：防止 CSRF 攻击
2. **HttpOnly Cookie**：Session Token 存储在 HttpOnly Cookie 中
3. **SameSite=Lax**：防止 CSRF 攻击
4. **JWT 验签与过期校验**：使用 HMAC-SHA256
5. **Trust Level 校验**：仅允许 TL >= 2 的用户
6. **Silenced/Suspended 检查**：禁止被禁言或封禁的用户
7. **敏感词过滤**：自动检测并标记敏感域名
8. **人工审核机制**：可疑域名需要管理员审核
9. **审计日志**：记录所有关键操作
10. **管理员双重验证**：环境变量 + 数据库标记

### 建议的额外安全措施

1. **Rate Limiting**：使用 Cloudflare Rate Limiting 规则
2. **WAF 规则**：启用 Cloudflare WAF 防护
3. **监控告警**：监控异常注册行为

## 故障排除

### OAuth2 回调失败

1. 检查回调地址是否正确配置
2. 检查 LINUXDO_CLIENT_ID 和 LINUXDO_CLIENT_SECRET 是否正确
3. 查看 Cloudflare Pages 日志

### 支付回调失败

1. 检查 CREDIT_PID 和 CREDIT_KEY 环境变量是否正确配置
2. 确认 LinuxDO Credit 控制台中的 notify_url 和 return_url 配置正确
3. 确认支付回调地址可访问（`/api/payment/notify` 和 `/api/payment/return`）
4. 检查 Cloudflare Pages 函数日志，查看回调是否到达
5. 检查订单状态（是否已支付但域名未创建）

### DNS 记录更新失败

1. 检查 CLOUDFLARE_API_TOKEN 权限
2. 确认 CLOUDFLARE_ZONE_ID 正确
3. 检查 Cloudflare API 配额

### D1 数据库错误

1. 确认 database_id 配置正确
2. 确认 Schema 已初始化
3. 检查 D1 绑定是否正确

## License

MIT
