import { describe, expect, it } from 'vitest'
import { viewForLabel } from './route'

describe('viewForLabel', () => {
  it('routes the capture window to the capture view', () => {
    expect(viewForLabel('capture')).toBe('capture')
  })

  it('routes the history window to the history view', () => {
    expect(viewForLabel('history')).toBe('history')
  })

  it('routes the settings window to the settings view', () => {
    expect(viewForLabel('settings')).toBe('settings')
  })

  it('has no view for an unrecognised window label', () => {
    expect(viewForLabel('main')).toBeNull()
    expect(viewForLabel('')).toBeNull()
  })
})
