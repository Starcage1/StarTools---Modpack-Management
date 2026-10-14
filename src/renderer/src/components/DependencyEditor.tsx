import { useMemo, useState } from 'react'
import { Plus, RotateCcw, Search, X } from 'lucide-react'
import type { DepOverrideEntry, ModDependency, ParsedMod } from '../../../shared/types'

interface DependencyEditorProps {
  mod: ParsedMod
  allMods: ParsedMod[]
  busy: boolean
  onClose: () => void
  onMutate: (modId: string, entry: DepOverrideEntry) => Promise<void>
}

function Tag({ kind }: { kind: 'scanned' | 'manual' }): React.JSX.Element {
  return (
    <span
      className={
        kind === 'manual'
          ? 'shrink-0 rounded bg-green-100 px-1 py-px font-mono text-[10px] text-green-700 dark:bg-green-950 dark:text-green-400'
          : 'shrink-0 rounded bg-gray-100 px-1 py-px font-mono text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400'
      }
    >
      [{kind}]
    </span>
  )
}

function StatusDot({ dep }: { dep: ModDependency }): React.JSX.Element | null {
  if (dep.removed || dep.satisfied) return null
  const color = dep.mandatory
    ? 'bg-red-500'
    : 'bg-yellow-500'
  return (
    <span
      title={dep.mandatory ? 'Missing required dependency' : 'Missing optional dependency'}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
    />
  )
}

function DependencyEditor({
  mod,
  allMods,
  busy,
  onClose,
  onMutate
}: DependencyEditorProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const addedIds = useMemo(
    () => mod.dependencies.filter((d) => d.source === 'manual').map((d) => d.modId),
    [mod]
  )
  const removedIds = useMemo(
    () => mod.dependencies.filter((d) => d.removed).map((d) => d.modId),
    [mod]
  )
  const scannedActive = useMemo(
    () => mod.dependencies.filter((d) => d.source === 'scanned' && !d.removed),
    [mod]
  )
  const manual = useMemo(() => mod.dependencies.filter((d) => d.source === 'manual'), [mod])
  const removed = useMemo(() => mod.dependencies.filter((d) => d.removed), [mod])

  const mutate = (added: string[], removedList: string[]): void => {
    void onMutate(mod.modId, { added, removed: removedList })
  }

  // Combobox candidates: installed mods matching the query, excluding anything
  // already listed for this mod. Capped at 8 to stay fast with 300+ mods.
  const listed = useMemo(() => {
    const s = new Set<string>()
    for (const d of mod.dependencies) s.add(d.modId.toLowerCase())
    s.add(mod.modId.toLowerCase())
    return s
  }, [mod])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return allMods
      .filter(
        (m) =>
          !listed.has(m.modId.toLowerCase()) &&
          (m.name.toLowerCase().includes(q) || m.modId.toLowerCase().includes(q))
      )
      .slice(0, 8)
  }, [allMods, listed, query])

  const addCandidate = (modId: string): void => {
    mutate([...addedIds, modId], removedIds)
    setQuery('')
    setOpen(false)
  }

  const rowClass =
    'flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 dark:border-gray-700'

  return (
    <div className="fixed bottom-0 right-0 top-0 z-30 flex w-80 flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Dependencies</div>
          <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100" title={mod.fileName}>
            {mod.name}
          </div>
          <div className="font-mono text-[11px] text-gray-400">{mod.modId}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dependency editor"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Add dependency combobox */}
        <div className="relative mb-3">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={query}
              disabled={busy}
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && candidates.length > 0) addCandidate(candidates[0].modId)
                if (e.key === 'Escape') {
                  setQuery('')
                  setOpen(false)
                }
              }}
              placeholder="Add dependency… (name or id)"
              className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm outline-none focus:border-gray-400 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500"
            />
          </div>
          {open && query.trim().length > 0 && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
              {candidates.length === 0 ? (
                <div className="px-2 py-2 text-xs text-gray-400">No matching installed mods</div>
              ) : (
                candidates.map((m) => (
                  <button
                    key={m.modId}
                    type="button"
                    disabled={busy}
                    onClick={() => addCandidate(m.modId)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-100 disabled:opacity-60 dark:hover:bg-gray-700"
                  >
                    <Plus size={12} className="shrink-0 text-green-600 dark:text-green-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                        {m.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-gray-400">
                        {m.modId}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Scanned */}
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Scanned ({scannedActive.length})
        </div>
        <div className="mb-3 space-y-1">
          {scannedActive.length === 0 && (
            <div className="text-xs text-gray-400">No scanned dependencies.</div>
          )}
          {scannedActive.map((d) => (
            <div key={d.modId} className={rowClass} title={d.versionRange || undefined}>
              <StatusDot dep={d} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300">
                {d.modId}
                {!d.mandatory && <span className="text-gray-400"> (opt)</span>}
              </span>
              <Tag kind="scanned" />
              <button
                type="button"
                disabled={busy}
                onClick={() => mutate(addedIds, [...removedIds, d.modId])}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Manual */}
        {manual.length > 0 && (
          <>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Manual ({manual.length})
            </div>
            <div className="mb-3 space-y-1">
              {manual.map((d) => (
                <div key={d.modId} className={rowClass}>
                  <StatusDot dep={d} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300">
                    {d.modId}
                  </span>
                  <Tag kind="manual" />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => mutate(addedIds.filter((id) => id !== d.modId), removedIds)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Removed */}
        {removed.length > 0 && (
          <>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Removed ({removed.length})
            </div>
            <div className="mb-3 space-y-1">
              {removed.map((d) => (
                <div key={d.modId} className={`${rowClass} opacity-60`}>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-red-400 line-through dark:text-red-400">
                    {d.modId}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        addedIds,
                        removedIds.filter((id) => id !== d.modId)
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-green-600 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-green-400"
                  >
                    <RotateCcw size={11} /> Restore
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default DependencyEditor
