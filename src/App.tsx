import { viewForLabel } from './views/route'

/**
 * Every window loads the same bundle; the window label picks the view. The
 * views themselves arrive with the tickets that build them — until then a
 * recognised label renders a placeholder and an unrecognised one renders
 * nothing.
 */
export default function App({ windowLabel }: { windowLabel: string }) {
  const view = viewForLabel(windowLabel)

  if (view === null) {
    return null
  }

  return <main className="p-4 text-sm">{view}</main>
}
