import { formatProject } from '@/journal/journal'
import { cn } from '@/lib/utils'

/*
 * A Note's filing, wherever it is shown. The accent marks a filed Project and
 * nothing else on the line: `Unfiled` is the absence of a Project rather than
 * one of them, so it stays quiet.
 *
 * Shared rather than restated, because History and the Capture Predictions are
 * naming the same thing and a reader moving between them should not have to
 * work out that they are.
 */
export default function ProjectChip({
  project,
  className,
}: {
  project: string | null
  className?: string
}) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono type-meta',
        project === null ? 'text-muted-foreground' : 'text-primary',
        className,
      )}
    >
      {formatProject(project)}
    </span>
  )
}
