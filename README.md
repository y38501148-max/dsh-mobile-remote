# DeepSeek Harness Mobile Remote

让手机浏览器/PWA 操作电脑上**同一个 DeepSeek Harness Host**。不需要 Codex 或 OpenAI 账号。

适配目标：`@deepseek-ai/dsh@0.1.0-rc.6`，Node.js 22+。开发与实验进度见 [验收记录](docs/development-status.md)，原始范围见 [完整计划](docs/mobile-remote-plugin-plan.md)。

## 功能

- HTTPS 配对、电脑确认、只读/任务操作/完整控制三种权限、90 天授权和即时撤销。
- 复用 Harness 原生会话、流式输出、可见 reasoning、工具、问题、审批、目标、子代理和任务状态。
- 双向发送、排队、引导、停止；接收记录对账，丢失回执不自动重发。队列编辑检测旧内容，冲突时保留编辑文本。
- 共享文字、引用、图片及文本文件草稿；编辑租约、冲突副本、IndexedDB 恢复、分块上传及断点续传。
- 默认跟随会话、对话/轨迹/详情面板、阅读位置和展开状态；可以接管或退出跟随。
- 手机目录选择、文件预览/下载、图片、音视频及原生 diff/终端输出。普通设备资源限制在会话工作区；完整控制设备可以读取工作区外文件。
- 主动连接中继，业务 TLS 在电脑终止；通用 Web Push 提醒、macOS 防空闲休眠选项。
- 已开启的网关在 Host 重启后恢复；设备与草稿持久保存。首次安装默认关闭，显式关闭会取消自动恢复。

## 安装、升级、卸载

先取得构建好的 `.tgz`，或在本仓库运行：

```sh
npm ci
npm run build
npm pack
```

使用**桌面应用实际使用的 DSH_HOME 和 web profile**执行 Harness 原生命令。原生插件管理需要 PATH 中可用的 pnpm（测试使用 11.19.0）。下面的 `dsh` 应为该应用对应的 rc.6 CLI；不要另启一个业务 Host。

```sh
dsh plugin --profile web add /absolute/path/muzermat-dsh-mobile-remote-0.1.0.tgz
```

重新加载该 Host 后，在「设置 → 手机远程」填写 HTTPS 地址、证书/私钥路径和监听地址/端口，然后开启。生成二维码，手机扫码后，在电脑选择设备权限。

升级仍用 `add /absolute/path/new-package.tgz`。升级前关闭远程入口、备份 `$DSH_HOME/mobile-remote/`，并保留旧安装包；回滚时安装旧包。不要同时启动两个使用同一状态目录的 Host。

卸载：

```sh
dsh plugin --profile web remove @muzermat/dsh-mobile-remote
```

先在设置中关闭远程入口，再卸载。卸载保留状态文件，方便回滚；若希望撤销所有旧授权，先撤销设备。证书、状态与上传目录不进入 Git 仓库。

## 接入与日常使用

HTTPS 证书必须受手机信任，并匹配填写的公开域名。局域网可以使用可达的私人网络 HTTPS 入口；跨网使用 [中继说明](docs/relay.md)。本轮开发没有部署公网中继，也没有改变系统证书信任设置。

手机可添加到主屏幕。通知在设备端主动开启；通知仅包含通用提醒，不包含消息正文。后台网页可能暂停，恢复到前台后以 Host 的历史、队列和待办基线为准。

「任务操作」可操作全部会话；「完整控制」还包括设置、电脑目录/文件和动态插件管理。密钥继续由电脑使用；设置读取沿用原生敏感字段脱敏。

发生草稿冲突时，可保留本机副本、采用共享版本或接管编辑。若显示「结果待确认」，先核对会话、队列和设置里的操作回执，不要重复发送。Host 重启后旧页面需要核对状态并刷新。

防休眠只阻止 macOS 空闲休眠，不能保证关机、断电、主动睡眠或合盖时可用。关闭桌面窗口能否保持 Host 运行，沿用桌面应用的窗口生命周期。

## 现有插件适配

兼容工具生成**新的副本目录**，不覆盖原插件源码。它需要本仓库开发依赖，先运行 `npm ci`：

```sh
node lib/compat/cli.js /absolute/path/original/plugins /new/path/prepared-plugins
```

包含 `ui-tweaks`、`harness-modes`、`repair`、`browser-view`、`newapi-monitor`、`haibara-ai`、`step-narrator`，以及存在时的 routing suite 注入器。模式/文件桥接、rc.6 插槽、注入器管理页面和原生会话创建在副本中适配；源代码结构改变时明确失败。

将这些副本按原插件的安装流程装入同一 Host。`companions.json` 列出生成位置。原版与适配副本不要重复装配。具体通过的场景见 [兼容性记录](docs/development-status.md)。

## 开发验证

```sh
npm test
npm run test:host
npm run test:native
npm run test:interactions
npm run test:gateway
npm run test:relay
npm run test:package
# 仅本机有原插件源目录时：
DSH_COMPANION_SOURCE=/absolute/path/original/plugins npm run test:companions
```

测试使用隔离 Home、合成会话和本地模拟模型。`npm run dev:host` 启动独立测试 Host；开发探针只存在于测试 helper，不在插件运行时注册。

## 明确边界

- 手机真机锁屏、蜂窝切换、系统推送，以及实际桌面窗口隐藏后的长时间使用，仍需实验验收。
- 中继实现已本地验证，公网域名、部署位置和费用未配置。
- 不提供独立远程桌面或连续 PTY 镜像；显示和执行 Harness 已有工具能力。
- 队列回执代表接收结果，不代表任务完成。崩溃前无持久证据的操作保留为待确认。
- 附件限制：单图 5 MiB、单文本文件 1 MiB、上传总量 128 MiB；产物按需流式读取，最大 512 MiB。未引用上传按期限回收，草稿及冲突引用会保留。
- 首版中继每实例服务一台 Host。状态协议为 1，未验证其他 Harness 版本；原生 `host.describe.version` 在 rc.6 中是常量，不能用它证明包版本。
