# PY.KG NIC - 子域名注册局

基于 Cloudflare Pages + D1 + Cloudflare DNS 的子域名注册与 DNS 管理平台，支持 LinuxDO Credit 支付。

## 功能特性

### 用户功能
- LinuxDO OAuth2 登录认证
- LinuxDO Credit 积分支付
- 每用户一个子域名配额
- DNS 记录管理（A/AAAA/CNAME/TXT）
- 域名暂停申诉
- 域名滥用举报
- 站内消息（与管理员沟通）
- 通知中心

### 管理功能
- 用户管理（封禁/解封/设置管理员）
- 域名管理（暂停/激活/删除/DNS 管理）
- 审核管理（敏感词触发的域名审核）
- 申诉管理（处理用户申诉）
- 举报管理（处理滥用举报）
- 敏感词管理
- 系统设置
- 公告广播
- 站内消息管理

### 公共功能
- WHOIS 查询
- 黑名单查询
- 区块链日志记录
- 完整的审计日志

## 目录结构

```
pykg-nic/
├── public/
│   ├── index.html              # 用户前端页面
│   ├── admin.html              # 管理后台页面
│   ├── whois.html              # WHOIS 查询页面
│   ├── blacklist.html          # 黑名单查询页面
│   ├── logs.html               # 区块链日志页面
│   ├── terms.html              # 服务条款页面
│   └── repair-blockchain.html  # 区块链修复工具
├── functions/
│   ├── lib/
│   │   ├── types.ts            # 类型定义
│   │   ├── auth.ts             # 认证中间件
│   │   ├── jwt.ts              # JWT 处理
│   │   ├── cloudflare-dns.ts   # Cloudflare DNS API 客户端
│   │   ├── credit.ts           # LinuxDO Credit 支付
│   │   ├── moderation.ts       # 内容审核
│   │   ├── validators.ts       # 输入验证
│   │   ├── blockchain.ts       # 区块链日志
│   │   ├── notifications.ts    # 通知系统
│   │   ├── messages.ts         # 消息系统
│   │   └── reserved-words.ts   # 保留词列表
│   ├── auth/
│   │   ├── login.ts            # OAuth2 登录入口
│   │   ├── callback.ts         # OAuth2 回调处理
│   │   └── logout.ts           # 登出
│   └── api/
│       ├── me.ts               # 用户信息 API
│       ├── domains.ts          # 域名注册/管理 API
│       ├── dns-records.ts      # DNS 记录管理 API
│       ├── dns-records/[id].ts # 单条 DNS 记录操作
│       ├── ns.ts               # NS 记录管理 API（已弃用）
│       ├── whois.ts            # WHOIS 查询 API
│       ├── blacklist.ts        # 黑名单查询 API
│       ├── logs.ts             # 区块链日志 API
│       ├── notifications.ts    # 通知 API
│       ├── messages.ts         # 站内消息 API
│       ├── appeals.ts          # 申诉 API
│       ├── reports.ts          # 举报 API
│       ├── orders/             # 订单管理 API
│       ├── payment/            # 支付回调 API
│       └── admin/              # 管理后台 API
│           ├── stats.ts        # 统计数据
│           ├── users.ts        # 用户管理
│           ├── domains.ts      # 域名管理
│           ├── domains/[id]/dns.ts # 管理员 DNS 管理
│           ├── dns-records.ts  # 管理员 DNS 记录管理
│           ├── reviews.ts      # 审核管理
│           ├── appeals.ts      # 申诉管理
│           ├── reports.ts      # 举报管理
│           ├── messages.ts     # 站内消息管理
│           ├── announcements.ts # 公告广播
│           ├── banned-words.ts # 敏感词管理
│           ├── settings.ts     # 系统设置
│           ├── promote.ts      # 管理员提升
│           └── repair-blockchain.ts # 区块链修复
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

### NS 记录 API（已弃用）

> **注意**：NS 记录 API 已弃用，请使用 DNS 记录 API 管理 A/AAAA/CNAME/TXT 记录。

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

### DNS 记录 API

#### GET /api/dns-records

获取当前用户域名的所有 DNS 记录。

**响应：**
```json
{
  "success": true,
  "data": {
    "dns_mode": "direct",
    "records": [
      {
        "id": 1,
        "type": "A",
        "name": "@",
        "content": "1.2.3.4",
        "ttl": 3600,
        "proxied": false
      }
    ]
  }
}
```

#### POST /api/dns-records

添加 DNS 记录（最多 10 条）。

**请求：**
```json
{
  "type": "A",
  "name": "@",
  "content": "1.2.3.4",
  "ttl": 3600,
  "proxied": false
}
```

**支持的记录类型：**
- `A` - IPv4 地址
- `AAAA` - IPv6 地址
- `CNAME` - 别名记录
- `TXT` - 文本记录（禁止邮件相关记录如 SPF、DKIM、DMARC）

#### PUT /api/dns-records/:id

更新指定 DNS 记录。

#### DELETE /api/dns-records/:id

删除指定 DNS 记录。

### 通知 API

#### GET /api/notifications

获取用户通知列表。

**查询参数：**
- `unread_only`: `true` 仅返回未读通知

**响应：**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": 1,
        "type": "domain_approved",
        "title": "域名已激活",
        "message": "您的域名 example.py.kg 已激活",
        "is_read": false,
        "created_at": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

#### POST /api/notifications

标记通知为已读。

**请求：**
```json
{
  "id": 1
}
```

或标记全部已读：
```json
{
  "mark_all": true
}
```

#### DELETE /api/notifications

删除通知。

**请求：**
```json
{
  "id": 1
}
```

或删除所有已读通知：
```json
{
  "delete_all_read": true
}
```

### 消息 API

#### GET /api/messages

获取与管理员的对话消息。

**查询参数：**
- `check_only`: `true` 仅检查未读数，不标记已读

**响应：**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": 1,
        "sender_id": 12345,
        "sender_type": "user",
        "sender_username": "example",
        "content": "你好",
        "is_read": true,
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "conversation": {
      "id": 1,
      "unread_user_count": 0
    }
  }
}
```

