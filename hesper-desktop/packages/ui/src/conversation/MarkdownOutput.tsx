import { createElement, memo, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { themeTokens } from '../theme'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

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
  onLocalFileClick?: ((path: string) => void) | undefined
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

function isWorkspaceHref(href: string): boolean {
  return href.trim().startsWith('workspace:')
}

function normalizeWorkspacePath(href: string): string | undefined {
  const trimmed = href.trim()
  if (!trimmed.startsWith('workspace:')) return undefined

  const encodedPath = trimmed.slice('workspace:'.length)
  if (!encodedPath || /\s/.test(encodedPath)) return undefined

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return undefined
  }

  const normalizedPath = decodedPath.replace(/\\/g, '/')
  if (!normalizedPath || normalizedPath.trim() === '' || normalizedPath.includes('\0')) return undefined
  if (normalizedPath.startsWith('/')) return undefined
  if (/^[A-Za-z]:/.test(normalizedPath)) return undefined
  if (normalizedPath.split('/').some((segment) => segment === '..')) return undefined

  return normalizedPath
}

function pushText(nodes: ReactNode[], text: string, key: string): void {
  if (text) nodes.push(<span key={key}>{text}</span>)
}

function renderInline(text: string, keyPrefix: string, onLocalFileClick?: ((path: string) => void) | undefined): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = 0
  let textKey = 0

  while (index < text.length) {
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2)
      if (end !== -1) {
        nodes.push(<strong key={`${keyPrefix}-strong-${index}`} style={strongStyle}>{renderInline(text.slice(index + 2, end), `${keyPrefix}-strong-${index}`, onLocalFileClick)}</strong>)
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
      const match = text.slice(index).match(/^\[([^\]]+)]\(([^)]*)\)/)
      if (match) {
        const label = match[1]!
        const rawHref = match[2]!
        if (isWorkspaceHref(rawHref)) {
          const workspacePath = normalizeWorkspacePath(rawHref)
          nodes.push(workspacePath ? (
            <a
              key={`${keyPrefix}-link-${index}`}
              href={rawHref.trim()}
              style={linkStyle}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                event.preventDefault()
                event.stopPropagation()
                onLocalFileClick?.(workspacePath)
              }}
            >
              {label}
            </a>
          ) : (
            <span key={`${keyPrefix}-link-${index}`}>{label}</span>
          ))
        } else if (!/\s/.test(rawHref) && rawHref) {
          const href = safeHref(rawHref)
          nodes.push(href ? (
            <a key={`${keyPrefix}-link-${index}`} href={href} target="_blank" rel="noreferrer" style={linkStyle}>{label}</a>
          ) : (
            <span key={`${keyPrefix}-link-${index}`}>{label}</span>
          ))
        } else {
          pushText(nodes, match[0], `${keyPrefix}-text-${textKey}`)
          textKey += 1
        }
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

function normalizeCodeLanguage(language: string | undefined): string | undefined {
  const normalized = (language ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (!normalized) return undefined

  switch (normalized) {
    case 'js':
    case 'javascript':
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'typescript':
    case 'tsx':
      return 'typescript'
    case 'py':
    case 'python':
      return 'python'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'sh':
    case 'shell':
    case 'bash':
      return 'bash'
    case 'html':
    case 'xml':
      return 'xml'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'json':
    case 'css':
      return normalized
    default:
      return undefined
  }
}

function highlightCodeBlock(block: Extract<MarkdownBlock, { type: 'code' }>): { language: string; html: string } | undefined {
  const language = normalizeCodeLanguage(block.language)
  if (!language) return undefined

  try {
    return { language, html: hljs.highlight(block.text, { language, ignoreIllegals: true }).value }
  } catch {
    return undefined
  }
}

function codeLanguageLabel(language: string | undefined): string {
  const normalized = (language ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (!normalized) return 'Text'

  switch (normalized) {
    case 'js':
    case 'javascript':
      return 'JS'
    case 'ts':
    case 'typescript':
      return 'TS'
    case 'py':
    case 'python':
      return 'Python'
    case 'md':
    case 'markdown':
      return 'Markdown'
    case 'json':
      return 'JSON'
    default:
      return normalized.length <= 4 ? normalized.toUpperCase() : `${normalized[0]!.toUpperCase()}${normalized.slice(1)}`
  }
}

function CopyCodeIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.4" />
      <path d="M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5" />
    </svg>
  )
}

