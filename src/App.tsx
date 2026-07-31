import type { Journal } from './journal/journal'
import type { Desktop } from './platform/desktop'
import type { AppSettings } from './settings/app-settings'
import CaptureView from './views/capture/CaptureView'
import HistoryView from './views/history/HistoryView'
import SettingsView from './views/settings/SettingsView'
import { viewForLabel } from './views/route'

/**
 * Every window loads the same bundle; the window label picks the view. An
 * unrecognised label renders nothing at all.
 *
 * The collaborators are built once in `main.tsx` and handed down from here, so
 * no view reaches for the platform itself.
 */
export default function App({
  windowLabel,
  desktop,
  settings,
  journal,
}: {
  windowLabel: string
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
}) {
  const view = viewForLabel(windowLabel)

  if (view === null) {
    return null
  }

  if (view === 'capture') {
    return <CaptureView desktop={desktop} journal={journal} />
  }

  if (view === 'history') {
    return <HistoryView desktop={desktop} journal={journal} />
  }

  return <SettingsView desktop={desktop} settings={settings} journal={journal} />
}
