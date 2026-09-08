# 中继接入

本轮不部署公网服务。实现采用标准 TLS：手机到电脑网关的业务 TLS 字节通过中继透明转发，中继的控制连接另外使用 WSS。中继不持有业务证书私钥，仍能观察连接地址、时长及流量大小。

每个实例连接一台 Host。服务端准备控制域名证书、至少 32 字节随机中继令牌文件，并编写仅服务账户可读的配置：

```json
{
  "bind": "0.0.0.0",
  "controlPort": 8443,
  "publicPort": 443,
  "certPath": "/etc/dsh/control-fullchain.pem",
  "keyPath": "/etc/dsh/control-key.pem",
  "tokenPath": "/etc/dsh/relay-token"
}
```

启动：

```sh
dsh-mobile-relay /etc/dsh/relay.json
```

电脑「手机远程」填写：

| 字段 | 示例 |
| --- | --- |
| HTTPS 地址 | `https://phone.example.com` |
| 业务证书/私钥 | 电脑上匹配 `phone.example.com` 的证书与私钥路径 |
| 监听地址 | `127.0.0.1` |
| 监听端口 | `9443` |
| 中继控制地址 | `wss://control.example.com:8443/relay/control` |
| 中继令牌文件 | 电脑上的同一随机令牌文件 |

两个域名解析到中继服务器。公开业务端口 443 是原始 TLS TCP 转发，不要再由 HTTP 反向代理终止这条业务 TLS。电脑只主动发起 WSS，不必对互联网开放本机网关端口。

关闭远程入口会断开中继、释放防休眠并取消重启恢复；不取消 Host 原有任务。控制连接中断会关闭相应业务连接，电脑会尝试重连。真实跨网部署仍需手机实验。
