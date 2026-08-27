import { ListTodoIcon, NotebookTextIcon, type LucideIcon } from 'lucide-react'
import type { MainSection } from '@/platform/desktop'

/**
 * The sections of the Main Window, in the order the sidebar lists them.
 * History and Tasks View are two of the three — Settings still has a window of
 * its own; see docs/adr/0022-one-main-window-for-reading-and-settings.md.
 *
 * The names themselves live in `Desktop`, because an Entry Point on the Rust
 * side says which section it means — so this is only the sidebar's list of
 * them.
 *
 * Apart from the components so that a component file exports only components,
 * which is what fast refresh needs to swap one without losing state.
 */

export interface SectionEntry {
  id: MainSection
  /**
   * What the sidebar calls it — the record it is about, since the sidebar
   * itself is already the list of the window's sections.
   */
  label: string
  icon: LucideIcon
}

export const SECTIONS: SectionEntry[] = [
  { id: 'history', label: 'History', icon: NotebookTextIcon },
  { id: 'tasks', label: 'Tasks', icon: ListTodoIcon },
]
