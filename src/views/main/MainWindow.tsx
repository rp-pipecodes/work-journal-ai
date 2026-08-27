import { useState } from 'react'
import type { Journal } from '@/journal/journal'
import type { Desktop } from '@/platform/desktop'
import HistoryView from '@/views/history/HistoryView'
import SectionSidebar from './SectionSidebar'
import { SECTIONS, type MainSection } from './sections'

/**
 * The one window the journal is read in: a sidebar of sections down the left,
 * exactly one of them showing — see
 * docs/adr/0022-one-main-window-for-reading-and-settings.md.
 *
 * The window is built when it is asked for and genuinely closed on dismiss, so
 * everything here starts fresh with it: the next Main Window opens on History,
 * and History itself opens where it always does.
 *
 * A section knows nothing about the sidebar. `HistoryView` is rendered exactly
 * as it was when it had a window to itself, which is also how it is still
 * tested.
 *
 * With History the only section here, it is simply what the window renders.
 * Keeping a section's state while another one is showing — what ADR 0022 asks
 * for — is a question that only arises once there is a second section to
 * switch to, and it is answered when Tasks View moves in.
 */
export default function MainWindow({
  desktop,
  journal,
}: {
  desktop: Desktop
  journal: Promise<Journal>
}) {
  const [section, setSection] = useState<MainSection>('history')

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
      */}
      <div className="min-w-0 flex-1">
        {section === 'history' && (
          <HistoryView desktop={desktop} journal={journal} />
        )}
      </div>
    </div>
  )
}
