import type { CatOverrideEntry } from './types'

const EMPTY_ENTRY: CatOverrideEntry = { added: [], removed: [] }

/**
 * Merge user category overrides into a scanned list: drop `removed`
 * (case-insensitive), append `added` not already present (preserving the
 * user's casing for display). Pure and dependency-free so both the main
 * process (persistence layer) and the renderer (display layer) share one
 * implementation.
 */
export function mergeCategories(
  scanned: string[],
  entry: CatOverrideEntry | undefined
): string[] {
  const { added, removed } = entry ?? EMPTY_ENTRY
  if (added.length === 0 && removed.length === 0) return scanned
  const removedSet = new Set(removed.map((s) => s.toLowerCase()))
  const kept = scanned.filter((c) => !removedSet.has(c.toLowerCase()))
  const present = new Set(kept.map((c) => c.toLowerCase()))
  for (const name of added) {
    if (!present.has(name.toLowerCase())) {
      present.add(name.toLowerCase())
      kept.push(name)
    }
  }
  return kept
}

/** True when a category name came from the user rather than the scan. */
export function isCustomCategory(
  name: string,
  scanned: string[],
  entry: CatOverrideEntry | undefined
): boolean {
  if (!entry || entry.added.length === 0) return false
  const scannedSet = new Set(scanned.map((s) => s.toLowerCase()))
  return (
    !scannedSet.has(name.toLowerCase()) &&
    entry.added.some((a) => a.toLowerCase() === name.toLowerCase())
  )
}
