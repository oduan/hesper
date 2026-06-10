// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createShortcutHandler } from '../src/shortcuts'

function dispatchToTarget(handler: ReturnType<typeof createShortcutHandler>, target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', init)
  Object.defineProperty(event, 'target', { configurable: true, value: target })
  handler(event)
}

describe('shortcuts', () => {
  it('maps ctrl enter to send', () => {
    const send = vi.fn()
    const handler = createShortcutHandler({ send, closePanels: vi.fn(), quickSwitch: vi.fn(), jumpMessage: vi.fn() })

    handler(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('maps escape to close panels', () => {
    const closePanels = vi.fn()
    const handler = createShortcutHandler({ send: vi.fn(), closePanels, quickSwitch: vi.fn(), jumpMessage: vi.fn() })

    handler(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(closePanels).toHaveBeenCalledTimes(1)
  })

  it('maps ctrl or cmd k to quick switch', () => {
    const quickSwitch = vi.fn()
    const handler = createShortcutHandler({ send: vi.fn(), closePanels: vi.fn(), quickSwitch, jumpMessage: vi.fn() })

    handler(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))

    expect(quickSwitch).toHaveBeenCalledTimes(1)
  })

  it('maps alt arrows to jump messages and assistant outputs', () => {
    const jumpMessage = vi.fn()
    const handler = createShortcutHandler({ send: vi.fn(), closePanels: vi.fn(), quickSwitch: vi.fn(), jumpMessage })

    handler(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }))
    handler(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, shiftKey: true }))

    expect(jumpMessage).toHaveBeenNthCalledWith(1, 'previous', false)
    expect(jumpMessage).toHaveBeenNthCalledWith(2, 'next', true)
  })

  it('does not hijack quick switch, escape or jump inside editable controls', () => {
    const closePanels = vi.fn()
    const quickSwitch = vi.fn()
    const jumpMessage = vi.fn()
    const handler = createShortcutHandler({ send: vi.fn(), closePanels, quickSwitch, jumpMessage })
    const textarea = document.createElement('textarea')

    dispatchToTarget(handler, textarea, { key: 'Escape' })
    dispatchToTarget(handler, textarea, { key: 'k', ctrlKey: true })
    dispatchToTarget(handler, textarea, { key: 'ArrowDown', altKey: true })

    expect(closePanels).not.toHaveBeenCalled()
    expect(quickSwitch).not.toHaveBeenCalled()
    expect(jumpMessage).not.toHaveBeenCalled()
  })

  it('still allows ctrl enter send from textarea', () => {
    const send = vi.fn()
    const handler = createShortcutHandler({ send, closePanels: vi.fn(), quickSwitch: vi.fn(), jumpMessage: vi.fn() })
    const textarea = document.createElement('textarea')

    dispatchToTarget(handler, textarea, { key: 'Enter', ctrlKey: true })

    expect(send).toHaveBeenCalledTimes(1)
  })
})
