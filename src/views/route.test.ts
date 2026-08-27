import { describe, expect, it } from 'vitest'
import { viewForLabel } from './route'

describe('viewForLabel', () => {
  it('routes the capture window to the capture view', () => {
    expect(viewForLabel('capture')).toBe('capture')
  })

  it('routes the Main Window to the view that holds the sections', () => {
    expect(viewForLabel('main')).toBe('main')
  })

  it('routes the Task Creation window to its own view', () => {
    expect(viewForLabel('task-creation')).toBe('task-creation')
  })

  it('routes the settings window to the settings view', () => {
    expect(viewForLabel('settings')).toBe('settings')
  })

  it('has no view for an unrecognised window label', () => {
    expect(viewForLabel('history')).toBeNull()
    // Tasks View is a section of the Main Window, not a window of its own.
    expect(viewForLabel('tasks')).toBeNull()
    expect(viewForLabel('')).toBeNull()
  })
})
