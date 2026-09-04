import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'

/*
 * What the reader is looking for, anywhere in the journal. The field holds the
 * term the session holds, so clearing the Search with Escape empties it
 * without the view keeping a second copy of the truth — and the debounce, the
 * two-character threshold and which read may land are the session's, not this
 * input's.
 *
 * The one control that gives way when the window is narrow: what sits beside
 * it is fixed, and a field is just as usable half as wide. It gives way down
 * to a readable width and then takes a row of its own, rather than shrinking
 * until nothing can be typed into it.
 *
 * Shared rather than restated, because History and Tasks View are asking the
 * same question of different records.
 */
export default function SearchField({
  term,
  onType,
}: {
  term: string
  onType: (term: string) => void
}) {
  return (
    <label className="relative flex min-w-32 flex-1 basis-40 items-center">
      <span className="sr-only">Search</span>
      <SearchIcon className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
      <Input
        type="search"
        value={term}
        onChange={(event) => onType(event.target.value)}
        placeholder="Search"
        className="h-6 w-full min-w-0 pl-6 type-meta [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  )
}
