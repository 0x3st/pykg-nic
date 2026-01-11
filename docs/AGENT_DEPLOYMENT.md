# AI Agent 部署指南

## 已完成的工作

### 1. 备份文件 ✅
- `public/backup/index.html.bak`
- `public/backup/admin.html.bak`
- `public/backup/backup_timestamp.txt`

### 2. 后端实现 ✅
创建的新文件：
- `functions/lib/ai-client.ts` - DeepSeek V3.2 API 客户端
- `functions/lib/agent-tools.ts` - Agent 工具函数定义和执行器
- `functions/lib/agent-prompts.ts` - 系统提示词
- `functions/api/agent/chat.ts` - 对话 API 端点
- `functions/api/agent/context.ts` - 对话历史 API 端点

### 3. 数据库扩展 ✅
- 更新了 `schema.sql`
- 创建了迁移文件 `migrations/001_add_agent_conversations.sql`

### 4. 前端界面 ✅
- 创建了 `public/agent.html` - 独立的 AI 聊天页面
- 更新了 `public/index.html` - 添加了右下角浮动按钮

### 5. 类型定义更新 ✅
- 在 `functions/lib/types.ts` 中添加了 `DEEPSEEK_API_KEY`

## 部署步骤

### 第一步：获取 DeepSeek API Key

1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 注册/登录账号
3. 创建 API Key
4. 复制 API Key（格式：`sk-...`）

**价格参考：**
- 输入：¥1 / 1M tokens
- 输出：¥2 / 1M tokens
- 预计月成本：¥60-120（基于 100 用户/天）

### 第二步：配置环境变量

在 Cloudflare Dashboard 中配置：

**路径：** Workers & Pages > pykg-nic > Settings > Environment Variables

添加新环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DEEPSEEK_API_KEY` | `sk-xxxxxxxxxx` | DeepSeek API Key（必需） |

**注意：** 确保在 Production 和 Preview 环境都添加此变量。

### 第三步：更新数据库

#### 选项 A：对于新数据库（推荐）
```bash
# 本地开发环境
wrangler d1 execute pykg-nic-db --local --file=./schema.sql

# 生产环境
wrangler d1 execute pykg-nic-db --remote --file=./schema.sql
```

#### 选项 B：对于现有数据库
```bash
# 只运行迁移 SQL（不会影响现有数据）
wrangler d1 execute pykg-nic-db --local --file=./migrations/001_add_agent_conversations.sql

# 生产环境
wrangler d1 execute pykg-nic-db --remote --file=./migrations/001_add_agent_conversations.sql
```

### 第四步：部署代码

```bash
# 确保所有依赖已安装
npm install

# 本地测试（可选）
npm run dev

# 部署到生产环境
npm run deploy
```

### 第五步：验证部署

1. **访问主页**：打开 `https://nic.py.kg`
2. **查看浮动按钮**：右下角应该出现紫色的 AI 助手按钮
3. **点击按钮**：应该打开 AI 聊天页面
4. **测试对话**：
   - 发送 "你好"
   - 发送 "查询我的信息"
   - 发送 "检查 example 域名是否可用"

## Agent 功能说明

### 已实现的工具（共 13 个）

#### 查询类工具：
1. `get_user_info` - 获取用户信息和配额
2. `get_domain_info` - 获取用户域名信息
3. `query_dns_records` - 查询 DNS 记录
4. `whois_lookup` - WHOIS 查询
5. `check_blacklist` - 黑名单查询
6. `check_domain_available` - 检查域名可用性
7. `get_notifications` - 获取通知

#### 操作类工具：
8. `register_domain` - 注册域名（创建订单）
9. `add_dns_record` - 添加 DNS 记录
10. `update_dns_record` - 更新 DNS 记录
11. `delete_dns_record` - 删除 DNS 记录
12. `submit_appeal` - 提交申诉
13. `submit_report` - 提交举报

### 用户体验

- **友好对话**：中文自然语言交互
- **智能理解**：理解用户意图，自动调用合适的工具
- **实时反馈**：打字动画效果
- **工具透明**：显示调用了哪些工具
- **上下文记忆**：保存对话历史

## 故障排查

### 问题 1：API 返回 503 错误
**原因：** 未配置 `DEEPSEEK_API_KEY`
**解决：** 在 Cloudflare Dashboard 添加环境变量

### 问题 2：对话没有响应
**可能原因：**
1. DeepSeek API Key 无效或过期
2. API 配额不足
3. 网络问题

**检查方法：**
```bash
# 查看 Functions 日志
wrangler pages deployment tail
```

### 问题 3：数据库错误
**原因：** agent_conversations 表不存在
**解决：** 运行数据库迁移（步骤三）

### 问题 4：工具调用失败
**可能原因：**
- 用户未登录
- 权限不足
- 原有 API 有 bug

**检查：** 先手动测试原有 API 是否正常工作

## 成本监控

建议在 DeepSeek 控制台设置：
- **每日限额**：¥10（可根据实际调整）
- **告警阈值**：80% 配额使用
- **定期检查**：每周查看使用统计

## 后续优化建议

### 阶段 1（当前）
- ✅ 基础对话功能
- ✅ 工具调用
- ✅ 对话历史保存

### 阶段 2（1-2周后）
- [ ] 添加管理员工具（域名审核、用户管理等）
- [ ] 优化提示词，提高准确率
- [ ] 添加对话历史列表（继续之前的对话）
- [ ] 支持文件上传（批量操作）

### 阶段 3（1个月后）
- [ ] 数据分析：统计最常用的功能
- [ ] 根据用户反馈优化
- [ ] 考虑是否逐步替换传统表单
- [ ] 添加多语言支持

### 阶段 4（长期）
- [ ] 语音输入支持
- [ ] 更智能的推荐
- [ ] 自动化工作流
- [ ] 知识库集成

## 回滚方案

如果遇到严重问题需要回滚：

### 1. 禁用 Agent 功能
从 Cloudflare Dashboard 删除或清空 `DEEPSEEK_API_KEY` 环境变量。用户将看不到 AI 按钮。

### 2. 恢复原始前端
```bash
cp public/backup/index.html.bak public/index.html
```

### 3. 重新部署
```bash
npm run deploy
```

## 监控指标

建议监控的指标：
- 每日对话数量
- 平均对话轮次
- 工具调用成功率
- API 响应时间
- API 错误率
- 用户满意度

## 安全注意事项

1. **API Key 安全**：
   - 绝不在前端暴露 API Key
   - 定期轮换 API Key
   - 监控异常使用

2. **权限控制**：
   - 所有工具都通过现有 API 调用
   - 继承原有的权限系统
   - 工具执行前验证用户身份

3. **内容审核**：
   - 对话内容不包含敏感信息
   - 错误信息不泄露系统细节

## 支持

如有问题：
1. 查看本文档的故障排查部分
2. 检查 Cloudflare Functions 日志
3. 查看 DeepSeek API 控制台
4. 提交 issue 或联系开发者

---

**部署完成后，别忘了：**
- ✅ 测试所有主要功能
- ✅ 检查成本监控设置
- ✅ 向用户宣传新功能
- ✅ 收集早期反馈

祝部署顺利！🚀
