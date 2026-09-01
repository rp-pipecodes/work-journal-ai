/** Settings about one subject, between two separators. */
export function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <section className="flex flex-col gap-2 py-4">{children}</section>
}

/**
 * One setting: what it is on the left, the control that changes it on the
 * right. The name of the setting stays a heading, because that is what it is —
 * a settings list is a document with sections, and a screen reader navigates
 * it as one. `controls` names the control's element inside that heading, so the
 * name is also the control's label rather than text that merely sits beside it.
 */
export function SettingsRow({
  label,
  explanation,
  controls,
  children,
}: {
  label: string
  explanation: string
  controls?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${headingId(label)}-heading`} className="type-section">
          {controls === undefined ? (
            label
          ) : (
            <label htmlFor={controls}>{label}</label>
          )}
        </h2>
        <p className="type-meta text-muted-foreground">{explanation}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">{children}</div>
    </div>
  )
}

/** Said plainly, and never in place of the setting it is about. */
export function SettingsProblem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="type-meta text-destructive">
      {children}
    </p>
  )
}

/**
 * A field the settings file would not take, named: the other field may have
 * saved perfectly well, and a line that said only "that" would leave the user
 * guessing which of the two to type again.
 */
// A sentence every group may need to say, wherever the settings file
// refused its field — so it lives beside the group it speaks in.
// eslint-disable-next-line react-refresh/only-export-components
export function notStored(field: string): string {
  return `${field} could not be saved to the settings file, so it will be gone at the next launch.`
}

export function SettingsAside({ children }: { children: React.ReactNode }) {
  return <p className="type-meta text-muted-foreground">{children}</p>
}

/**
 * A Row's heading, named after the setting, so that a control which cannot
 * carry a `<label>` — a group of buttons is not a form field — can still point
 * at the words the user is reading as its own name.
 */
function headingId(label: string): string {
  return label.toLowerCase().replace(/[^a-z]+/g, '-')
}
