import { useEffect, useRef, useState } from 'react'
import type { Clock, Journal } from '@/journal/journal'
import type { Desktop, MainSection } from '@/platform/desktop'
import OnScreenContext from '@/components/on-screen-context'
import type { AppSettings } from '@/settings/app-settings'
import HistoryView from '@/views/history/HistoryView'
import SettingsView from '@/views/settings/SettingsView'
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
 * A section knows nothing about the sidebar. Every section is rendered exactly
 * as it was when each had a window to itself, which is also how they are still
 * tested. The one thing they are told is whether they are on screen — see
 * `on-screen-context` — because hiding a section hides only what it holds, and
 * a dialog it portalled out of the document stays on screen without it.
 */
export default function MainWindow({
  desktop,
  settings,
  journal,
  clock,
}: {
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
  /** What the day is, for the section that groups by it. */
  clock: Clock
}) {
  const [section, setSection] = useState<MainSection>('history')
  // The section on screen, as the element the sidebar is not part of.
  const showing = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // An Entry Point says the section twice — written down for a window that
    // has yet to ask, announced for one already listening — because a window
    // built by that very request has no webview when the announcement goes
    // out. Both are read here, and whichever section was named last wins.

    // The announcement first, and the section written down only once this is
    // listening: a request arriving in the gap between the two would otherwise
    // be announced to nothing and already taken from where it was written.
    let announced = false
    const listening = desktop.onSectionRequested((requested) => {
      announced = true
      // The section heard is claimed as well, exactly as Tasks View claims a
      // Task Alert it hears: what was written down for this window has been
      // delivered, and leaving it there would hand it to the next window to
      // open — which nobody asked to land anywhere but History.
      void desktop.requestedSection().catch((error: unknown) => {
        console.error('could not claim the section that was announced', error)
      })
      setSection(requested)
    })

    void listening.then(() => desktop.requestedSection()).then(
      (requested) => {
        // An announcement that has already landed is the later word: the
        // window was told a section while this claim was still crossing, and
        // what it came back with cannot undo that.
        if (requested !== null && !announced) setSection(requested)
      },
      (error: unknown) => {
        console.error('could not read the section this window opened on', error)
      },
    )

    return () => {
      void listening.then((stop) => stop())
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
      <Section on={section === 'history'} onScreen={showing}>
        <HistoryView desktop={desktop} journal={journal} />
      </Section>
      <Section on={section === 'tasks'} onScreen={showing}>
        <TasksView desktop={desktop} journal={journal} clock={clock} />
      </Section>
      <Section on={section === 'settings'} onScreen={showing}>
        <SettingsView desktop={desktop} settings={settings} journal={journal} />
      </Section>
    </div>
  )
}

/**
 * One section, showing or hidden — and told which, because hiding it reaches
 * only what it holds: a dialog or a popup it portalled out of the document
 * would otherwise stand over the section that is showing. See
 * docs/adr/0024-a-view-is-told-whether-it-is-on-screen.md.
 *
 * Hidden rather than unmounted: the section the user comes back to is the one
 * they left, down to the Filter and the scroll position. `hidden` rather than
 * a class, so the section that is not showing is out of the accessibility tree
 * as well as off the screen — nothing in it is reachable by Tab, by a screen
 * reader, or by a label the section showing uses too.
 *
 * `min-w-0` so the section is what gives way when the window is narrowed: the
 * sidebar's width is fixed, and a section whose content refused to shrink
 * would push its own right-hand edge off the window.
 */
function Section({
  on,
  onScreen,
  children,
}: {
  /** Whether this is the section showing. */
  on: boolean
  /** Where the window keeps the section showing, to hand it the focus. */
  onScreen: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  return (
    <OnScreenContext.Provider value={on}>
      <div hidden={!on} ref={on ? onScreen : null} className="min-w-0 flex-1">
        {children}
      </div>
    </OnScreenContext.Provider>
  )
}
