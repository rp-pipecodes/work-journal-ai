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
  stored: Settings
  calendarAccess: CalendarAccess
  taskAlertPermission: TaskAlertPermission
}

/**
 * Keep the window's initial answers on the same boundary they had before the
 * settings were split: one snapshot every group seeds from, so a group never
 * reads the file while another is still writing its own first answer.
 */
export async function loadSettingsInitialState(
  desktop: Desktop,
  settings: AppSettings,
): Promise<SettingsInitialState | null> {
  try {
    const [hotkeys, startAtLogin, stored, calendarAccess, taskAlertPermission] =
      await Promise.all([
        desktop.hotkeyStatus(),
        desktop.startsAtLogin(),
        settings.load(),
        desktop.calendarAccess(),
        desktop.taskAlertPermission(),
      ])

    return {
      hotkeys,
      startAtLogin,
      stored,
      calendarAccess,
      taskAlertPermission,
    }
  } catch (error) {
    console.error('could not read the settings', error)
    return null
  }
}
