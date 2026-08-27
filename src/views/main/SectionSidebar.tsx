import { useRef } from 'react'
import { cn } from '@/lib/utils'
import WindowTitleBar from '@/components/WindowTitleBar'
import type { MainSection, SectionEntry } from './sections'

/**
 * The Main Window's sidebar: every section, with the one showing marked.
 *
 * It carries the window's title bar strip because the traffic lights are
 * overlaid on the window's top-left corner, which is over the sidebar — see
 * `WindowTitleBar`. The section beside it keeps a strip of its own, which is
 * what levels its first row with the sidebar's.
 *
 * Keyboard: one tab stop for the whole list, on the current section, with the
 * arrow keys moving along it — what macOS source lists do, and it means Tab
 * from the sidebar reaches the section rather than the next sidebar row.
 */
export default function SectionSidebar({
  sections,
  current,
  onChoose,
}: {
  sections: SectionEntry[]
  current: MainSection
  onChoose: (section: MainSection) => void
}) {
  const list = useRef<HTMLDivElement>(null)

  function onKeyDown(event: React.KeyboardEvent) {
    const step = arrowStep(event.key)
    if (step === 0) {
      return
    }

    event.preventDefault()
    const at = sections.findIndex((section) => section.id === current)
    // Wrapping, so the ends of a short list are not dead keys.
    const next = sections[(at + step + sections.length) % sections.length]
    onChoose(next.id)
    focusSection(list.current, next.id)
  }

  return (
    <nav
      aria-label="Sections"
      className="flex w-44 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
    >
      <WindowTitleBar />
      <div
        ref={list}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-0.5 p-2"
      >
        {sections.map(({ id, label, icon: Icon }) => {
          const showing = id === current

          return (
            <button
              key={id}
              type="button"
              data-section={id}
              // The current section is the page the window is on, so it is
              // marked as such rather than merely styled differently.
              aria-current={showing ? 'page' : undefined}
              tabIndex={showing ? 0 : -1}
              onClick={() => onChoose(id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left type-meta',
                'outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                showing
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60',
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Which way along the list a keystroke moves, if it moves at all. */
function arrowStep(key: string): number {
  if (key === 'ArrowDown') return 1
  if (key === 'ArrowUp') return -1
  return 0
}

/** Moves focus with the selection, so the arrow keys keep working. */
function focusSection(list: HTMLElement | null, section: MainSection) {
  list?.querySelector<HTMLElement>(`[data-section="${section}"]`)?.focus()
}
