const HISTORY_KEY = 'aurora-gomoku-history-v1'
const SETTINGS_KEY = 'aurora-gomoku-settings-v1'

export function loadHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function saveRecord(record) {
  const history = loadHistory().filter((item) => item.id !== record.id)
  history.unshift(record)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 200)))
  return history
}

export function deleteRecord(id) {
  const history = loadHistory().filter((item) => item.id !== id)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  return history
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type }))
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
