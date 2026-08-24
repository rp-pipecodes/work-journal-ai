import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useTheme } from '@/components/theme-context'

/**
 * Where a window's transient confirmations land. The registry's version reads
 * the palette from `next-themes`, which this app does not use — the Theme lives
 * in `theme-context`, and the resolved palette is what a toast has to be
 * painted in, since `system` here can mean either one.
 *
 * A toast never carries anything a window is not also saying somewhere it
 * stays: it fades, and the answer must not fade with it.
 */
function Toaster({ ...props }: ToasterProps) {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-center"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
