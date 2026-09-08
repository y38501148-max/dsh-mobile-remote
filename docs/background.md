# 后台运行与通知

插件设置提供 macOS 防空闲休眠开关，仅远程入口开启时可用，调用系统 caffeinate -i，并随入口关闭或插件卸载释放。它防止空闲系统休眠，不绕过合盖、用户主动睡眠或退出 Host。电脑窗口隐藏后的 Host 是否保持运行由桌面应用管理，插件不启动另一个 Host。

手机设置页可主动开启或关闭本设备 Web Push 通知。授权前不会订阅系统通知。VAPID 私钥只保存在权限受限的 Host 状态文件；手机仅收到公开密钥。任务结束、审批和提问发送通用提醒，不含会话名称、正文、工具参数或文件路径。撤销设备后不再向其发送新通知；已交给系统推送服务的消息无法撤回。

实现采用 web-push 库提供的标准加密和 VAPID。推送端点限定于 Chromium FCM、Firefox 和 Apple 官方服务，不接受任意内网 URL。参考 [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)、[Mozilla HTTP endpoint](https://mozilla-services.github.io/autopush-rs/http.html) 和 [web-push 库](https://github.com/web-push-libs/web-push)。

浏览器缺少通知能力时页面显示具体提示；iPhone 需要从主屏幕 Web App 打开后开启。系统可能延迟或合并推送；回到前台必须重新读取 Host 真实状态。未把后台 WS 当作持续在线保证。开发测试仅使用合成订阅和注入的发送器，尚未向实际手机发送测试通知。
