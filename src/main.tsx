import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import App from './App.tsx'

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
    <App windowLabel={currentWindowLabel()} />
  </StrictMode>,
)
