import { formatProject } from '@/journal/journal'
import { cn } from '@/lib/utils'

/*
 * A Note's filing, wherever it is shown. A filed Project reads as a chip — a
 * named thing beside the Body rather than markup inside it, which is what
 * first-class filing looks like. `Unfiled` is the absence of a Project rather
 * than one of them, so it is said quietly and is not drawn as one.
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
        'shrink-0 type-meta',
        project === null
          ? 'text-muted-foreground'
          : 'rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary',
        className,
      )}
    >
      {formatProject(project)}
    </span>
  )
}
