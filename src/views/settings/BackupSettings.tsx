import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useOnScreenToast } from '@/components/on-screen-toast'
import type { Desktop } from '@/platform/desktop'
import { SettingsGroup, SettingsRow } from './SettingsGroup'

/**
 * When a local instant is said, it is said the way the journal says days and
 * times everywhere else — as the user's own clock reads it, not as a machine
 * formats it. Epoch seconds are what travels; this is the only place that
 * turns them into words.
 */
function saidWhen(epochSeconds: number | null): string {
  if (epochSeconds === null) {
    return 'No automatic backup yet — one is taken at launch.'
  }

  const taken = new Date(epochSeconds * 1000)
  const when = taken.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return `Last automatic backup: ${when}.`
}

/**
 * The Backup group: the automatic snapshots the app takes at launch, beside
 * the journal, and the manual one that goes wherever the user says — the only
 * one that leaves this disk. The copy keeps to what it does: it names what is
 * not included, and it never calls the automatic folder safe from a failed
 * disk, because it is not — see
 * docs/adr/0032-a-backup-is-a-sqlite-snapshot-taken-with-vacuum-into.md.
 */
export default function BackupSettings({ desktop }: { desktop: Desktop }) {
  const [status, setStatus] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  // Every message this group says, and only while it is the section showing:
  // the picker can sit open for a minute, and the line under the buttons
  // keeps the answer for a reader who has gone elsewhere.
  const says = useOnScreenToast()

  useEffect(() => {
    let stale = false
    void desktop.automaticBackups().then(
      (automatic) => {
        if (!stale) {
          setStatus(saidWhen(automatic.newestTakenAt))
        }
      },
      (error: unknown) => {
        console.error('could not read the automatic backups', error)
        if (!stale) {
          setStatus('Could not read the automatic backups.')
        }
      },
    )
    return () => {
      stale = true
    }
  }, [desktop])

  /**
   * One gesture, two operations: the picker first, then the write. A
   * cancelled dialog resolves to null and means the backup never happens —
   * quietly, because a cancelled save is not an error. The button reads
   * "Backing up…" only for the write, and only from the moment the write
   * begins: set after the picker resolves, never before it, because a
   * dialog the user browses for minutes is not a backup in progress — and
   * a disabled button behind the dialog would read as one.
   */
  function backUpNow() {
    void (async () => {
      try {
        const destination = await desktop.chooseBackupLocation()
        if (destination === null) {
          says.success('Backup cancelled.')
          return
        }

        // The write is the moment the label covers.
        setBackingUp(true)
        const backup = await desktop.backupJournal(destination)
        const said = `Backed up to ${backup.path}.`
        says.success(said)
        setStatus(said)
      } catch (error) {
        console.error('could not back up the journal', error)
        const said = 'Could not back up the journal.'
        says.failure(said)
        setStatus(said)
      } finally {
        setBackingUp(false)
      }
    })()
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Backup"
        explanation="A snapshot of the journal database — every Note and Task as stored. Taken automatically at launch into a backups folder beside it, so it shares the disk's fate; Back up now goes wherever you say, which is the copy that leaves this machine. Your API Key, Hotkeys and settings are never included."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={backUpNow}
            disabled={backingUp}
          >
            {backingUp ? 'Backing up…' : 'Back up now'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void desktop.revealBackups()}
          >
            Reveal backups
          </Button>
        </div>
      </SettingsRow>

      {/* The toast is where the user is looking; this is where the answer
          stays. Here before there is anything to say, so what it says next
          is announced rather than merely appearing. */}
      <p
        role="status"
        aria-live="polite"
        className="type-meta text-muted-foreground"
      >
        {status}
      </p>
    </SettingsGroup>
  )
}
