import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useOnScreenToast } from '@/components/on-screen-toast'
import { useTheme } from '@/components/theme-context'
import { isTheme, type Theme } from '@/settings/theme'
import { SettingsAside, SettingsGroup, SettingsRow } from './SettingsGroup'

/**
 * The Themes as a segmented control offers them: the two palettes first,
 * because they are what the user is choosing between, and deferring to the OS
 * last. Short labels, because each one sits inside a chip rather than a
 * sentence.
 */
const THEME_SEGMENTS: readonly { theme: Theme; label: string }[] = [
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
  { theme: 'system', label: 'System' },
]

/** The app-wide Theme preference and its resolved palette explanation. */
export default function ThemeSettings() {
  // Read from the provider rather than loaded here: the Hotkey and every other
  // window can change the Theme too, and a second copy would drift from it.
  const { theme, resolved, setTheme } = useTheme()
  // The write is the only thing this control can be wrong about — the chip
  // has already repainted — so what the store made of it is said, and only
  // from here: the Theme Toggle owns its silence.
  const says = useOnScreenToast()

  function remember(choice: Theme) {
    void setTheme(choice).then(
      () => says.success('Theme saved.', 'theme'),
      () => says.failure('Could not save the Theme.', 'theme'),
    )
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Theme"
        explanation="Whether the app is light or dark, and whether it decides that for itself."
      >
        <ToggleGroup
          aria-labelledby="theme-heading"
          spacing={0}
          // A segmented control the way macOS draws one: one recessed track,
          // and the chosen segment raised out of it.
          className="gap-0 rounded-md bg-muted p-0.5"
          value={[theme]}
          onValueChange={(next) => {
            // Pressing the Theme already chosen deselects it, which is not a
            // Theme at all — the app is always painted as something, so
            // there is nothing to record.
            const chosen = next[0]
            if (isTheme(chosen)) {
              remember(chosen)
            }
          }}
        >
          {THEME_SEGMENTS.map(({ theme: choice, label }) => (
            <ToggleGroupItem
              key={choice}
              value={choice}
              className="rounded-sm! px-2.5 hover:bg-transparent data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsRow>

      <SettingsAside>
        {theme === 'system'
          ? `Following the system, which is currently ${resolved}. Cmd+Shift+D switches to the other one.`
          : `Cmd+Shift+D switches between light and dark from any window.`}
      </SettingsAside>
    </SettingsGroup>
  )
}
