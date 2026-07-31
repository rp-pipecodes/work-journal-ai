import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import ThemeProvider from './components/ThemeProvider.tsx'
import { createAppJournal } from './journal/app-journal.ts'
import { createTauriDesktop } from './platform/tauri-desktop.ts'
import { createAppSettings, followDayStart } from './settings/app-settings.ts'

// The composition root: the one place that says what everything is made of.
// Every window loads this same bundle, so all three are built here and the
// label decides which one renders.
const desktop = createTauriDesktop()
const settings = createAppSettings(desktop)

// A promise rather than an awaited value: the database opens after the first
// paint, and a Capture is typed into a window that is already on screen.
const journal = createAppJournal({
  desktop,
  dayStart: followDayStart(settings),
})
// A journal that cannot be opened is reported by whichever view asks for it.
// This is only so that a window which never asks — Settings, unless the user
// exports — does not leave the failure unhandled.
journal.catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the theme, so that a provider that itself fails is still caught.
        The dark class is left on the document either way, so the fallback is
        painted to match whatever the window was already showing. */}
    <ErrorBoundary>
      <ThemeProvider settings={settings}>
        <App
          windowLabel={desktop.windowLabel()}
          desktop={desktop}
          settings={settings}
          journal={journal}
        />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
