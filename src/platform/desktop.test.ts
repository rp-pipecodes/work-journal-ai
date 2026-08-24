import { describe, expect, it } from 'vitest'
import { fakeDesktop } from './testing/desktop'
import {
  CAPTURE_FIELD_HEIGHT,
  CAPTURE_HAIRLINE,
  CAPTURE_PANEL_BORDER,
  CAPTURE_PREDICTION_ROW,
  CAPTURE_REFUSAL_HEIGHT,
  CAPTURE_SHADOW_GUTTER,
  captureWindowHeight,
} from './desktop'

describe('Desktop app identity', () => {
  for (const [build, appIdentity] of [
    ['release', { version: '0.4.1', isDevelopment: false }],
    ['development', { version: '0.4.1', isDevelopment: true }],
  ] as const) {
    it(`exposes the configured version for a ${build} build`, async () => {
      const desktop = fakeDesktop({ appIdentity })

      expect(await desktop.appIdentity()).toEqual(appIdentity)
    })
  }
})

describe('the Capture window height', () => {
  it('rests at the field, its outline and its shadow gutter', () => {
    expect(captureWindowHeight({ predictions: 0, refused: false })).toBe(
      CAPTURE_FIELD_HEIGHT + 2 * (CAPTURE_PANEL_BORDER + CAPTURE_SHADOW_GUTTER),
    )
  })

  it('carries a hairline above the first Prediction and none above no Predictions', () => {
    const resting = captureWindowHeight({ predictions: 0, refused: false })

    expect(captureWindowHeight({ predictions: 1, refused: false })).toBe(
      resting + CAPTURE_HAIRLINE + CAPTURE_PREDICTION_ROW,
    )
    expect(captureWindowHeight({ predictions: 3, refused: false })).toBe(
      resting + CAPTURE_HAIRLINE + 3 * CAPTURE_PREDICTION_ROW,
    )
  })

  it('grows for a refusal rather than taking the room from the field', () => {
    // The field is a fixed height in the panel, so the only way the Body stays
    // whole under a refusal is for the window itself to be taller.
    expect(captureWindowHeight({ predictions: 0, refused: true })).toBe(
      captureWindowHeight({ predictions: 0, refused: false }) +
        CAPTURE_REFUSAL_HEIGHT,
    )
    expect(captureWindowHeight({ predictions: 2, refused: true })).toBe(
      captureWindowHeight({ predictions: 2, refused: false }) +
        CAPTURE_REFUSAL_HEIGHT,
    )
  })
})
