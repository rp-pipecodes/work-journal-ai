import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import ThemeProvider from './components/ThemeProvider.tsx'

// Outside Tauri — a bare `vite dev` — there is no current window to ask.
function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label
  } catch {
    return ''
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the theme, so that a provider that itself fails is still caught.
        The dark class is left on the document either way, so the fallback is
        painted to match whatever the window was already showing. */}
    <ErrorBoundary>
      <ThemeProvider>
        <App windowLabel={currentWindowLabel()} />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
