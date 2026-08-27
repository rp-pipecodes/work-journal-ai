/**
 * One Vite build serves every window. Each Tauri window carries a label, and
 * that label is the only thing that decides which view the root component
 * renders.
 */

import {
  CAPTURE_WINDOW,
  MAIN_WINDOW,
  SETTINGS_WINDOW,
  TASK_CREATION_WINDOW,
  TASKS_WINDOW,
} from '@/platform/desktop'

export type View = 'capture' | 'task-creation' | 'main' | 'tasks' | 'settings'

const VIEWS: Record<string, View> = {
  [CAPTURE_WINDOW]: 'capture',
  [TASK_CREATION_WINDOW]: 'task-creation',
  [MAIN_WINDOW]: 'main',
  [TASKS_WINDOW]: 'tasks',
  [SETTINGS_WINDOW]: 'settings',
}

export function viewForLabel(label: string): View | null {
  return VIEWS[label] ?? null
}
