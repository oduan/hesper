// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoulSettingsPanel } from '../src/soul-settings-panel'

describe('SoulSettingsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('debounces idle saves until 300ms elapses', () => {
    const onUpdate = vi.fn()

    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    expect(onUpdate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(onUpdate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ soul: '新的身份' })
  })

  it('uses the latest onUpdate without postponing an in-flight debounce timer', () => {
    const firstOnUpdate = vi.fn()
    const latestOnUpdate = vi.fn()

    const { rerender } = render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={firstOnUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    act(() => {
      vi.advanceTimersByTime(150)
    })

    rerender(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={latestOnUpdate} />)

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(firstOnUpdate).not.toHaveBeenCalled()
    expect(latestOnUpdate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(firstOnUpdate).not.toHaveBeenCalled()
    expect(latestOnUpdate).toHaveBeenCalledTimes(1)
    expect(latestOnUpdate).toHaveBeenCalledWith({ soul: '新的身份' })
  })

  it('flushes immediately on blur without waiting for the debounce window', () => {
    const onUpdate = vi.fn()

    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })
    fireEvent.blur(textarea)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ soul: '新的身份' })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('cleans up pending saves on unmount', () => {
    const onUpdate = vi.fn()

    const { unmount } = render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    unmount()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('syncs the draft when settings.soul changes externally', () => {
    const onUpdate = vi.fn()

    const { rerender } = render(<SoulSettingsPanel settings={{ soul: '初始身份' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    expect(textarea).toHaveValue('初始身份')

    rerender(<SoulSettingsPanel settings={{ soul: '外部同步身份' }} onUpdate={onUpdate} />)

    expect(textarea).toHaveValue('外部同步身份')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
