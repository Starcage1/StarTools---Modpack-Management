import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DepOverrides, ModDependency } from '../shared/types'

let cache: DepOverrides | null = null

function userDataDir(): string | null {
  try {
    // Escape hatch for tests / portable setups.
    const env = process.env['MODPACKTOOL_USERDATA']
    if (env) return env
    return app.getPath('userData')
  } catch {
    // No Electron runtime (e.g. plain-node parser tests).
    return null
  }
}

function overridesPath(): string | null {
  const dir = userDataDir()
  return dir ? join(dir, 'dependency_overrides.json') : null
}

function sanitizeEntry(raw: unknown): { added: string[]; removed: string[] } {
  const added =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { added?: unknown }).added)
      ? (raw as { added: unknown[] }).added.filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0
        )
      : []
  const removed =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { removed?: unknown }).removed)
      ? (raw as { removed: unknown[] }).removed.filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0
        )
      : []
  return { added, removed }
}

function readFromDisk(): DepOverrides {
  const path = overridesPath()
  if (!path || !existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const clean: DepOverrides = {}
    for (const [modId, entry] of Object.entries(raw)) {
      if (typeof modId === 'string' && modId.length > 0) {
        clean[modId.toLowerCase()] = sanitizeEntry(entry)
      }
    }
    return clean
  } catch {
    return {}
  }
}

/** (Re)load overrides from disk. Called at the start of every scan. */
export function reloadDepOverrides(): void {
  cache = readFromDisk()
}

/** Full override map (never throws; empty when unavailable). */
export function getDepOverrides(): DepOverrides {
  try {
    if (!cache) cache = readFromDisk()
    return cache
  } catch {
    return {}
  }
}

/** Replace the override entry for one mod. Throws on invalid input. */
export function setDepOverrides(
  modId: string,
  entry: { added: string[]; removed: string[] }
): boolean {
  if (typeof modId !== 'string' || modId.length === 0) {
    throw new Error('Invalid modId')
  }
  const clean = sanitizeEntry(entry)
  const path = overridesPath()
  if (!path) throw new Error('User data directory is unavailable')
  if (!cache) cache = readFromDisk()
  const key = modId.toLowerCase()
  if (clean.added.length === 0 && clean.removed.length === 0) {
    delete cache[key]
  } else {
    cache[key] = clean
  }
  const dir = userDataDir()
  if (!dir) throw new Error('User data directory is unavailable')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(cache, null, 2), 'utf8')
  return true
}

/**
 * Merge user overrides into a mod's scanned dependencies:
 * - `removed` ids stay in the list but are flagged (UI shows line-through).
 * - `added` ids are appended as manual deps (satisfied resolved by caller).
 */
export function applyDepOverrides(
  modId: string,
  scanned: ModDependency[],
  overrides: DepOverrides
): ModDependency[] {
  const entry = overrides[modId.toLowerCase()]
  if (!entry) return scanned
  const removedSet = new Set(entry.removed.map((s) => s.toLowerCase()))
  const present = new Set(scanned.map((d) => d.modId.toLowerCase()))
  const merged = scanned.map((d) =>
    removedSet.has(d.modId.toLowerCase()) ? { ...d, removed: true } : d
  )
  for (const addedId of entry.added) {
    if (present.has(addedId.toLowerCase())) continue // already listed; don't duplicate
    present.add(addedId.toLowerCase())
    merged.push({
      modId: addedId,
      versionRange: '',
      mandatory: true,
      satisfied: false, // resolved by the scan's cross-referencing pass
      source: 'manual',
      removed: false
    })
  }
  return merged
}
