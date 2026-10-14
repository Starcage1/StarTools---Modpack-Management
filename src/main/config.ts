import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

interface AppConfig {
  lastInstanceFolder?: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** Last successfully scanned instance folder, or null if none/invalid. */
export function getLastFolder(): string | null {
  try {
    const path = configPath()
    if (!existsSync(path)) return null
    const config = JSON.parse(readFileSync(path, 'utf8')) as AppConfig
    const folder = config.lastInstanceFolder
    if (!folder || !existsSync(folder)) return null
    if (!statSync(folder).isDirectory()) return null
    return folder
  } catch {
    return null
  }
}

/** Persist the last successfully scanned instance folder. */
export function saveLastFolder(folder: string): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const config: AppConfig = { lastInstanceFolder: folder }
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}
