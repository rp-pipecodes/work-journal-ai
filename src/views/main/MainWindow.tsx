import { useEffect, useRef, useState } from 'react'
import type { Clock, Journal } from '@/journal/journal'
import type { Desktop, MainSection } from '@/platform/desktop'
import HistoryView from '@/views/history/HistoryView'
import TasksView from '@/views/tasks/TasksView'
import SectionSidebar from './SectionSidebar'
import { SECTIONS } from './sections'

/**
 * The one window the journal is read in: a sidebar of sections down the left,
 * exactly one of them showing — see
 * docs/adr/0022-one-main-window-for-reading-and-settings.md.
 *
 * The window is built when it is asked for and genuinely closed on dismiss, so
 * everything here starts fresh with it. Which section it starts on is the
 * Entry Point's to say: the Tray Menu and a clicked Task Alert each name one,
 * and a request naming none resolves to History.
 *
 * Every section stays mounted and only the one showing is on screen. A section
 * is a place the user keeps coming back to rather than a page they load: a
 * Filter narrowed in History, or a Task half-edited, survives a trip to the
 * other section — and a Nudge raised while the other one is showing waits
 * quietly on History rather than being announced from the sidebar.
 *
 * A section knows nothing about the sidebar. `HistoryView` and `TasksView` are
 * rendered exactly as they were when each had a window to itself, which is
 * also how they are still tested.
 */
export default function MainWindow({
  desktop,
  journal,
  clock,
}: {
  desktop: Desktop
  journal: Promise<Journal>
  /** What the day is, for the section that groups by it. */
  clock: Clock
}) {
  const [section, setSection] = useState<MainSection>('history')
  // The section on screen, as the element the sidebar is not part of.
  const showing = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // What the Entry Point that opened this window asked for, claimed as the
    // window opens: a window built by that very request has no webview yet
    // when the announcement goes out, so it is written down for it as well.
    void desktop.requestedSection().then(
      (requested) => {
        if (requested !== null) setSection(requested)
      },
      (error: unknown) => {
        console.error('could not read the section this window opened on', error)
      },
    )

    // And the announcement, for a window that was already on screen: reaching
    // the Tray Menu again, or clicking a Task Alert, switches this window
    // rather than opening another one.
    const requested = desktop.onSectionRequested(setSection)

    return () => {
      void requested.then((stop) => stop())
    }
  }, [desktop])

  useEffect(() => {
    // A section takes focus as it mounts, but the section switched to has been
    // mounted all along — and whatever did the switching has the focus: the
    // sidebar button, or nothing at all when an Entry Point named the section.
    // Escape belongs to the section, bound to its own root, so the root is
    // handed focus here exactly as it takes it when a window opens on it.
    const root = showing.current?.firstElementChild
    if (root instanceof HTMLElement) root.focus()
  }, [section])

  return (
    <div className="flex h-screen bg-background">
      <SectionSidebar
        sections={SECTIONS}
        current={section}
        onChoose={setSection}
      />
      {/*
        `min-w-0` so the section is what gives way when the window is narrowed:
        the sidebar's width is fixed, and a section whose content refused to
        shrink would push its own right-hand edge off the window.

        Hidden rather than unmounted: the section the user comes back to is the
        one they left, down to the Filter and the scroll position. `hidden`
        rather than a class, so the section that is not showing is out of the
        accessibility tree as well as off the screen — nothing in it is
        reachable by Tab, by a screen reader, or by a label the section showing
        uses too.
      */}
      <div
        hidden={section !== 'history'}
        ref={section === 'history' ? showing : null}
        className="min-w-0 flex-1"
      >
        <HistoryView desktop={desktop} journal={journal} />
      </div>
      <div
        hidden={section !== 'tasks'}
        ref={section === 'tasks' ? showing : null}
        className="min-w-0 flex-1"
      >
        <TasksView desktop={desktop} journal={journal} clock={clock} />
      </div>
    </div>
  )
}
