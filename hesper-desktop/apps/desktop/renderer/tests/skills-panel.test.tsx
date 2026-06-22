// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillsPanel } from '../src/skills-panel'

const skill = {
  id: '写作助手',
  name: '写作助手',
  description: '帮助整理文案',
  source: 'workspace' as const,
  prompt: '# 写作助手\n\n请先理解上下文，再输出清晰文案。'
}

describe('SkillsPanel', () => {
  afterEach(() => cleanup())

  it('renders selected skill metadata and prompt', () => {
    render(<SkillsPanel skills={[skill]} selectedSkill={skill} />)

    expect(screen.getByRole('region', { name: '技能详情' })).toHaveTextContent('写作助手')
    expect(screen.getAllByText('帮助整理文案')).toHaveLength(2)

    const metadata = screen.getByRole('region', { name: '技能元数据' })
    expect(within(metadata).getByText('标识符')).toBeInTheDocument()
    expect(within(metadata).getAllByText('写作助手')).toHaveLength(2)
    expect(within(metadata).getByText('名称')).toBeInTheDocument()
    expect(within(metadata).getByText('描述')).toBeInTheDocument()

    const instructions = screen.getByRole('region', { name: '技能说明' })
    expect(instructions).toHaveTextContent('# 写作助手')
    expect(instructions).toHaveTextContent('请先理解上下文')
  })

  it('supports empty, loading and error states', () => {
    const { rerender } = render(<SkillsPanel skills={[]} />)
    expect(screen.getByText('暂无技能')).toBeInTheDocument()
    expect(screen.getByText('后台尚未扫描到可用技能。')).toBeInTheDocument()

    rerender(<SkillsPanel skills={[skill]} />)
    expect(screen.getByText('请选择一个技能')).toBeInTheDocument()

    rerender(<SkillsPanel skills={[]} loading />)
    expect(screen.getByText('正在加载技能…')).toBeInTheDocument()

    rerender(<SkillsPanel skills={[]} error="permission denied" />)
    expect(screen.getByText('技能加载失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('permission denied')
  })

  it('renders fallback text for missing description and prompt', () => {
    render(<SkillsPanel skills={[{ id: '笔记', name: '笔记', source: 'builtin' }]} selectedSkill={{ id: '笔记', name: '笔记', source: 'builtin' }} />)

    expect(screen.getAllByText('暂无简介')).toHaveLength(2)
    expect(screen.getByRole('region', { name: '技能说明' })).toHaveTextContent('暂无技能说明')
  })
})
