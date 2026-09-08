import { readFileSync } from 'node:fs'
const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#345bea"/><rect x="144" y="70" width="224" height="372" rx="36" fill="none" stroke="white" stroke-width="22"/><path d="M206 230l34 34 68-72" fill="none" stroke="white" stroke-width="22" stroke-linecap="round"/><circle cx="256" cy="395" r="13" fill="white"/></svg>'
const offline = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>电脑未连接</title><body style="font:18px system-ui;max-width:480px;margin:15vh auto;padding:24px"><h1>暂时无法连接电脑</h1><p>请检查手机网络，并确认电脑上的 Harness 正在运行。操作不会在离线时自动重发。</p><a href="/">重新连接</a></body></html>'
export const PWA_RESOURCES = new Map([
  ['/remote/manifest.webmanifest', ['application/manifest+json', JSON.stringify({ id: '/remote/app', name: 'DeepSeek Harness Remote', short_name: 'Harness', start_url: '/', scope: '/', display: 'standalone', background_color: '#f7f8fc', theme_color: '#345bea', icons: [{ src: '/remote/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] })]],
  ['/remote/icon.svg', ['image/svg+xml', icon]],
  ['/remote/offline', ['text/html; charset=utf-8', offline]],
  ['/remote/sw.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../client/sw.js', import.meta.url), 'utf8')]],
])
