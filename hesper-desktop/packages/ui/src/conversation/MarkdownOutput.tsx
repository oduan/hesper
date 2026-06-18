import { createElement, memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import { darkTheme } from '../theme'

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'code'; language?: string; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' }

export type MarkdownOutputProps = {
  content: string
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line)
}

function isFence(line: string): boolean {
  return /^```/.test(line.trim())
}

function isUnorderedListItem(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line)
}

function isOrderedListItem(line: string): boolean {
  return /^\s*\d+[.)]\s+/.test(line)
}

function isBlockquote(line: string): boolean {
  return /^>\s?/.test(line)
}

function isRule(line: string): boolean {
  return /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isTableStart(line: string, nextLine: string | undefined): boolean {
  if (!nextLine || !line.includes('|')) return false
  return splitTableRow(line).length > 1 && isTableSeparator(nextLine)
}

function isTableRow(line: string): boolean {
  return line.includes('|') && splitTableRow(line).length > 1
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount) return cells
  if (cells.length > columnCount) return cells.slice(0, columnCount)
  return [...cells, ...Array.from({ length: columnCount - cells.length }, () => '')]
}

function startsBlock(line: string, nextLine?: string): boolean {
  return isBlank(line) || isHeading(line) || isFence(line) || isUnorderedListItem(line) || isOrderedListItem(line) || isBlockquote(line) || isRule(line) || isTableStart(line, nextLine)
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlank(line)) {
      index += 1
      continue
    }

    const fenceMatch = line.trim().match(/^```([^`]*)$/)
    if (fenceMatch) {
      const language = fenceMatch[1]?.trim() || undefined
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !isFence(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', ...(language ? { language } : {}), text: codeLines.join('\n') })
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, text: headingMatch[2]!.trim() })
      index += 1
      continue
    }

    if (isTableStart(line, lines[index + 1])) {
      const headers = splitTableRow(line)
      const rows: string[][] = []
      const columnCount = headers.length
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(normalizeTableRow(splitTableRow(lines[index] ?? ''), columnCount))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    if (isUnorderedListItem(line)) {
      const items: string[] = []
      while (index < lines.length && isUnorderedListItem(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/, '').trim())
        index += 1
      }
      blocks.push({ type: 'unordered-list', items })
      continue
    }

    if (isOrderedListItem(line)) {
      const items: string[] = []
      while (index < lines.length && isOrderedListItem(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, '').trim())
        index += 1
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && isBlockquote(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^>\s?/, '').trim())
        index += 1
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') })
      continue
    }

    if (isRule(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && !startsBlock(lines[index] ?? '', lines[index + 1])) {
      paragraphLines.push((lines[index] ?? '').trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  return blocks
}

function safeHref(href: string): string | undefined {
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return trimmed

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

function pushText(nodes: ReactNode[], text: string, key: string): void {
  if (text) nodes.push(<span key={key}>{text}</span>)
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = 0
  let textKey = 0

  while (index < text.length) {
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2)
      if (end !== -1) {
        nodes.push(<strong key={`${keyPrefix}-strong-${index}`} style={strongStyle}>{renderInline(text.slice(index + 2, end), `${keyPrefix}-strong-${index}`)}</strong>)
        index = end + 2
        continue
      }
    }

    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1)
      if (end !== -1) {
        nodes.push(<code key={`${keyPrefix}-code-${index}`} style={inlineCodeStyle}>{text.slice(index + 1, end)}</code>)
        index = end + 1
        continue
      }
    }

    if (text[index] === '[') {
      const match = text.slice(index).match(/^\[([^\]]+)]\(([^)\s]+)\)/)
      if (match) {
        const label = match[1]!
        const href = safeHref(match[2]!)
        nodes.push(href ? (
          <a key={`${keyPrefix}-link-${index}`} href={href} target="_blank" rel="noreferrer" style={linkStyle}>{label}</a>
        ) : (
          <span key={`${keyPrefix}-link-${index}`}>{label}</span>
        ))
        index += match[0].length
        continue
      }
    }

    const nextSpecialCandidates = [
      text.indexOf('**', index + 1),
      text.indexOf('`', index + 1),
      text.indexOf('[', index + 1)
    ].filter((candidate) => candidate !== -1)
    const nextSpecial = nextSpecialCandidates.length > 0 ? Math.min(...nextSpecialCandidates) : text.length
    pushText(nodes, text.slice(index, nextSpecial), `${keyPrefix}-text-${textKey}`)
    textKey += 1
    index = nextSpecial
  }

  return nodes
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return createElement(tag, { key: index, style: headingStyle(block.level) }, renderInline(block.text, `heading-${index}`))
    }
    case 'paragraph':
      return <p key={index} style={paragraphStyle}>{renderInline(block.text, `paragraph-${index}`)}</p>
    case 'unordered-list':
      return <ul key={index} style={listStyle}>{block.items.map((item, itemIndex) => <li key={itemIndex} style={listItemStyle}>{renderInline(item, `ul-${index}-${itemIndex}`)}</li>)}</ul>
    case 'ordered-list':
      return <ol key={index} style={listStyle}>{block.items.map((item, itemIndex) => <li key={itemIndex} style={listItemStyle}>{renderInline(item, `ol-${index}-${itemIndex}`)}</li>)}</ol>
    case 'code':
      return (
        <pre key={index} style={codeBlockStyle}>
          <code>{block.text}</code>
        </pre>
      )
    case 'blockquote':
      return <blockquote key={index} style={blockquoteStyle}>{renderInline(block.text, `blockquote-${index}`)}</blockquote>
    case 'table':
      return (
        <div key={index} style={tableWrapStyle} className="hesper-theme-scrollbar">
          <table style={tableStyle}>
            <thead>
              <tr>
                {block.headers.map((header, headerIndex) => (
                  <th key={headerIndex} scope="col" style={tableHeaderStyle}>{renderInline(header, `table-${index}-header-${headerIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={tableCellStyle}>{renderInline(cell, `table-${index}-row-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr key={index} style={ruleStyle} />
  }
}

export const MarkdownOutput = memo(function MarkdownOutput({ content }: MarkdownOutputProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  return <div style={rootStyle}>{blocks.map(renderBlock)}</div>
})

const rootStyle: CSSProperties = {
  lineHeight: 1.6,
  fontSize: darkTheme.typography.body,
  color: darkTheme.color.text
}

function headingStyle(level: number): CSSProperties {
  return {
    margin: level <= 2 ? '0 0 10px' : '10px 0 8px',
    fontSize: darkTheme.typography.body,
    lineHeight: 1.3,
    fontWeight: 750
  }
}

const paragraphStyle: CSSProperties = {
  margin: '0 0 10px'
}

const listStyle: CSSProperties = {
  margin: '0 0 10px 1.25em',
  padding: 0,
  display: 'grid',
  gap: 4
}

const listItemStyle: CSSProperties = {
  paddingLeft: 2
}

const strongStyle: CSSProperties = {
  fontWeight: 700
}

const inlineCodeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '1em',
  color: darkTheme.color.text,
  background: 'rgba(255, 255, 255, 0.07)',
  borderRadius: darkTheme.radius.sm,
  padding: '1px 5px'
}

const codeBlockStyle: CSSProperties = {
  margin: '0 0 10px',
  padding: darkTheme.spacing.md,
  overflow: 'auto',
  borderRadius: darkTheme.radius.md,
  background: darkTheme.color.surface,
  color: darkTheme.color.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: darkTheme.typography.body,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap'
}

const linkStyle: CSSProperties = {
  color: darkTheme.color.accent,
  textDecoration: 'underline'
}

const blockquoteStyle: CSSProperties = {
  margin: '0 0 10px',
  padding: `0 0 0 ${darkTheme.spacing.md}`,
  borderLeft: `3px solid ${darkTheme.color.border}`,
  color: darkTheme.color.textMuted
}

const tableWrapStyle: CSSProperties = {
  margin: '0 0 10px',
  overflowX: 'auto'
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: darkTheme.typography.body
}

const tableHeaderStyle: CSSProperties = {
  textAlign: 'left',
  padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
  borderBottom: `1px solid ${darkTheme.color.border}`,
  color: darkTheme.color.text,
  fontWeight: 700,
  background: 'rgba(255, 255, 255, 0.035)'
}

const tableCellStyle: CSSProperties = {
  padding: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
  borderBottom: `1px solid ${darkTheme.color.border}`,
  verticalAlign: 'top'
}

const ruleStyle: CSSProperties = {
  border: 0,
  borderTop: `1px solid ${darkTheme.color.border}`,
  margin: `${darkTheme.spacing.md} 0`
}