function renderBlock(block: MarkdownBlock, index: number, onLocalFileClick?: ((path: string) => void) | undefined): ReactNode {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return createElement(tag, { key: index, style: headingStyle(block.level) }, renderInline(block.text, `heading-${index}`, onLocalFileClick))
    }
    case 'paragraph':
      return <p key={index} style={paragraphStyle}>{renderInline(block.text, `paragraph-${index}`, onLocalFileClick)}</p>
    case 'unordered-list':
      return <ul key={index} style={listStyle}>{block.items.map((item, itemIndex) => <li key={itemIndex} style={listItemStyle}>{renderInline(item, `ul-${index}-${itemIndex}`, onLocalFileClick)}</li>)}</ul>
    case 'ordered-list':
      return <ol key={index} style={listStyle}>{block.items.map((item, itemIndex) => <li key={itemIndex} style={listItemStyle}>{renderInline(item, `ol-${index}-${itemIndex}`, onLocalFileClick)}</li>)}</ol>
    case 'code': {
      const highlightedCode = highlightCodeBlock(block)
      return (
        <div key={index} style={codeBlockWrapStyle}>
          <div style={codeBlockTitleBarStyle}>
            <span style={codeBlockLanguageStyle}>{codeLanguageLabel(block.language)}</span>
            <button
              type="button"
              aria-label="复制代码块"
              style={codeBlockCopyButtonStyle}
              onClick={() => {
                void navigator.clipboard?.writeText(block.text)
              }}
            >
              <CopyCodeIcon />
            </button>
          </div>
          <pre data-hesper-markdown-code-scroll="true" style={codeBlockStyle} className="hesper-theme-scrollbar">
            {highlightedCode ? (
              <code className={`hljs language-${highlightedCode.language}`} dangerouslySetInnerHTML={{ __html: highlightedCode.html }} />
            ) : (
              <code>{block.text}</code>
            )}
          </pre>
        </div>
      )
    }
    case 'blockquote':
      return <blockquote key={index} style={blockquoteStyle}>{renderInline(block.text, `blockquote-${index}`, onLocalFileClick)}</blockquote>
    case 'table':
      return (
        <div key={index} data-hesper-markdown-table-scroll="true" style={tableWrapStyle} className="hesper-theme-scrollbar">
          <table style={tableStyle}>
            <thead>
              <tr>
                {block.headers.map((header, headerIndex) => (
                  <th key={headerIndex} scope="col" style={tableHeaderStyle}>{renderInline(header, `table-${index}-header-${headerIndex}`, onLocalFileClick)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={tableCellStyle}>{renderInline(cell, `table-${index}-row-${rowIndex}-${cellIndex}`, onLocalFileClick)}</td>
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

export const MarkdownOutput = memo(function MarkdownOutput({ content, onLocalFileClick }: MarkdownOutputProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  return (
    <div style={rootStyle}>
      <style>{codeHighlightStyle}</style>
      {blocks.map((block, index) => renderBlock(block, index, onLocalFileClick))}
    </div>
  )
})

const rootStyle: CSSProperties = {
  minWidth: 0,
  maxWidth: '100%',
  lineHeight: 1.6,
  fontSize: themeTokens.typography.body,
  color: themeTokens.color.text
}

function headingStyle(level: number): CSSProperties {
  return {
    margin: level <= 2 ? '0 0 10px' : '10px 0 8px',
    fontSize: themeTokens.typography.body,
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
  fontFamily: 'var(--hesper-font-family-mono, "JetBrains Mono", "Cascadia Code", SFMono-Regular, Menlo, Consolas, monospace)',
  fontSize: '1em',
  color: themeTokens.color.text,
  background: themeTokens.color.softControl,
  borderRadius: themeTokens.radius.sm,
  padding: '1px 5px'
}

const codeHighlightStyle = `
[data-hesper-markdown-code-scroll="true"] code .hljs-keyword,
[data-hesper-markdown-code-scroll="true"] code .hljs-selector-tag,
[data-hesper-markdown-code-scroll="true"] code .hljs-built_in {
  color: #8f4bb8;
}
[data-hesper-markdown-code-scroll="true"] code .hljs-string,
[data-hesper-markdown-code-scroll="true"] code .hljs-attr,
[data-hesper-markdown-code-scroll="true"] code .hljs-template-variable {
  color: #2f7d32;
}
[data-hesper-markdown-code-scroll="true"] code .hljs-number,
[data-hesper-markdown-code-scroll="true"] code .hljs-literal,
[data-hesper-markdown-code-scroll="true"] code .hljs-symbol {
  color: #986801;
}
[data-hesper-markdown-code-scroll="true"] code .hljs-title,
[data-hesper-markdown-code-scroll="true"] code .hljs-function,
[data-hesper-markdown-code-scroll="true"] code .hljs-selector-id,
[data-hesper-markdown-code-scroll="true"] code .hljs-selector-class {
  color: #2563b8;
}
[data-hesper-markdown-code-scroll="true"] code .hljs-comment,
[data-hesper-markdown-code-scroll="true"] code .hljs-quote {
  color: #6b7280;
}
[data-hesper-markdown-code-scroll="true"] code .hljs-meta,
[data-hesper-markdown-code-scroll="true"] code .hljs-tag,
[data-hesper-markdown-code-scroll="true"] code .hljs-name {
  color: #a2412f;
}
@media (prefers-color-scheme: dark) {
  [data-hesper-markdown-code-scroll="true"] code .hljs-keyword,
  [data-hesper-markdown-code-scroll="true"] code .hljs-selector-tag,
  [data-hesper-markdown-code-scroll="true"] code .hljs-built_in {
    color: #d6a3f0;
  }
  [data-hesper-markdown-code-scroll="true"] code .hljs-string,
  [data-hesper-markdown-code-scroll="true"] code .hljs-attr,
  [data-hesper-markdown-code-scroll="true"] code .hljs-template-variable {
    color: #8fd694;
  }
  [data-hesper-markdown-code-scroll="true"] code .hljs-number,
  [data-hesper-markdown-code-scroll="true"] code .hljs-literal,
  [data-hesper-markdown-code-scroll="true"] code .hljs-symbol {
    color: #f2c97d;
  }
  [data-hesper-markdown-code-scroll="true"] code .hljs-title,
  [data-hesper-markdown-code-scroll="true"] code .hljs-function,
  [data-hesper-markdown-code-scroll="true"] code .hljs-selector-id,
  [data-hesper-markdown-code-scroll="true"] code .hljs-selector-class {
    color: #8ab4f8;
  }
  [data-hesper-markdown-code-scroll="true"] code .hljs-comment,
  [data-hesper-markdown-code-scroll="true"] code .hljs-quote {
    color: #9ca3af;
  }
  [data-hesper-markdown-code-scroll="true"] code .hljs-meta,
  [data-hesper-markdown-code-scroll="true"] code .hljs-tag,
  [data-hesper-markdown-code-scroll="true"] code .hljs-name {
    color: #f0a08d;
  }
}
`

const codeBlockWrapStyle: CSSProperties = {
  maxWidth: '100%',
  minWidth: 0,
  margin: '0 0 10px',
  overflow: 'hidden',
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.codeBackground,
  boxShadow: `0 2px 6px -4px ${themeTokens.color.shadow}`
}

const codeBlockTitleBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: themeTokens.spacing.sm,
  minWidth: 0,
  minHeight: 30,
  padding: `0 ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  background: themeTokens.color.softControl,
  color: themeTokens.color.textMuted
}

const codeBlockLanguageStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '12px',
  lineHeight: 1,
  fontWeight: 600
}

const codeBlockCopyButtonStyle: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  flex: '0 0 auto',
  width: 24,
  height: 24,
  padding: 0,
  border: 0,
  borderRadius: themeTokens.radius.sm,
  background: 'transparent',
  color: themeTokens.color.textMuted,
  cursor: 'pointer'
}

const codeBlockStyle: CSSProperties = {
  maxWidth: '100%',
  minWidth: 0,
  margin: 0,
  padding: themeTokens.spacing.md,
  overflowX: 'auto',
  overflowY: 'hidden',
  background: themeTokens.color.codeBackground,
  color: themeTokens.color.text,
  fontFamily: 'var(--hesper-font-family-mono, "JetBrains Mono", "Cascadia Code", SFMono-Regular, Menlo, Consolas, monospace)',
  fontSize: themeTokens.typography.body,
  lineHeight: 1.5,
  whiteSpace: 'pre'
}

const linkStyle: CSSProperties = {
  color: themeTokens.color.accent,
  textDecoration: 'underline'
}

const blockquoteStyle: CSSProperties = {
  margin: '0 0 10px',
  padding: `0 0 0 ${themeTokens.spacing.md}`,
  borderLeft: `3px solid ${themeTokens.color.border}`,
  color: themeTokens.color.textMuted
}

const tableWrapStyle: CSSProperties = {
  maxWidth: '100%',
  minWidth: 0,
  margin: '0 0 10px',
  overflowX: 'auto',
  overflowY: 'hidden'
}

const tableStyle: CSSProperties = {
  width: 'max-content',
  minWidth: '100%',
  borderCollapse: 'collapse',
  fontSize: themeTokens.typography.body
}

const tableHeaderStyle: CSSProperties = {
  textAlign: 'left',
  padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.border}`,
  color: themeTokens.color.text,
  fontWeight: 700,
  background: themeTokens.color.surfaceMuted
}

const tableCellStyle: CSSProperties = {
  padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.border}`,
  verticalAlign: 'top'
}

const ruleStyle: CSSProperties = {
  border: 0,
  borderTop: `1px solid ${themeTokens.color.border}`,
  margin: `${themeTokens.spacing.md} 0`
}
