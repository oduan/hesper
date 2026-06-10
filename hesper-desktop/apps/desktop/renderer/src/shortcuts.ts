export type ShortcutActions = {
  send: () => void
  closePanels: () => void
  quickSwitch: () => void
  jumpMessage: (direction: 'previous' | 'next', assistantOnly: boolean) => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export function createShortcutHandler(actions: ShortcutActions) {
  return (event: KeyboardEvent) => {
    const inEditable = isEditableTarget(event.target)

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      actions.send()
      return
    }

    if (inEditable) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      actions.closePanels()
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      actions.quickSwitch()
      return
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      actions.jumpMessage(event.key === 'ArrowUp' ? 'previous' : 'next', event.shiftKey)
    }
  }
}
