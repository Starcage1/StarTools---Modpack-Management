import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CatOverrides } from '../shared/types'
import { mergeCategories } from '../shared/categoryMerge'

let cache: CatOverrides | null = null

function userDataDir(): string | null {
  try {
    // Escape hatch for tests / portable setups.
    const env = process.env['MODPACKTOOL_USERDATA']
    if (env) return env
    return app.getPath('userData')
  } catch {
    // No Electron runtime (e.g. plain-node tests).
    return null
  }
}

function overridesPath(): string | null {
  const dir = userDataDir()
  return dir ? join(dir, 'category_overrides.json') : null
}

function sanitizeEntry(raw: unknown): { added: string[]; removed: string[] } {
  const strList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : []
  if (typeof raw !== 'object' || raw === null) return { added: [], removed: [] }
  const r = raw as { added?: unknown; removed?: unknown }
  return { added: strList(r.added), removed: strList(r.removed) }
}

function readFromDisk(): CatOverrides {
  try {
    const path = overridesPath()
    if (!path || !existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const clean: CatOverrides = {}
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

/** (Re)load overrides from disk. */
export function reloadCatOverrides(): void {
  cache = readFromDisk()
}

/** Full override map (never throws; empty when unavailable). */
export function getCatOverrides(): CatOverrides {
  try {
    if (!cache) cache = readFromDisk()
    return cache
  } catch {
    return {}
  }
}

/** Replace the override entry for one mod. Throws on invalid input. */
export function setCatOverrides(
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
 * Merge user overrides into a mod's scanned categories.
 * Delegates to the shared pure helper (single implementation for main + UI).
 */
export function applyCatOverrides(
  modId: string,
  scanned: string[],
  overrides: CatOverrides
): string[] {
  const entry = overrides[modId.toLowerCase()]
  if (!entry) return scanned
  return mergeCategories(scanned, entry)
}
