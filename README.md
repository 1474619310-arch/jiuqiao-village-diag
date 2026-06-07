# 九桥·乡村运营健康度自测

手机端诊断表单 + 后端数据收集 + 企业微信通知

## 部署方式

### Render.com（推荐）

1. 将此仓库推到 GitHub
2. 登录 [render.com](https://render.com)，创建 Web Service
3. 连接 GitHub 仓库
4. 环境变量设置：
   - `WECOM_WEBHOOK`：企业微信群机器人 Webhook 地址
   - `SHEET_ID`：腾讯文档智能表格 ID（可选）
   - `DOCS_TOKEN`：腾讯文档 API Token（可选）
   - `ADMIN_PASSWORD`：管理员密码，默认 jiuqiao2026

## 使用

- 用户访问首页填写诊断表
- 提交后数据自动保存
- 管理员查看数据：`/api/submissions?password=你的密码`
- 导出 CSV：`/api/export?password=你的密码`
