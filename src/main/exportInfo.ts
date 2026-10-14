import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getInstanceInfo } from './instanceInfo'
import { scanModsFolder } from './modParser'

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

export function exportModpackInfo(instancePath: string): string {
  if (typeof instancePath !== 'string' || instancePath.trim().length === 0) {
    throw new Error('Invalid instance path')
  }
  const { mods } = scanModsFolder(instancePath)
  const info = getInstanceInfo(instancePath)
  const exportDirectory = join(instancePath, 'export')
  const exportPath = join(exportDirectory, 'modlist_export.md')
  mkdirSync(exportDirectory, { recursive: true })

  const lines = [
    '# Modpack Info',
    '',
    `- **Instance:** ${markdownCell(info.instanceName)}`,
    `- **Loader:** ${markdownCell(info.modLoader)}`,
    `- **Loader Version:** ${markdownCell(info.loaderVersion)}`,
    `- **Minecraft Version:** ${markdownCell(info.minecraftVersion)}`,
    `- **Total Mods:** ${mods.length}`,
    '',
    '| S.No | Mod Name | ID | Version | Side | Status | Authors |',
    '| ---: | --- | --- | --- | --- | --- | --- |',
    ...mods.map(
      (mod, index) =>
        `| ${index + 1} | ${markdownCell(mod.name)} | ${markdownCell(mod.modId)} | ${markdownCell(mod.version)} | ${markdownCell(mod.side)} | ${mod.enabled ? 'Enabled' : 'Disabled'} | ${markdownCell(mod.authors || '—')} |`
    ),
    ''
  ]

  writeFileSync(exportPath, lines.join('\n'), 'utf8')
  return exportPath
}
