# @muzermat/dsh-mobile-remote

DeepSeek Harness 手机远程控制插件，独立开发仓库。

**当前是持续开发版本，完整远控尚未完成。** 已增加 HTTPS 认证网关和原生双端输入集成；最新进度见开发报告。下方早期接口说明将在完整协议稳定后统一更新。
目标与阶段见 [原始计划](docs/mobile-remote-plugin-plan.md)，实测与后续工作见 [开发报告](docs/development-status.md)。无需 Codex 或 OpenAI 账号。

## 开发与验证

Node.js 22+：

```sh
npm ci
npm test
npm run test:host
npm pack
```

使用 Harness 的 `cordis.patch.yml` 插件格式。打包产物包含 Host 入口与模块，无生产运行时依赖。`test:host` 启动真实 `@deepseek-ai/dsh-host-webserver@0.1.0-rc.6`，监听临时 loopback 端口，并通过 Cordis 加载/卸载插件；apiProxy 是占位服务，此测试不启动 LLM，也不访问用户 Home、配置、会话或凭据。

## 已实现

- 注入桌面当前 Host 的 webServer/apiProxy，不另起业务 Host。
- 仅限本机的状态、邀请、设备审批/撤销、共享文本草稿接口。
- 短时随机邀请、单次认领、桌面批准后授权；凭据只保存摘要；撤销回收注册的连接回调。
- 草稿使用 revision 比较并交换；冲突返回当前版本和提交副本；旧版本清空不能删除较新输入。
- 每次插件激活生成 hostEpoch，拒绝旧页面写入；错误响应和大小/数量上限。
- 单元测试、真实 WebServer 集成测试、GitHub Actions。

## 本机接口

所有接口前缀为 `/api/plugin/mobile-remote/`。必须直接连接本机 Host，Host/Origin 必须匹配当前端口，不接受反向代理转发来绕过权限。请求和响应均不缓存。

| 路径 | 方法 | 额外 JSON 字段 |
| --- | --- | --- |
| status | GET | 返回 hostEpoch、能力和 enabled:false |
| devices | GET | 返回设备列表，不含凭据 |
| pair/invite | POST | 无；返回 120 秒有效的 code |
| pair/claim | POST | code, name；返回一次性的 credential 响应和待批准设备 |
| pair/approve | POST | deviceId |
| devices/revoke | POST | deviceId |
| draft/read | POST | sessionId |
| draft/write | POST | sessionId, expectedRevision, text |
| draft/clear | POST | sessionId, expectedRevision |

所有 POST 均须携带 `hostEpoch`（先读取 status）和 `Content-Type: application/json`。管理接口目前全部只允许本机，设备 credential 尚不能登录任何远程入口。草稿与真实会话/输入框尚未绑定，sessionId 在本预览中只作为状态键。

草稿冲突返回 HTTP 409 与 `{ok:false,error:"revision-conflict",current,conflict}`。客户端必须保留本地未确认文字，包括请求失败、断线和冲突时的输入。本模块尚不实现编辑租约、冲突持久化或自动合并。附件引用被明确拒绝，待上传归属校验实现后开放。

## 当前边界

所有设备、邀请和草稿仅存于内存，插件重载/Host 重启即失效。hostEpoch 当前代表插件激活代次，不能视为 Host 原生历史的序号或证明运行队列恢复。远程连接、TLS、中继、PWA、共享输入 UI、原生 HTTP/两条 WS 转发、命令持久去重、资源授权、通知和真机验证仍未实现。

本次开发没有安装进用户正在运行的桌面 Host，也没有开放外网监听。不要将这些本机管理路由直接代理到公网。下一步必须先完成 P0 原生双客户端会话/流/审批实验，再接入认证后的远程通道。
