import CaptureView from './views/capture/CaptureView'
import HistoryView from './views/history/HistoryView'
import SettingsView from './views/settings/SettingsView'
import { viewForLabel } from './views/route'

/**
 * Every window loads the same bundle; the window label picks the view. An
 * unrecognised label renders nothing at all.
 */
export default function App({ windowLabel }: { windowLabel: string }) {
  const view = viewForLabel(windowLabel)

  if (view === null) {
    return null
  }

  if (view === 'capture') {
    return <CaptureView />
  }

  if (view === 'history') {
    return <HistoryView />
  }

  return <SettingsView />
}
