/**
 * One Vite build serves every window. Each Tauri window carries a label, and
 * that label is the only thing that decides which view the root component
 * renders.
 */
export type View = 'capture' | 'history' | 'settings'

const VIEWS: Record<string, View> = {
  capture: 'capture',
  history: 'history',
  settings: 'settings',
}

export function viewForLabel(label: string): View | null {
  return VIEWS[label] ?? null
}
