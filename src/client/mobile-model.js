// Presentation projections only: all mutations still go through the Harness services.
export function mobileSessions(sessions, workspaces, query = '', filter = 'all') {
  const archived = new Set(workspaces.archivedSessionIds ?? [])
  const needle = query.trim().toLocaleLowerCase()
  return sessions.ids.map(id => sessions.byId[id]).filter(row => row &&
    !archived.has(row.id) && !row.parentId && row.origin !== 'subagent' &&
    (!row.blank || row.id === sessions.current) &&
    (filter !== 'active' || row.running || row.pendingInteraction) &&
    (!needle || `${row.displayTitle ?? row.title ?? ''} ${row.cwd ?? ''}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
export function mobileSessionStatus(row) {
  return row.pendingInteraction ? '等待确认' : row.running ? '进行中' : row.completed ? '已完成' : row.blank ? '新对话' : '可继续'
}
