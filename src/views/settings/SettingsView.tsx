import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CHANGELOG } from '@/settings/changelog'
import { Toaster } from '@/components/ui/sonner'
import {
  SettingsGroup,
  SettingsRow,
} from './SettingsGroup'
import WindowTitleBar from '@/components/WindowTitleBar'
import type { Journal } from '@/journal/journal'
import type { AppIdentity, Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import BackupSettings from './BackupSettings'
import ExportSettings from './ExportSettings'
import HotkeySettings from './HotkeySettings'
import MeetingImportSettings from './MeetingImportSettings'
import ModelAccessSettings from './ModelAccessSettings'
import WorkSummaryPromptSettings from './WorkSummaryPromptSettings'
import StartAtLoginSettings from './StartAtLoginSettings'
import {
  loadSettingsInitialState,
  type SettingsInitialState,
} from './SettingsInitialState'
import TaskAlertSettings from './TaskAlertSettings'
import ThemeSettings from './ThemeSettings'
import UpdateSettings from './UpdateSettings'
import ChangelogSettings from './ChangelogSettings'

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
  onReplayOnboarding = () => {},
}: {
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
  /**
   * The Main Window's way of showing the Onboarding flow again, in place of
   * the sections. Replaying starts at the introduction, reflects current
   * settings, and never re-enables automatic presentation.
   */
  onReplayOnboarding?: () => void
}) {
  const [appIdentity, setAppIdentity] = useState<AppIdentity | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const [initialSettings, setInitialSettings] = useState<
    Promise<SettingsInitialState | null> | null
  >(null)

  useEffect(() => {
    void desktop.appIdentity().then(setAppIdentity, (error: unknown) => {
      console.error('could not read the app identity', error)
    })
  }, [desktop])

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    // This state is the one post-commit handoff of the coordinated read to the
    // groups. Publishing the in-flight Promise immediately lets every group
    // observe the same snapshot without starting platform work during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialSettings(loadSettingsInitialState(desktop, settings))
  }, [desktop, settings])

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    // HotkeyRecorder stops Escape before it reaches this shell while it owns
    // the keystroke.
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

        <ModelAccessSettings
          desktop={desktop}
          settings={settings}
          initialSettings={initialSettings}
        />
        <Separator />

        {/* The prompt a model writes from sits beside where that model is
            reached: both belong to the same call, and the field is plain
            text while the Key is not. */}
        <WorkSummaryPromptSettings
          settings={settings}
          initialSettings={initialSettings}
        />
        <Separator />

        <ExportSettings desktop={desktop} journal={journal} />
        <Separator />

        {/* Beside Export, which it is deliberately not: Export is the
            human-readable way out, Backup the snapshot — see the two
            entries in CONTEXT.md and ADR 0032. */}
        <BackupSettings desktop={desktop} />
        <Separator />

        {/* Beside the version in the footer: both are about the build rather
            than about the journal it holds. */}
        <UpdateSettings desktop={desktop} />

        <Separator />

        {/* Under the way into the next version, because it is what the last
            one did. The version is null until it has been read, and the
            changelog opens at its own newest entry until then. */}
        <ChangelogSettings
          versions={CHANGELOG}
          running={appIdentity?.version ?? ''}
        />
        <Separator />

        {/* The introduction itself, offered again. An action rather than a
            setting: it changes nothing that is saved, so it sits with the
            window's other actions rather than with a group that reads or
            writes a value. */}
        <SettingsGroup>
          <SettingsRow
            label="Onboarding"
            explanation="See the introduction and the optional setup again, with your current Hotkeys and settings."
          >
            <Button variant="outline" onClick={onReplayOnboarding}>
              Replay introduction
            </Button>
          </SettingsRow>
        </SettingsGroup>

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
