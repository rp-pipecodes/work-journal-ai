import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import WindowTitleBar from '@/components/WindowTitleBar'
import type { Journal } from '@/journal/journal'
import type { AppIdentity, Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import ExportSettings from './ExportSettings'
import HotkeySettings from './HotkeySettings'
import MeetingImportSettings from './MeetingImportSettings'
import StartAtLoginSettings from './StartAtLoginSettings'
import { loadSettingsInitialState } from './SettingsInitialState'
import TaskAlertSettings from './TaskAlertSettings'
import ThemeSettings from './ThemeSettings'

/**
 * The settings section of the Main Window: a shell that composes one group per
 * setting and owns only the window chrome and application metadata. The groups
 * own their controls, state and platform interactions so new settings can be
 * added without making this composition root larger.
 *
 * Laid out the way macOS lays settings out: what the setting is on the left,
 * the control that changes it on the right, and a separator wherever the
 * subject changes. Every control here is the app's own — a native widget
 * brings its own font, height and focus ring, and belongs to the OS rather
 * than to this window.
 *
 * The window behind this view is created on demand and genuinely closed on
 * dismiss, so the view loads once on mount and needs no reset — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */
export default function SettingsView({
  desktop,
  settings,
  journal,
}: {
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
}) {
  const [appIdentity, setAppIdentity] = useState<AppIdentity | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const initialSettings = useMemo(
    () => loadSettingsInitialState(desktop, settings),
    [desktop, settings],
  )

  useEffect(() => {
    void desktop.appIdentity().then(setAppIdentity, (error: unknown) => {
      console.error('could not read the app identity', error)
    })
  }, [desktop])

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()
  }, [])

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    // HotkeyRecorder and the first-run question stop Escape before it reaches
    // this shell while they own the keystroke.
    if (event.key === 'Escape') {
      void desktop.closeWindow()
    }
  }

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-screen flex-col bg-background type-body outline-none"
    >
      <WindowTitleBar />

      {/* Everything the window says scrolls; the strip above it does not. The
          first row keeps the clear space it always had, measured from under
          the strip rather than from the top of the window. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-5 pb-5">
        <HotkeySettings
          desktop={desktop}
          initialSettings={initialSettings}
        />
        <Separator />

        <ThemeSettings />
        <Separator />

        <StartAtLoginSettings
          desktop={desktop}
          settings={settings}
          initialSettings={initialSettings}
        />
        <Separator />

        <MeetingImportSettings
          desktop={desktop}
          settings={settings}
          initialSettings={initialSettings}
        />
        <Separator />

        <TaskAlertSettings
          desktop={desktop}
          initialSettings={initialSettings}
        />
        <Separator />

        <ExportSettings desktop={desktop} journal={journal} />

        {appIdentity !== null && (
          <>
            <Separator className="mt-auto" />
            <footer
              aria-label="Application version"
              className="flex items-center justify-center gap-2 py-3 type-meta text-muted-foreground"
            >
              <span>{appIdentity.version}</span>
              {appIdentity.isDevelopment && <Badge variant="outline">Dev</Badge>}
            </footer>
          </>
        )}

        <Toaster />
      </div>
    </div>
  )
}
