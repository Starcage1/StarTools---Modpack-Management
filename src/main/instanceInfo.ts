import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { InstanceInfo } from '../shared/types'

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return null
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readTextFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return null
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

function countJars(dir: string): number {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')).length
  } catch {
    return 0
  }
}

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}
/** Canonical display names for loader families. */
const LOADER_NAMES: Record<string, string> = {
  neoforge: 'NeoForge',
  forge: 'Forge',
  fabric: 'Fabric',
  'fabric-loader': 'Fabric',
  quilt: 'Quilt',
  'quilt-loader': 'Quilt',
  liteloader: 'LiteLoader'
}

function canonicalLoaderName(raw: string): string {
  const key = raw.trim().toLowerCase()
  if (!key) return ''
  return LOADER_NAMES[key] ?? raw.trim()[0].toUpperCase() + raw.trim().slice(1).toLowerCase()
}

/** Split a CurseForge-style loader id ("neoforge-21.1.172") into name/version. */
function splitLoaderId(id: string): { loader: string; version: string } {
  const match = /^(neoforge|forge|fabric(?:-loader)?|quilt(?:-loader)?|liteloader)[-_](.+)$/i.exec(id.trim())
  if (!match) return { loader: '', version: '' }
  return { loader: canonicalLoaderName(match[1]), version: match[2] }
}

/**
 * ATLauncher shape: a `launcher` object with `name`, `description`
 * ("Minecraft 1.21.1 with NeoForge") and
 * `loaderVersion: { type: "NeoForge", version: "21.1.256" }`.
 */
function fromAtLauncher(
  obj: Record<string, unknown>
): Pick<InstanceInfo, 'instanceName' | 'minecraftVersion' | 'modLoader' | 'loaderVersion'> | null {
  const launcher = obj['launcher']
  if (typeof launcher !== 'object' || launcher === null || Array.isArray(launcher)) return null
  const l = launcher as Record<string, unknown>
  let modLoader = ''
  let loaderVersion = ''
  const lv = l['loaderVersion']
  if (typeof lv === 'object' && lv !== null && !Array.isArray(lv)) {
    const type = asNonEmptyString((lv as Record<string, unknown>)['type'])
    if (/(neoforge|forge|fabric|quilt|liteloader)/i.test(type)) {
      modLoader = canonicalLoaderName(type)
    }
    const version = asNonEmptyString((lv as Record<string, unknown>)['version'])
    if (/^[\d.]+$/.test(version)) loaderVersion = version
  } else if (typeof lv === 'string' && lv.trim().length > 0) {
    const m = /(neoforge|forge|fabric|quilt|liteloader)[-_ :]?([\d.]+)?/i.exec(lv)
    if (m) {
      modLoader = canonicalLoaderName(m[1])
      if (m[2]) loaderVersion = m[2]
    }
  }
  let minecraftVersion = asNonEmptyString(l['minecraftVersion'])
  if (!/^\d+\.\d+(\.\d+)?$/.test(minecraftVersion)) minecraftVersion = ''
  const instanceName = asNonEmptyString(l['name'])
  if (!minecraftVersion || !modLoader) {
    // "...Minecraft 1.21.1 with NeoForge" style description as fallback.
    const desc = asNonEmptyString(l['description'])
    const m = /minecraft\s+(\d+\.\d+(?:\.\d+)?)\s+with\s+([a-z]+)/i.exec(desc)
    if (m) {
      if (!minecraftVersion) minecraftVersion = m[1]
      if (!modLoader && /(neoforge|forge|fabric|quilt|liteloader)/i.test(m[2])) {
        modLoader = canonicalLoaderName(m[2])
      }
    }
  }
  if (!minecraftVersion && !modLoader && !instanceName) return null
  return { instanceName, minecraftVersion, modLoader, loaderVersion }
}

/** CurseForge manifest.json — the most structured source. */
function fromCurseManifest(
  obj: Record<string, unknown>
): Pick<InstanceInfo, 'instanceName' | 'minecraftVersion' | 'modLoader' | 'loaderVersion'> | null {
  const mc = obj['minecraft'] as Record<string, unknown> | undefined
  if (typeof mc !== 'object' || mc === null) return null
  const version = asNonEmptyString(mc['version'])
  if (!version) return null
  let loader = ''
  let loaderVersion = ''
  const loaders = mc['modLoaders']
  if (Array.isArray(loaders) && loaders.length > 0) {
    const first = loaders[0] as Record<string, unknown>
    if (first && typeof first['id'] === 'string') {
      ;({ loader, version: loaderVersion } = splitLoaderId(first['id']))
    }
  }
  return {
    instanceName: asNonEmptyString(obj['name']),
    minecraftVersion: version,
    modLoader: loader,
    loaderVersion
  }
}

/** True when two loader names refer to the same family ("fabric" == "Fabric"). */
function sameLoader(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x === y || x.startsWith(y) || y.startsWith(x)
}

/**
 * Generic key scan for launcher manifests (ATLauncher modpack.json /
 * instance.json, Prism, vanilla version JSON, etc.) whose schemas vary.
 * Only accepts keys that explicitly mention minecraft/loader (or a bare
 * version-shaped `id`) to avoid grabbing pack versions. Instance names only
 * come from the root object — nested `name` keys are usually maven
 * coordinates (e.g. version-JSON `libraries[].name`).
 */
