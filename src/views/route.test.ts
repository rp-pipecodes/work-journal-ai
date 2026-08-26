import { describe, expect, it } from 'vitest'
import { viewForLabel } from './route'

describe('viewForLabel', () => {
  it('routes the capture window to the capture view', () => {
    expect(viewForLabel('capture')).toBe('capture')
  })

  it('routes the history window to the history view', () => {
    expect(viewForLabel('history')).toBe('history')
  })

  it('routes the Task Creation window to its own view', () => {
    expect(viewForLabel('task-creation')).toBe('task-creation')
  })

  it('routes the tasks window to Tasks View', () => {
    expect(viewForLabel('tasks')).toBe('tasks')
  })

  it('routes the settings window to the settings view', () => {
    expect(viewForLabel('settings')).toBe('settings')
  })

  it('has no view for an unrecognised window label', () => {
    expect(viewForLabel('main')).toBeNull()
    expect(viewForLabel('')).toBeNull()
  })
})
