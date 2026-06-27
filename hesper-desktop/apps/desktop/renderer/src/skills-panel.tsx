import type { CSSProperties } from 'react'
import type { SkillDto } from '../../electron/ipc-contract'

export type SkillsPanelProps = {
  skills: SkillDto[]
  selectedSkill?: SkillDto
  loading?: boolean
  error?: string
}

export function SkillsPanel({ skills, selectedSkill, loading = false, error }: SkillsPanelProps) {
  if (loading) {
    return (
      <section aria-label="技能详情" style={panelCenterStyle}>
        <div>
          <h2 style={emptyTitleStyle}>正在加载技能…</h2>
          <p style={mutedTextStyle}>正在扫描并读取可用的 SKILL.md 文件。</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section aria-label="技能详情" style={panelCenterStyle}>
        <div>
          <h2 style={emptyTitleStyle}>技能加载失败</h2>
          <p role="alert" style={errorTextStyle}>{error}</p>
        </div>
      </section>
    )
  }

  if (!selectedSkill) {
    return (
      <section aria-label="技能详情" style={panelCenterStyle}>
        <div>
          <h2 style={emptyTitleStyle}>{skills.length > 0 ? '请选择一个技能' : '暂无技能'}</h2>
          <p style={mutedTextStyle}>{skills.length > 0 ? '从左侧技能列表选择一项查看说明。' : '后台尚未扫描到可用技能。'}</p>
        </div>
      </section>
    )
  }

  const description = selectedSkill.description || '暂无简介'
  const prompt = selectedSkill.prompt?.trim() || '暂无技能说明'

  return (
    <section aria-label="技能详情" className="hesper-theme-scrollbar" style={panelStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>技能</p>
          <h2 style={titleStyle}>{selectedSkill.name}</h2>
          <p style={descriptionStyle}>{description}</p>
        </div>
      </header>

      <section aria-label="技能元数据" style={cardStyle}>
        <h3 style={cardTitleStyle}>元数据</h3>
        <dl style={metadataGridStyle}>
          <MetadataItem label="标识符" value={selectedSkill.id} />
          <MetadataItem label="名称" value={selectedSkill.name} />
          <MetadataItem label="描述" value={description} />
        </dl>
      </section>

      <section aria-label="技能说明" style={cardStyle}>
        <h3 style={cardTitleStyle}>技能说明</h3>
        <pre style={promptStyle}>{prompt}</pre>
      </section>
    </section>
  )
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={metadataItemStyle}>
      <dt style={metadataLabelStyle}>{label}</dt>
      <dd style={metadataValueStyle}>{value}</dd>
    </div>
  )
}

const panelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 16,
  paddingRight: 4
}

const panelCenterStyle: CSSProperties = {
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  padding: 24,
  border: '1px solid var(--hesper-color-border, #2b3046)',
  borderRadius: 14,
  background: 'var(--hesper-color-surface-muted, #202436)'
}

const headerStyle: CSSProperties = {
  border: '1px solid var(--hesper-color-border, #2b3046)',
  borderRadius: 14,
  background: 'var(--hesper-color-surface-muted, #202436)',
  padding: 20
}

const eyebrowStyle: CSSProperties = {
  margin: '0 0 8px',
  color: 'var(--hesper-color-text-muted, #737aa2)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em'
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  lineHeight: '28px'
}

const emptyTitleStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 16
}

const descriptionStyle: CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  lineHeight: 1.6
}

const mutedTextStyle: CSSProperties = {
  margin: 0,
  color: 'var(--hesper-color-text-muted, #9aa5ce)'
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  color: '#fca5a5'
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--hesper-color-border, #2b3046)',
  borderRadius: 14,
  background: 'var(--hesper-color-surface-muted, #202436)',
  padding: 18
}

const cardTitleStyle: CSSProperties = {
  margin: '0 0 14px',
  fontSize: 14
}

const metadataGridStyle: CSSProperties = {
  margin: 0,
  display: 'grid',
  gap: 10
}

const metadataItemStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'baseline'
}

const metadataLabelStyle: CSSProperties = {
  color: 'var(--hesper-color-text-muted, #737aa2)',
  fontSize: 12,
  fontWeight: 700
}

const metadataValueStyle: CSSProperties = {
  margin: 0,
  minWidth: 0,
  overflowWrap: 'anywhere'
}

const promptStyle: CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  color: 'var(--hesper-color-text, #c0caf5)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.7
}