#### POST /api/messages

发送消息给管理员。

**请求：**
```json
{
  "content": "你好，我有一个问题..."
}
```

### 申诉 API

#### GET /api/appeals

获取用户的申诉记录。

**响应：**
```json
{
  "success": true,
  "data": {
    "appeals": [
      {
        "id": 1,
        "domain_id": 1,
        "label": "example",
        "fqdn": "example.py.kg",
        "reason": "申诉原因...",
        "status": "pending",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

#### POST /api/appeals

提交域名暂停申诉（仅当域名处于暂停状态时可用）。

**请求：**
```json
{
  "reason": "申诉原因，至少10个字符..."
}
```

### 举报 API

#### POST /api/reports

举报域名滥用。

**请求：**
```json
{
  "label": "example",
  "reason": "举报原因..."
}
```

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

#### GET /api/admin/appeals

获取申诉列表。

**查询参数：**
- `status`: `pending` | `approved` | `rejected`
- `limit`: 每页数量

**响应：**
```json
{
  "success": true,
  "data": {
    "appeals": [
      {
        "id": 1,
        "domain_id": 1,
        "label": "example",
        "fqdn": "example.py.kg",
        "username": "user1",
        "reason": "申诉原因...",
        "status": "pending",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

#### POST /api/admin/appeals

处理申诉。

**请求：**
```json
{
  "id": 1,
  "action": "approve",
  "admin_note": "管理员备注"
}
```

- `action`: `approve` 批准（解除域名暂停）| `reject` 拒绝

#### GET /api/admin/reports

获取举报列表。

**查询参数：**
- `status`: `pending` | `resolved` | `rejected`
- `limit`: 每页数量

#### POST /api/admin/reports

处理举报（支持批量操作）。

**请求：**
```json
{
  "ids": [1, 2, 3],
  "actions": {
    "ban_reporter": false,
    "ban_reported_user": false,
    "suspend_domain": true,
    "delete_domain": false,
    "close_report": true
  },
  "reason": "处理原因"
}
```

#### GET /api/admin/messages

获取所有对话列表或指定对话的消息。

**查询参数：**
- `conversation_id`: 指定对话 ID（可选）

#### POST /api/admin/messages

向用户发送消息。

**请求：**
```json
{
  "conversation_id": 1,
  "content": "消息内容..."
}
```

#### POST /api/admin/announcements

向所有用户广播公告。

**请求：**
```json
{
  "title": "公告标题",
  "message": "公告内容..."
}
```

#### POST /api/admin/promote

自助提升为管理员（需要 ADMIN_SECRET）。

**请求：**
```json
{
  "secret": "管理员密钥"
}
```

#### POST /api/admin/repair-blockchain

修复区块链日志（重新计算哈希链）。

## 数据库表结构

### users
用户表，存储 LinuxDO 用户信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| linuxdo_id | INTEGER | 主键，LinuxDO 用户 ID |
| username | TEXT | 用户名 |
| trust_level | INTEGER | 信任等级 |
| silenced | INTEGER | 是否被禁言 |
| active | INTEGER | 是否活跃 |
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
| review_reason | TEXT | 审核原因 |
| suspend_reason | TEXT | 暂停原因 |
| dns_mode | TEXT | DNS 模式：ns/direct |

### dns_records
DNS 记录表，存储用户的 DNS 记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| domain_id | INTEGER | 关联域名 ID |
| type | TEXT | 记录类型：A/AAAA/CNAME/TXT |
| name | TEXT | 记录名称（@ 表示根域名） |
| content | TEXT | 记录内容 |
| ttl | INTEGER | TTL 值 |
| proxied | INTEGER | 是否启用 Cloudflare 代理 |
| cloudflare_record_id | TEXT | Cloudflare 记录 ID |
| cf_synced | INTEGER | 是否已同步到 Cloudflare |

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

### notifications
通知表，存储用户通知。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| linuxdo_id | INTEGER | 用户 ID |
| type | TEXT | 通知类型 |
| title | TEXT | 通知标题 |
| message | TEXT | 通知内容 |
| is_read | INTEGER | 是否已读 |

### conversations
对话表，存储用户与管理员的对话。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| user_id | INTEGER | 用户 ID |
| last_message_at | TEXT | 最后消息时间 |
| last_message_preview | TEXT | 最后消息预览 |
| unread_admin_count | INTEGER | 管理员未读数 |
| unread_user_count | INTEGER | 用户未读数 |

### messages
消息表，存储对话中的消息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| conversation_id | INTEGER | 对话 ID |
| sender_id | INTEGER | 发送者 ID |
| sender_type | TEXT | 发送者类型：user/admin |
| content | TEXT | 消息内容 |
| is_read | INTEGER | 是否已读 |

### appeals
申诉表，存储域名暂停申诉。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| domain_id | INTEGER | 域名 ID |
| linuxdo_id | INTEGER | 用户 ID |
| reason | TEXT | 申诉原因 |
| status | TEXT | 状态：pending/approved/rejected |
| reviewed_by | INTEGER | 审核人 ID |
| admin_note | TEXT | 管理员备注 |

### reports
举报表，存储域名滥用举报。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| label | TEXT | 被举报的域名标签 |
| reporter_linuxdo_id | INTEGER | 举报人 ID |
| reason | TEXT | 举报原因 |
| status | TEXT | 状态：pending/resolved/rejected |
| resolved_by | INTEGER | 处理人 ID |

### blockchain_logs
区块链日志表，记录所有重要操作的不可篡改日志。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| action | TEXT | 操作类型 |
| actor_name | TEXT | 操作者名称 |
| target_type | TEXT | 目标类型 |
| target_name | TEXT | 目标名称 |
| details | TEXT | 详细信息（JSON） |
| prev_hash | TEXT | 前一条记录的哈希 |
| hash | TEXT | 当前记录的哈希 |

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
11. **区块链日志**：不可篡改的操作记录
12. **邮件记录限制**：禁止创建 SPF/DKIM/DMARC 等邮件相关 TXT 记录

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
