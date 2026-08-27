import type { Clock, Journal } from './journal/journal'
import type { Desktop } from './platform/desktop'
import type { AppSettings } from './settings/app-settings'
import CaptureView from './views/capture/CaptureView'
import MainWindow from './views/main/MainWindow'
import TaskCreationView from './views/tasks/TaskCreationView'
import TasksView from './views/tasks/TasksView'
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
  clock,
}: {
  windowLabel: string
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
  /** What the day is, for the views that group by it. */
  clock: Clock
}) {
  const view = viewForLabel(windowLabel)

  if (view === null) {
    return null
  }

  if (view === 'capture') {
    return <CaptureView desktop={desktop} journal={journal} />
  }

  if (view === 'task-creation') {
    return <TaskCreationView desktop={desktop} journal={journal} />
  }

  if (view === 'main') {
    return <MainWindow desktop={desktop} journal={journal} />
  }

  if (view === 'tasks') {
    return <TasksView desktop={desktop} journal={journal} clock={clock} />
  }

  if (view === 'settings') {
    return (
      <SettingsView desktop={desktop} settings={settings} journal={journal} />
    )
  }

  return noViewFor(view)
}

/**
 * The `View` union is closed, so by here nothing is left. A member added
 * without a branch above arrives as something other than `never` and fails
 * typecheck at this call.
 */
function noViewFor(view: never): never {
  throw new Error(`No view for ${String(view)}.`)
}
