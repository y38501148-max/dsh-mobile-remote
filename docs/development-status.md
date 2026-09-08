# 开发状态与验收记录

日期：2026-09-08。阶段：P0 部分完成，P1/P3 状态基础提前落地；P0–P5 总体验收尚未完成。

## 可复现结果

`npm test`：6 项通过。验证本机来源边界、卸载回收、单次邀请、批准前拒绝、撤销连接回调、过期邀请与资源上限、草稿 CAS 冲突和旧版本清空保护。

`npm run test:host`：1 项通过。安装公开 npm 的固定 rc.6 WebServer，通过 Cordis 实际加载插件，在 OS 分配的 loopback 端口发出两个并发 HTTP 请求；仅一个 revision=0 草稿写入成功，另一个得到 409 并保留文字。验证 Host/Origin 伪造、旧 epoch、非法 JSON、错误媒体类型、邀请重放，以及卸载 404 和重新加载 epoch 更新。

测试仅使用合成设备和草稿。apiProxy 注入以占位服务满足依赖，未验证原生会话、事件流、LLM、队列或审批业务。没有使用生产配置、用户会话或调用模型。

## 原生接口矩阵

本机安装的 rc.6 JS/类型定义作为源码依据；以下“源码确认”不同于端到端实测。

| 接口/边界 | 证据位置（包内相对路径） | 当前结论/验证 |
| --- | --- | --- |
| 动态端口、exact/prefix 注册与释放 | dsh-host-webserver/lib/index.js: WebServer.port/register | 真实服务实测通过 |
| 插件注入与 effect 卸载 | cordis 的 plugin/provide/Fiber 生命周期 | 真实加载/卸载实测通过；apiProxy 占位 |
| /api 下 POST 操作 | dsh-client-connection/lib/index.js: rpcFetchHandler | 源码确认；须校验 method 与 endpoint、JSON envelope |
| /api/events.mux 与 /api/events.host | 同上 registerDownlink | 源码确认，两条均须独立代理与恢复测试 |
| 会话 prompt 的 source.rpcId | dsh-host-apiproxy/lib/index.js: session.prompt | 源码确认标识传播；尚无原子持久去重证据 |
| 已结束审批 not-pending | 同上 respond | 源码确认；双端竞争实验待做 |
| mux since 与历史恢复 | dsh-host-apiproxy 的 events 类型、dsh-client-runtime session 类型 | 按原计划补历史；不宣称游标续传已完成 |
| 本机管理新路由 | 本仓库 src/index.js | Host、Origin、peer 校验及 epoch 实测通过 |

## 兼容性跟踪

| 插件 | 当前状态 | 后续验收 |
| --- | --- | --- |
| ui-tweaks | 未适配；组件草稿与 sessionStorage 存在 | 将输入服务接到共享草稿；文件与触屏 |
| harness-modes | 未适配；原计划记录了本地模式状态 | 模式迁移到权威状态并双端回归 |
| repair | 未适配；本机管理动作 | 明确管理权限后开放远程入口 |
| browser-view | 未测试 | 预览与截图资源授权、移动布局 |
| newapi-monitor | 未测试 | 状态、设置权限及敏感信息过滤 |
| haibara-ai | 未测试 | 客户端注入、布局与状态 |
| step-narrator | 未测试 | 流式事件和移动显示 |
| routing suite | 未测试 | preset/injector 配置权限和同步 |

没有任何现有插件被宣称已兼容远程。

## 按依赖顺序继续

1. P0：建立隔离完整 Host（非当前用户 Home），两套原生客户端验证会话消息、长流、工具事件、问题/审批、重连历史拼接；补充自动化断线故障注入。保留同一测试 Host，不另开两个业务实例模拟同步。
2. P0：确定原子 admission/命令 inbox 最小扩展。不能将代理回包缓存当作跨崩溃 exactly-once；无法确认结果时明确待确认，禁止自动重发。
3. P1：持久设备存储、可信 HTTPS 入口、会话与管理权限、CSRF、路由白名单、设备 cookie 和两条 WS 撤销；连接回调接口目前仅有单元验证，未连接真实 WS。
4. P2：命令对账、断线/背压、审批竞争及进程恢复。临时队列丢失必须显式呈现。
5. P3：共享草稿输入框接入、租约、离线冲突副本、上传归属、界面跟随、逐插件适配。
6. P4/P5：中继部署选型、通知与真机后台测试、桌面防休眠、安装升级回归、性能与发布。中继部署沿用原计划暂不执行。

主程序扩展仍为候选：原子 admission/队列持久化、客户端状态接口、特权配置授权、防休眠。当前实验不足以将候选标记为“无需修改”。
