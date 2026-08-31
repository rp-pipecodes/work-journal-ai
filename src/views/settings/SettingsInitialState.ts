import type {
  CalendarAccess,
  Desktop,
  TaskAlertPermission,
} from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import type { HotkeyStatuses } from '@/settings/hotkey'
import type { Settings } from '@/settings/settings'

/** The one read a Settings window opens with, before groups take over. */
export interface SettingsInitialState {
  hotkeys: HotkeyStatuses
  startAtLogin: boolean
  startAtLoginAnswered: boolean
  stored: Settings
  calendarAccess: CalendarAccess
  taskAlertPermission: TaskAlertPermission
}

/**
 * Keep the window's initial answers on the same boundary they had before the
 * settings were split. In particular, the first-run question must not appear
 * while another setting is still being read.
 */
export async function loadSettingsInitialState(
  desktop: Desktop,
  settings: AppSettings,
): Promise<SettingsInitialState | null> {
  try {
    const [hotkeys, startAtLogin, startAtLoginAnswered, stored, calendarAccess, taskAlertPermission] =
      await Promise.all([
        desktop.hotkeyStatus(),
        desktop.startsAtLogin(),
        settings.hasBeenAskedAboutStartAtLogin(),
        settings.load(),
        desktop.calendarAccess(),
        desktop.taskAlertPermission(),
      ])

    return {
      hotkeys,
      startAtLogin,
      startAtLoginAnswered,
      stored,
      calendarAccess,
      taskAlertPermission,
    }
  } catch (error) {
    console.error('could not read the settings', error)
    return null
  }
}
