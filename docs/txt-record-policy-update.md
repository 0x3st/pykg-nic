# TXT Record Policy Update

## 变更说明

将TXT记录的限制策略从"只允许ACME验证记录"改为"允许所有TXT记录，但禁止邮箱相关的TXT记录"。

## 修改内容

### 1. 新增邮箱相关TXT检测函数 (`functions/lib/validators.ts`)

添加了 `isEmailRelatedTxtRecord()` 函数，用于检测以下类型的邮箱相关TXT记录：

#### 按子域名检测：
- `_dmarc` - DMARC记录
- `_domainkey` - DKIM记录
- `dkim` - DKIM变体
- `_spf` - SPF记录子域
- `mail`, `smtp`, `email` - 邮件相关子域
- `_mta-sts` - MTA-STS策略
- `_smtp._tls` - SMTP TLS报告
- `default._domainkey` - 常见DKIM选择器

#### 按记录内容检测：
- **SPF记录**：内容包含 `v=spf1` 或 `spf2.0/`
- **DKIM记录**：内容包含 `v=dkim1` 或 `k=rsa`
- **DMARC记录**：内容包含 `v=dmarc1`
- **邮箱服务验证**：
  - `protonmail-verification=`
  - `zoho-verification=`
  - `mailgun-verification=`
  - `sendgrid-verification=`

### 2. 更新用户DNS记录API (`functions/api/dns-records.ts`)

**修改前：**
```typescript
const ALLOWED_TXT_PREFIXES = ['_acme-challenge'];
// 只允许 _acme-challenge 开头的TXT记录
```

**修改后：**
- 移除了 `ALLOWED_TXT_PREFIXES` 限制
- 添加了邮箱相关TXT记录检测
- 允许所有非邮箱相关的TXT记录

### 3. 更新管理员DNS记录API (`functions/api/admin/dns-records.ts`)

- 添加了邮箱相关TXT记录的警告日志
- 管理员仍可以修改任何记录（包括邮箱相关的），但会在日志中记录警告

## 使用示例

### ✅ 允许的TXT记录：

```javascript
// ACME证书验证
{ name: "_acme-challenge", content: "xxx" }

// 站点验证
{ name: "@", content: "google-site-verification=yyy" }

// 自定义验证记录
{ name: "verify", content: "my-custom-verification-token" }

// 其他用途的TXT记录
{ name: "_github-challenge", content: "xxx" }
{ name: "test", content: "some text content" }
```

### ❌ 禁止的TXT记录：

```javascript
// SPF记录
{ name: "@", content: "v=spf1 include:_spf.example.com ~all" }

// DKIM记录
{ name: "default._domainkey", content: "v=DKIM1; k=rsa; p=xxx" }

// DMARC记录
{ name: "_dmarc", content: "v=DMARC1; p=none; rua=mailto:xxx" }

// 邮件子域的TXT记录
{ name: "mail", content: "anything" }
{ name: "_domainkey.selector", content: "anything" }
```

## 安全考虑

1. **防止邮件滥用**：通过禁止SPF/DKIM/DMARC记录，防止用户使用免费域名发送垃圾邮件
2. **双重检测**：同时检测子域名和记录内容，防止绕过
3. **管理员审计**：管理员修改时会记录警告日志，便于事后审计
4. **区块链日志**：所有DNS记录操作都会记录到不可篡改的区块链日志中

## 部署说明

修改的文件：
- `functions/lib/validators.ts` - 新增检测函数
- `functions/api/dns-records.ts` - 更新用户API
- `functions/api/admin/dns-records.ts` - 更新管理员API

无需数据库迁移，直接部署即可生效。
