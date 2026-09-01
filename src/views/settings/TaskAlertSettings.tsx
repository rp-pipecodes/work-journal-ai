import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Desktop, TaskAlertPermission } from '@/platform/desktop'
import type { SettingsInitialState } from './SettingsInitialState'
import {
  SettingsAside,
  SettingsGroup,
  SettingsRow,
} from './SettingsGroup'

/** The current Task Alert permission and the way to recover a denial. */
export default function TaskAlertSettings({
  desktop,
  initialSettings,
}: {
  desktop: Desktop
  initialSettings: Promise<SettingsInitialState | null> | null
}) {
  // What macOS allows of Task Alerts. Read every time the window opens rather
  // than remembered: it is changed in System Settings, which the app never
  // hears about. Null until the OS has answered.
  const [alertPermission, setAlertPermission] =
    useState<TaskAlertPermission | null>(null)

  useEffect(() => {
    if (initialSettings === null) return

    void initialSettings.then((initial) => {
      if (initial !== null) setAlertPermission(initial.taskAlertPermission)
    })
  }, [initialSettings])

  // Coming back from System Settings is the one moment a revoked or restored
  // Task Alert permission can be noticed: macOS never tells the app, and this
  // window is where the user was sent to change it. A permission that has just
  // been given is a set of Alerts nobody has registered yet, so the window that
  // registers them is told.
  useEffect(() => {
    const refocused = desktop.onWindowFocused(() => {
      void desktop.taskAlertPermission().then(
        (permission) => {
          setAlertPermission((before) => {
            if (before === permission) return before
            if (permission === 'granted') void desktop.announceTasksChanged()
            return permission
          })
        },
        (error: unknown) => {
          console.error('could not re-read the Task Alert permission', error)
        },
      )
    })

    return () => {
      void refocused.then((stop) => stop())
    }
  }, [desktop])

  function openNotificationSettings() {
    desktop.openNotificationSettings().catch((error: unknown) => {
      console.error('could not open System Settings', error)
    })
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Task Alerts"
        explanation="Whether macOS may alert you when a Task with a time comes due."
      >
        <span className="type-meta text-muted-foreground">
          {alertPermission === null ? '—' : ALERT_STATUS[alertPermission]}
        </span>
      </SettingsRow>

      {alertPermission !== 'granted' && (
        <>
          <SettingsAside>
            {alertPermission === 'undetermined'
              ? 'Work Journal has not asked yet. It asks the first time you save a Task with a time — never before.'
              : 'macOS is not allowing Work Journal to alert you, and it will not ask again. Turn Work Journal on under System Settings › Notifications › Work Journal. Tasks and their schedules are unaffected either way.'}
          </SettingsAside>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={openNotificationSettings}
            >
              Open System Settings
            </Button>
          </div>
        </>
      )}
    </SettingsGroup>
  )
}

/** What macOS currently allows of Task Alerts, in the fewest words that say it. */
const ALERT_STATUS: Record<TaskAlertPermission, string> = {
  granted: 'Allowed',
  denied: 'Not allowed',
  undetermined: 'Not asked yet',
}
