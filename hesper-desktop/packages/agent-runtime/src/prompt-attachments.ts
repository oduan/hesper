import type { MessageAttachment } from '@hesper/shared'

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function renderTextAttachment(attachment: MessageAttachment, content: string): string {
  return `<attachment name="${escapeXmlAttribute(attachment.name)}" mimeType="${escapeXmlAttribute(attachment.mimeType)}">\n${content}\n</attachment>`
}

export function estimateRenderedTextAttachmentLength(attachment: MessageAttachment): number {
  return renderTextAttachment(attachment, '').length + Math.max(0, attachment.bytes)
}
