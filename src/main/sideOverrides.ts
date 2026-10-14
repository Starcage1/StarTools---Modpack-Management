import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SideOverride } from '../shared/types'

type OverrideMap = Record<string, SideOverride>

const VALID_SIDES: readonly string[] = ['Client', 'Server', 'Both']
let cache: OverrideMap | null = null

function userDataDir(): string | null {
  try {
    // Escape hatch for tests / portable setups.
    const env = process.env['MODPACKTOOL_USERDATA']
    if (env) return env
    return app.getPath('userData')
  } catch {
    // No Electron runtime (e.g. plain-node parser tests) — overrides unavailable.
    return null
  }
}

function overridesPath(): string | null {
  const dir = userDataDir()
  return dir ? join(dir, 'side_overrides.json') : null
}

function isValidSide(value: unknown): value is SideOverride {
  return typeof value === 'string' && VALID_SIDES.includes(value)
}

function readFromDisk(): OverrideMap {
  const path = overridesPath()
  if (!path || !existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const clean: OverrideMap = {}
    for (const [modId, side] of Object.entries(raw)) {
      if (typeof modId === 'string' && isValidSide(side)) clean[modId] = side
    }
    return clean
  } catch {
    return {}
  }
}

/** (Re)load overrides from disk. Called at the start of every scan. */
export function reloadSideOverrides(): void {
  cache = readFromDisk()
}

/** User override for a mod id, or null when none is set. Never throws. */
export function getSideOverride(modId: string): SideOverride | null {
  try {
    if (!cache) cache = readFromDisk()
    return cache[modId.toLowerCase()] ?? null
  } catch {
    return null
  }
}

/**
 * Persist a side override (`[modId]: side`). Pass `null` to clear it.
 * Throws on invalid input or unwritable config.
 */
export function setSideOverride(modId: string, side: SideOverride | null): void {
  if (typeof modId !== 'string' || modId.length === 0) {
    throw new Error('Invalid modId')
  }
  if (side !== null && !isValidSide(side)) {
    throw new Error(`Invalid side: ${String(side)}`)
  }
  const path = overridesPath()
  if (!path) throw new Error('User data directory is unavailable')
  if (!cache) cache = readFromDisk()
  const key = modId.toLowerCase()
  if (side === null) delete cache[key]
  else cache[key] = side
  const dir = userDataDir()
  if (!dir) throw new Error('User data directory is unavailable')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(cache, null, 2), 'utf8')
}
