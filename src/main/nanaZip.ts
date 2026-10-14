import { execFileSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'

const NANA_ZIP_ALIAS = 'NanaZip.exe'

/** Store-installed NanaZip aliases are launchable by name, but not browseable as files. */
export function normalizeNanaZipPath(value: string): string {
  const trimmed = value.trim()
  if (/\\WindowsApps\\NanaZip\.exe$/i.test(trimmed)) return NANA_ZIP_ALIAS
  return trimmed
}

/** Find NanaZip's app execution alias or a conventional standalone install. */
export function detectNanaZipPath(): string | null {
  if (process.platform !== 'win32') return null

  const candidates = [
    join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WindowsApps', 'NanaZip.exe'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'NanaZip', 'NanaZip.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'NanaZip', 'NanaZip.exe'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'NanaZip', 'NanaZip.exe')
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return /\\WindowsApps\\NanaZip\.exe$/i.test(candidate) ? NANA_ZIP_ALIAS : candidate
    }
  }

  try {
    const result = execFileSync('where.exe', ['NanaZip.exe'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    const found = result
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean)
    if (found && existsSync(found) && statSync(found).isFile()) {
      return /\\WindowsApps\\NanaZip\.exe$/i.test(found) ? NANA_ZIP_ALIAS : found
    }
  } catch {
    // NanaZip is not installed or is not available on PATH.
  }
  return null
}
