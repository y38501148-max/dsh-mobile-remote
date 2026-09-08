// Audited companion routes only; a plugin's presence never grants its entire
// prefix loopback privilege. Stateful GET endpoints deliberately stay closed.
export const PLUGIN_ROUTES = new Map([
  ['/api/plugin/newapi-monitor/status', { method: 'GET', role: 'viewer', sanitize: 'quota' }],
  ['/api/plugin/browser-view/status', { method: 'GET', role: 'viewer' }],
  ['/api/plugin/browser-view/open', { method: 'POST', role: 'admin' }],
  ['/api/plugin/repair/hot-reset', { method: 'POST', role: 'admin' }],
  ['/super-injector/api/list', { method: 'GET', role: 'admin' }],
  ['/super-injector/api/inject', { method: 'POST', role: 'admin' }],
  ['/super-injector/api/uninstall', { method: 'POST', role: 'admin' }],
  ['/super-injector/api/ingest', { method: 'POST', role: 'admin' }],
])
export const PLUGIN_WRITES = [...PLUGIN_ROUTES].filter(([, value]) => value.method === 'POST').map(([path]) => path)
const pick = (value, names) => Object.fromEntries(names.filter(name => ['string','number','boolean'].includes(typeof value?.[name])).map(name => [name, value[name]]))
export function quotaView(value) {
  return { ok: value.ok === true, ...value.ok === false ? { error: '额度状态暂不可用' } : {}, ...pick(value, ['checkedAt', 'quotaCheckedAt']),
    channel: value.channel ? pick(value.channel, ['id','name','balance_updated_time']) : null,
    latest: value.latest ? pick(value.latest, ['model_name','channel_name']) : null,
    quota: value.quota ? pick(value.quota, ['remaining','unit','note','source']) : null,
    ...value.quotaError ? { quotaError: '额度读取失败' } : {} }
}
