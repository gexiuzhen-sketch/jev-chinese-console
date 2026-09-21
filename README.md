# Jev 中文体验台

一个面向中文用户的 TypeSafe Jev 可视化操作台。用户无需编写 JSON，即可使用 Noul、Choice、Score 三种判断原语，并查看概率与置信度。

## 功能

- 中文可视化表单，适配桌面端与手机 H5
- API Key 只保存在服务端，不会下发到浏览器
- 匿名用户按 IP 每天 10 次体验额度
- 邮箱注册登录后，每个账户每天最高 30 次
- Noul、Choice、Score 三种 Jev 判断模式
- SQLite 持久化用户、会话和每日用量
- 输入内容与模型结果不落库

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env
# 填写 .env 中的 TYPESAFE_API_KEY、SESSION_SECRET 和 IP_HASH_SECRET
set -a && source .env && set +a
npm start
```

打开 `http://127.0.0.1:8787`。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe 控制台生成的 API Key，仅服务端使用 |
| `SESSION_SECRET` | 会话签名密钥，生产环境必填 |
| `IP_HASH_SECRET` | IP 匿名化 HMAC 密钥，生产环境必填 |
| `PUBLIC_ORIGIN` | 生产站点来源，例如 `https://jev.lumingzt.cn` |
| `DB_PATH` | SQLite 数据库路径 |
| `PORT` | 本地监听端口，默认 `8787` |

## 验证

```bash
npm test
npm run check
```

## 部署

仓库中的 `deploy/jev-console.service` 和 `deploy/jev.lumingzt.cn.conf` 分别是 systemd 与 Nginx 配置模板。生产环境建议：

1. 使用 HTTPS；
2. 将 `.env` 放在代码目录之外并设置为仅管理员可读；
3. 由 Nginx 反向代理到 `127.0.0.1:8787`；
4. 为 SQLite 数据目录设置独立持久化路径并定期备份。

## 安全与隐私

- 请勿提交 `.env` 或 API Key；仓库已通过 `.gitignore` 排除相关文件。
- 服务器只保存经过单向哈希的会话令牌和匿名化 IP 标识。
- 用户提交给 Jev 的判断内容与结果不会写入本地数据库。

TypeSafe 与 Jev 是 TypeSafe AI 的产品与商标。本项目是独立的中文体验界面。
