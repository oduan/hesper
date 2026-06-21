const fullscreenDialogStack: string[] = []

export function pushFullscreenDialog(dialogId: string): void {
  fullscreenDialogStack.push(dialogId)
}

export function removeFullscreenDialog(dialogId: string): void {
  const index = fullscreenDialogStack.lastIndexOf(dialogId)
  if (index >= 0) {
    fullscreenDialogStack.splice(index, 1)
  }
}

export function isTopFullscreenDialog(dialogId: string): boolean {
  return fullscreenDialogStack[fullscreenDialogStack.length - 1] === dialogId
}
