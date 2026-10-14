import type AdmZip from 'adm-zip'
import type { ParsedMod } from '../../shared/types'

/**
 * Strategy interface for loader-specific mod metadata parsers.
 * Add new loaders (Fabric/Quilt, Forge) by implementing this interface
 * and registering the strategy in `src/main/modParser/index.ts`.
 */
export interface ModParserStrategy {
  /** Stable loader key used in `ParsedMod.loader`. */
  readonly loader: ParsedMod['loader']
  /** Returns true if this strategy can parse the given jar. */
  canHandle(zip: AdmZip): boolean
  /**
   * Parse an already-opened jar. `filePath` is the absolute on-disk path
   * (used for the payload; the jar itself is read from `zip`). Returns `null`
   * when the file is not a mod for this loader (missing metadata, etc.).
   * Should never throw — implementations must handle their own errors and
   * return null instead.
   */
  parse(zip: AdmZip, fileName: string, filePath: string): ParsedMod | null
}
