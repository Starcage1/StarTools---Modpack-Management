import { ElectronAPI } from '@electron-toolkit/preload'
import type { ModpackApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ModpackApi
  }
}
