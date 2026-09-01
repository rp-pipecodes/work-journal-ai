import { useEffect, useRef, useState } from 'react'
import { ClipboardCopyIcon, SparklesIcon } from 'lucide-react'
import WindowTitleBar from '@/components/WindowTitleBar'
import { useOnScreenToast } from '@/components/on-screen-toast'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { formatJournalDay, type Clock, type Journal } from '@/journal/journal'
import {
  createStandupPostSession,
  type StandupPostState,
} from '@/journal/standup-post-session'
import {
  buildStandupPostInput,
  DEFAULT_STANDUP_PROMPT,
  standupPostRefuses,
  type StandupPostSelection,
} from '@/journal/standup-post'
import type { Desktop, StandupFailure } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'

/**
 * The prose a model writes from yesterday's Notes and the Tasks that still
 * stand, read before it is copied. The material is read by the session; the
 * post itself is this view's — it lives as long as the Main Window that
 * showed it, Generate again replaces it, and nothing of it is ever persisted.
 *
 * The model call is made from Rust so the API Key never enters this window —
 * see docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md.
 */
export default function StandupPostView({
  desktop,
  settings,
  journal,
  clock,
}: {
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
  clock: Clock
}) {
  const [state, setState] = useState<StandupPostState>({ state: 'loading' })
  const [session] = useState(() =>
    createStandupPostSession({ journal, desktop, clock, onChange: setState }),
  )
  // The post on screen: what the model wrote, and which model wrote it — the
  // latter so a replacement post can say so. Nothing else about a call is
  // kept, and nothing here is persisted.
  const [post, setPost] = useState<{ markdown: string; model: string } | null>(null)
  // The model being asked, while a call is in flight. Naming it is the whole
  // point: ten silent seconds read as broken without it.
  const [pending, setPending] = useState<string | null>(null)
  // Why there is no post, when there is not — one of the few kinds the call
  // answers with, rendered as one line. A previous post stays on screen.
  const [failure, setFailure] = useState<StandupFailure | null>(null)
  // The copy confirmation, said twice — a toast for whoever is looking, and a
  // live region for whoever is not, exactly as a Digest copy says what it did.
  const [copied, setCopied] = useState(false)
  const says = useOnScreenToast()
  // A call is in flight, before the pending state has reached the button: a
  // double click must not spend the user's money twice.
  const inFlight = useRef(false)

  useEffect(() => {
    void session.start()

    return () => {
      session.stop()
    }
  }, [session])

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') void desktop.closeWindow()
  }

  /**
   * Spends the call. The material was read when the section opened; what is
   * sent is that selection's own Digest and Tasks, so the model hears exactly
   * what the section showed. Only a day with neither half is refused, and it
   * is refused here, before anything could be spent.
   */
  async function generate(): Promise<void> {
    if (state.state !== 'ready' || inFlight.current) return
    inFlight.current = true
    setFailure(null)

    try {
      const stored = await settings.load()
      // Nothing to name the pending state with and nothing the call could do:
      // Model Access is the three parts together and useless apart. Refused
      // here so the section can say so and point at Settings.
      if (stored.modelBaseUrl.trim() === '' || stored.model.trim() === '') {
        setFailure({ kind: 'model-access' })
        return
      }

      if (standupPostRefuses(state.selection)) return

      setPending(stored.model)
      const response = await desktop.generateStandupPost({
        baseUrl: stored.modelBaseUrl,
        model: stored.model,
        systemPrompt: DEFAULT_STANDUP_PROMPT,
        userContent: await buildStandupPostInput({
          journal: await journal,
          selection: state.selection,
        }),
      })

      if (response.state === 'generated') {
        setPost({ markdown: response.markdown, model: stored.model })
        setCopied(false)
      } else {
        setFailure(response.failure)
      }
    } catch (error) {
      console.error('could not ask for a Standup Post', error)
      setFailure({ kind: 'offline' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  /** The post onto the clipboard, and a confirmation once it is there. */
  function copy(): void {
    if (post === null) return

    desktop.copyToClipboard(post.markdown).then(
      () => {
        setCopied(true)
        says.success('Copied the standup post to the clipboard.')
      },
      (error: unknown) => {
        console.error('could not copy the standup post', error)
        says.failure('Could not copy the standup post.')
      },
    )
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
          Prose a model writes from what you did and what you still owe, for
          you to read and then paste.
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
          <div className="flex max-w-xl flex-col gap-6">
            <MaterialSummary selection={state.selection} />

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => void generate()}
                disabled={
                  pending !== null || standupPostRefuses(state.selection)
                }
              >
                <SparklesIcon data-icon="inline-start" />
                Generate
              </Button>

              {pending !== null && (
                <p role="status" className="type-meta text-muted-foreground">
                  Writing with {pending}…
                </p>
              )}
            </div>

            {failure !== null && (
              <FailureLine
                failure={failure}
                onOpenSettings={() => void desktop.openSettings()}
              />
            )}

            {post !== null && (
              <section className="flex flex-col gap-2">
                <h2 className="type-section">Written by {post.model}</h2>
                <div className="rounded-md border border-border bg-card px-4 py-3 whitespace-pre-wrap type-body">
                  {post.markdown}
                </div>
                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={copy}>
                    <ClipboardCopyIcon data-icon="inline-start" />
                    Copy
                  </Button>
                  {/* Empty until a copy lands, and announced when it does. */}
                  <span role="status" aria-live="polite" className="type-meta text-muted-foreground">
                    {copied ? 'Copied to the clipboard.' : ''}
                  </span>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <Toaster />
    </div>
  )
}

/**
 * What the section is about to send: yesterday's date and the counts for both
 * halves. Always on screen, so the user sees what a call would spend before
 * spending it — and a day with neither half says so here, which is what makes
 * the Generate button's refusal read as an explanation rather than a mystery.
 */
function MaterialSummary({ selection }: { selection: StandupPostSelection }) {
  return (
    <div className="flex flex-col gap-6">
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

      {standupPostRefuses(selection) && (
        <p className="type-section text-muted-foreground">Nothing to say yet.</p>
      )}
    </div>
  )
}

/**
 * Why there is no post, as one line — the few kinds the call answers with,
 * each with its own words. Only the Model Access one is actionable here,
 * because only its fix lives in this window: the rest name what happened and
 * leave the retry to the user, who is the only one who may spend the call
 * again.
 */
function FailureLine({
  failure,
  onOpenSettings,
}: {
  failure: StandupFailure
  onOpenSettings: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <p role="alert" className="type-meta text-destructive">
        {describeFailure(failure)}
      </p>
      {failure.kind === 'model-access' && (
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          Open Settings
        </Button>
      )}
    </div>
  )
}

/**
 * One of the few lines: what happened, in the fewest words that explain it.
 * No failure is retried automatically — a model call is billable — so nothing
 * here says the app will try again; the user deciding to click Generate is
 * the retry, and the one who may spend the call.
 */
function describeFailure(failure: StandupFailure): string {
  switch (failure.kind) {
    case 'model-access':
      return 'Model Access is not configured. Open Settings to add a Base URL, a Model and an API Key.'
    case 'keychain':
      return 'macOS is not letting Work Journal reach the API Key in your Keychain. Unlock your login keychain and try again.'
    case 'offline':
      return 'The model could not be reached. Check your internet connection and try again.'
    case 'unauthorized':
      return 'The model refused the API Key (401). Check the Key in Settings and try again.'
    case 'rate-limited':
      return 'The model is rate limited (429). Wait a moment and try again.'
    case 'timeout':
      return 'The model took longer than 60 seconds to answer. Try again.'
    case 'other':
      return `The model answered with an error (${failure.status}). Try again.`
    case 'empty-response':
      return 'The model returned nothing. Try again.'
  }
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}
