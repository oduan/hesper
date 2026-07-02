const fullscreenDialogStack: string[] = []
const activeFullscreenDialogIds = new Set<string>()

export function pushFullscreenDialog(dialogId: string): void {
  fullscreenDialogStack.push(dialogId)
  activeFullscreenDialogIds.add(dialogId)
}

export function removeFullscreenDialog(dialogId: string): void {
  activeFullscreenDialogIds.delete(dialogId)
  for (let index = fullscreenDialogStack.length - 1; index >= 0; index -= 1) {
    if (fullscreenDialogStack[index] === dialogId) {
      fullscreenDialogStack.splice(index, 1)
    }
  }
}

export function isTopFullscreenDialog(dialogId: string): boolean {
  pruneStaleFullscreenDialogs()
  return fullscreenDialogStack[fullscreenDialogStack.length - 1] === dialogId
}

export function fullscreenDialogDataAttributes(dialogId: string): { 'data-hesper-fullscreen-dialog-id': string } {
  return { 'data-hesper-fullscreen-dialog-id': dialogId }
}

function pruneStaleFullscreenDialogs(): void {
  while (fullscreenDialogStack.length > 0) {
    const topDialogId = fullscreenDialogStack[fullscreenDialogStack.length - 1]
    if (topDialogId && activeFullscreenDialogIds.has(topDialogId) && isFullscreenDialogConnected(topDialogId)) {
      return
    }
    if (topDialogId) activeFullscreenDialogIds.delete(topDialogId)
    fullscreenDialogStack.pop()
  }
}

function isFullscreenDialogConnected(dialogId: string): boolean {
  if (typeof document === 'undefined') return true
  return Boolean(document.querySelector(`[data-hesper-fullscreen-dialog-id=${JSON.stringify(dialogId)}]`))
}
