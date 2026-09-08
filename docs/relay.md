# 自建单 Host 中继

本组件已实现并通过本地集成测试，本轮开发不替用户部署服务器。每个实例绑定一台电脑；多台电脑使用独立实例、端口和令牌。

手机访问中继的 publicPort（通常 443）。这是一条原始 TCP 通道，内部 TLS 一直终止到电脑 mobile-remote 网关；中继没有业务域名的 TLS 私钥。电脑用另一个 WSS 控制端口主动连接中继，按连接创建受令牌保护的数据通道。中继可见连接来源、时序、流量和 TLS 握手元数据，不能据此宣称匿名或隐藏域名。没有自创加密协议。

在中继服务器安装本包，准备控制域名证书及至少 32 字节随机令牌文件，权限设为仅服务账户可读。令牌文件通过用户自己的安全渠道放到电脑。不要把令牌写进 URL、二维码或仓库。

配置示例：

```json
{
  "bind": "0.0.0.0",
  "controlPort": 8443,
  "publicPort": 443,
  "certPath": "/etc/dsh-relay/control-fullchain.pem",
  "keyPath": "/etc/dsh-relay/control-privkey.pem",
  "tokenPath": "/etc/dsh-relay/host-token"
}
```

运行 `dsh-mobile-relay /etc/dsh-relay/relay.json`。用服务管理器运行并设置退出重启；开放控制和业务端口。不要用普通 HTTP 反向代理接管业务端口 TLS。业务 DNS 指向中继服务器。

在电脑插件设置中填写手机业务 HTTPS 地址（例如 `https://mobile.example.com`）、其证书与私钥路径、loopback 监听端口、`wss://relay.example.com:8443/relay/control` 与本机令牌文件路径，选择仅本机监听。手机证书必须覆盖业务域名；中继控制证书必须覆盖控制域名。电脑仍绑定桌面的同一个 Host。

控制断开会关闭数据通道；电脑最多每 30 秒重新连接。数据通过带背压的 stream 转发，同时最多 64 个连接，未接上的数据通道 10 秒超时。`npm run test:relay` 验证令牌拒绝、1 MiB 字节一致和断开清理。公网 DNS、证书、蜂窝切换与真机通知属于之后的用户环境验收。