function fromGenericJson(
  obj: Record<string, unknown>
): Pick<InstanceInfo, 'instanceName' | 'minecraftVersion' | 'modLoader' | 'loaderVersion'> | null {
  let instanceName = ''
  let minecraftVersion = ''
  let modLoader = ''
  let loaderVersion = ''
  const queue: { obj: Record<string, unknown>; depth: number }[] = [{ obj, depth: 0 }]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || current.depth > 3) continue
    for (const [key, value] of Object.entries(current.obj)) {
      const lower = key.toLowerCase()
      if (typeof value === 'string' && value.trim().length > 0) {
        const text = value.trim()
        if (
          !instanceName &&
          current.depth === 0 &&
          ['name', 'title', 'packname', 'instancename'].includes(lower)
        ) {
          instanceName = text
        } else if (!minecraftVersion) {
          if (['id', 'mcversion', 'gameversion'].includes(lower)) {
            // Bare version ids ("1.21.1") — require a full match.
            if (/^\d+\.\d+(\.\d+)?$/.test(text)) minecraftVersion = text
          } else if (lower.includes('minecraft')) {
            const m = /(\d+\.\d+(?:\.\d+)?)/.exec(text)
            if (m) minecraftVersion = m[1]
          }
        }
        if (!modLoader || !loaderVersion) {
          // Maven coords use ':' ("net.neoforged:neoforge:21.1.172").
          const m = /(neoforge|forge|fabric|quilt|liteloader)[-_ :]?([\d.]+)?/i.exec(text)
          if (m) {
            const foundLoader = canonicalLoaderName(m[1])
            const foundVersion = m[2] && /^(?=.*\d)[\d.]+$/.test(m[2]) ? m[2] : ''
            if (!modLoader) {
              modLoader = foundLoader
              if (foundVersion) loaderVersion = foundVersion
            } else if (!loaderVersion && foundVersion && sameLoader(foundLoader, modLoader)) {
              // Only adopt a version from the same loader family.
              loaderVersion = foundVersion
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
              queue.push({ obj: item as Record<string, unknown>, depth: current.depth + 1 })
            }
          }
        } else {
          queue.push({ obj: value as Record<string, unknown>, depth: current.depth + 1 })
        }
      }
    }
  }
  if (!minecraftVersion && !modLoader && !instanceName) return null
  return { instanceName, minecraftVersion, modLoader, loaderVersion }
}

/** Last-resort text scraping (neoforge.txt / options.txt style files). */
function fromText(
  text: string
): Pick<InstanceInfo, 'minecraftVersion' | 'modLoader' | 'loaderVersion'> {
  let minecraftVersion = ''
  let modLoader = ''
  let loaderVersion = ''
  const mc = /(?:minecraft[^\d\n]{0,20})(1\.\d+(?:\.\d+)?)/i.exec(text)
  if (mc) minecraftVersion = mc[1]
  const loader = /(neoforge|forge|fabric(?:-loader)?|quilt(?:-loader)?)[^\d\n]{0,20}(\d[\d.]*)?/i.exec(
    text
  )
  if (loader) {
    modLoader = loader[1][0].toUpperCase() + loader[1].slice(1).toLowerCase()
    if (loader[2]) loaderVersion = loader[2]
  }
  return { minecraftVersion, modLoader, loaderVersion }
}

const UNKNOWN = 'Unknown'

/**
 * Summarize an instance folder: parse the first manifest that yields data
 * (manifest.json > modpack.json > instance.json > neoforge.txt/options.txt)
 * and count jars in \mods\ / \disabledmods\. Never throws — unknowns fill gaps.
 */
export function getInstanceInfo(instancePath: string): InstanceInfo {
  if (typeof instancePath !== 'string' || instancePath.length === 0) {
    throw new Error('Invalid instance path')
  }
  const fallback: InstanceInfo = {
    instanceName: basename(instancePath),
    minecraftVersion: UNKNOWN,
    modLoader: UNKNOWN,
    loaderVersion: UNKNOWN,
    enabledCount: 0,
    disabledCount: 0,
    sourceFile: ''
  }

  const jsonCandidates = ['manifest.json', 'modpack.json', 'instance.json']
  for (const file of jsonCandidates) {
    const obj = readJsonFile(join(instancePath, file))
    if (!obj) continue
    const parsed =
      file === 'manifest.json'
        ? (fromCurseManifest(obj) ?? fromAtLauncher(obj) ?? fromGenericJson(obj))
        : (fromAtLauncher(obj) ?? fromGenericJson(obj))
    if (parsed && (parsed.minecraftVersion || parsed.modLoader || parsed.instanceName)) {
      return {
        ...fallback,
        instanceName: parsed.instanceName || fallback.instanceName,
        minecraftVersion: parsed.minecraftVersion || UNKNOWN,
        modLoader: parsed.modLoader || UNKNOWN,
        loaderVersion: parsed.loaderVersion || UNKNOWN,
        enabledCount: countJars(join(instancePath, 'mods')),
        disabledCount: countJars(join(instancePath, 'disabledmods')),
        sourceFile: file
      }
    }
  }

  for (const file of ['neoforge.txt', 'options.txt']) {
    const text = readTextFile(join(instancePath, file))
    if (!text) continue
    const parsed = fromText(text)
    if (parsed.minecraftVersion || parsed.modLoader) {
      return {
        ...fallback,
        minecraftVersion: parsed.minecraftVersion || UNKNOWN,
        modLoader: parsed.modLoader || UNKNOWN,
        loaderVersion: parsed.loaderVersion || UNKNOWN,
        enabledCount: countJars(join(instancePath, 'mods')),
        disabledCount: countJars(join(instancePath, 'disabledmods')),
        sourceFile: file
      }
    }
  }

  return {
    ...fallback,
    enabledCount: countJars(join(instancePath, 'mods')),
    disabledCount: countJars(join(instancePath, 'disabledmods'))
  }
}
