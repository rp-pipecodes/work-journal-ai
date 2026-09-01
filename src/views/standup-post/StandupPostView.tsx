import { useEffect, useState } from 'react'
import { Copy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import WindowTitleBar from '@/components/WindowTitleBar'
import { formatJournalDay, type Clock, type Journal } from '@/journal/journal'
import {
  createStandupPostSession,
  type StandupPostState,
} from '@/journal/standup-post-session'
import type { Desktop } from '@/platform/desktop'
import type { StandupPostSelection } from '@/journal/standup-post'
import { DEFAULT_SETTINGS } from '@/settings/settings'

/**
 * Generates a transient standup post from the existing Digest and Task data.
 * The API key stays behind the Desktop boundary; this view only supplies
 * rendered Markdown and the configured model settings.
 */
export default function StandupPostView({
  desktop,
  journal,
  clock,
}: {
  desktop: Desktop
  journal: Promise<Journal>
  clock: Clock
}) {
  const [state, setState] = useState<StandupPostState>({ state: 'loading' })
  const [post, setPost] = useState<string | null>(null)
  const [generation, setGeneration] = useState<'idle' | 'generating' | 'failed'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const [settingsSnapshot, setSettingsSnapshot] = useState({
    baseUrl: DEFAULT_SETTINGS.modelBaseUrl,
    model: DEFAULT_SETTINGS.model,
  })
  const [session] = useState(() =>
    createStandupPostSession({ journal, desktop, clock, onChange: setState }),
  )

  useEffect(() => {
    void session.start()
    void desktop.openSettingsStore().then(async (store) => {
      const [baseUrl, model] = await Promise.all([
        store.get<string>('modelBaseUrl'),
        store.get<string>('model'),
      ])
      setSettingsSnapshot({
        baseUrl: baseUrl ?? DEFAULT_SETTINGS.modelBaseUrl,
        model: model ?? DEFAULT_SETTINGS.model,
      })
    }).catch((error: unknown) => {
      console.error('could not read model settings', error)
    })

    return () => {
      session.stop()
    }
  }, [desktop, journal, session])

  async function generate(selection: Extract<StandupPostState, { state: 'ready' }>['selection']): Promise<void> {
    if (selection.notes.length === 0 && selection.completedTasks.length === 0 && selection.openTasks.length === 0) {
      setFailure('Add a Note or Task before generating a Standup Post.')
      return
    }

    setGeneration('generating')
    setFailure(null)
    try {
      const digest = await (await journal).digest({ from: selection.yesterday, to: selection.yesterday })
      const tasks = [...selection.completedTasks, ...selection.openTasks]
        .map((task) => `- ${task.description}`)
        .join('\n')
      const content = await desktop.generateStandupPost({
        baseUrl: settingsSnapshot.baseUrl,
        model: settingsSnapshot.model,
        systemPrompt: 'Write a concise, natural first-person daily standup update in Markdown. Mention completed work and what remains, without inventing details.',
        userContent: `${digest.markdown}\n\nTasks:\n${tasks}`,
      })
      setPost(content)
      setGeneration('idle')
    } catch (error: unknown) {
      console.error('could not generate the Standup Post', error)
      setGeneration('failed')
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  function copyPost(): void {
    if (post === null) return
    void desktop.copyToClipboard(post).catch((error: unknown) => {
      console.error('could not copy the Standup Post', error)
      setFailure('The Standup Post could not be copied.')
    })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') void desktop.closeWindow()
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-section="standup-post"
      className="relative flex h-screen flex-col bg-background outline-none"
    >
      <WindowTitleBar />

      <header className="shrink-0 px-6 py-4">
        <h1 className="type-section">Standup Post</h1>
        <p className="pt-1 type-meta text-muted-foreground">
          See what would be sent before a model call is made.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto px-6 pb-5">
        {state.state === 'loading' && (
          <p role="status" className="type-meta text-muted-foreground">
            Reading the journal…
          </p>
        )}

        {state.state === 'unreadable' && (
          <p role="alert" className="type-meta text-destructive">
            The Standup Post material could not be read.
          </p>
        )}

        {state.state === 'ready' && (
          <>
            <MaterialSummary selection={state.selection} />
            <div className="mt-6 flex items-center gap-2">
              <Button onClick={() => void generate(state.selection)} disabled={generation === 'generating'}>
                <Sparkles />
                {generation === 'generating' ? `Generating with ${settingsSnapshot.model || 'model'}…` : 'Generate'}
              </Button>
              {post !== null && <Button variant="outline" onClick={copyPost}><Copy /> Copy</Button>}
            </div>
            {generation === 'generating' && <p role="status" className="mt-3 type-meta text-muted-foreground">Writing with {settingsSnapshot.model || 'model'}…</p>}
            {failure !== null && <p role="alert" className="mt-3 type-meta text-destructive">{failure}</p>}
            {post !== null && <article className="mt-6 max-w-2xl whitespace-pre-wrap rounded-md border p-4 type-body">{post}</article>}
          </>
        )}
      </main>
    </div>
  )
}

function MaterialSummary({ selection }: { selection: StandupPostSelection }) {
  const empty =
    selection.notes.length === 0 &&
    selection.completedTasks.length === 0 &&
    selection.openTasks.length === 0

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <p className="type-meta text-muted-foreground">
        Yesterday: {formatJournalDay(selection.yesterday)}
      </p>

      <section aria-labelledby="standup-yesterday-heading" className="flex flex-col gap-2">
        <h2 id="standup-yesterday-heading" className="type-section">
          Yesterday
        </h2>
        <p className="type-meta text-muted-foreground">
          {count(selection.notes.length, 'Note')}
        </p>
        <p className="type-meta text-muted-foreground">
          {count(selection.completedTasks.length, 'Completed Task')}
        </p>
      </section>

      <section aria-labelledby="standup-open-heading" className="flex flex-col gap-2">
        <h2 id="standup-open-heading" className="type-section">
          Still to do
        </h2>
        <p className="type-meta text-muted-foreground">
          {count(selection.openTasks.length, 'Open Task')}
        </p>
      </section>

      {empty && (
        <p className="type-section text-muted-foreground">Nothing to say yet.</p>
      )}
    </div>
  )
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}
