import { NotebookTextIcon, type LucideIcon } from 'lucide-react'

/**
 * The sections of the Main Window, in the order the sidebar lists them.
 * History is the first of the three — Tasks View and Settings still have
 * windows of their own; see
 * docs/adr/0022-one-main-window-for-reading-and-settings.md.
 *
 * Apart from the components so that a component file exports only components,
 * which is what fast refresh needs to swap one without losing state.
 */
export type MainSection = 'history'

export interface SectionEntry {
  id: MainSection
  /** What the sidebar calls it: the section's name in the glossary. */
  label: string
  icon: LucideIcon
}

export const SECTIONS: SectionEntry[] = [
  { id: 'history', label: 'History', icon: NotebookTextIcon },
]
