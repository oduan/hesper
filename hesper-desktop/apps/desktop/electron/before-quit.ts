export type BeforeQuitEvent = {
  preventDefault(): void
}

export type BeforeQuitHandlerOptions = {
  flushScheduledPersistence(): Promise<void>
  savePersistence(): Promise<void>
  disposeIpcHandlers(): void
  quit(): void
  logError(message: string, error: unknown): void
}

export function createBeforeQuitHandler(options: BeforeQuitHandlerOptions) {
  let quitSequenceStarted = false
  let quitSequenceFinished = false
  let disposeCalled = false

  return (event: BeforeQuitEvent) => {
    if (quitSequenceFinished || quitSequenceStarted) {
      return
    }

    quitSequenceStarted = true
    event.preventDefault()

    void (async () => {
      try {
        await options.flushScheduledPersistence()
        await options.savePersistence()
      } catch (error) {
        options.logError('Failed to flush persistence before quit.', error)
      } finally {
        if (!disposeCalled) {
          disposeCalled = true
          options.disposeIpcHandlers()
        }
        quitSequenceFinished = true
        options.quit()
      }
    })()
  }
}
