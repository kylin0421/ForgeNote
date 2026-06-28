import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  LearningAssetPreview,
  MarkdownLikeAsset,
  normalizeMarkdownContent,
  serializeLearningAssetNote,
} from './LearningAssetPreview'
import type { LearningResource } from '@/lib/types/learning'

describe('normalizeMarkdownContent', () => {
  it('repairs table rows where bold markers were split across lines', () => {
    const input = [
      '# Section',
      '',
      '| Concept | Difference |',
      '|----------|------------|',
      '| **Self-supervised vs unsupervised*',
      '* | Uses pretext labels instead of direct human labels. |',
    ].join('\n')

    const normalized = normalizeMarkdownContent(input)

    expect(normalized).toContain(
      '| **Self-supervised vs unsupervised** | Uses pretext labels instead of direct human labels. |'
    )
    expect(normalized).not.toContain('*\n* |')
  })

  it('renders repaired malformed table content as a table', () => {
    const input = [
      '| Concept | Difference |',
      '|----------|------------|',
      '| **Self-supervised vs unsupervised*',
      '* | Uses pretext labels instead of direct human labels. |',
    ].join('\n')

    render(<MarkdownLikeAsset content={input} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Self-supervised vs unsupervised')).toBeInTheDocument()
  })

  it('does not split list-like text inside table cells', () => {
    const input = [
      '| Concept | Difference |',
      '| --- | --- |',
      '| generation - contrast | Keep this on one table row. |',
    ].join('\n')

    expect(normalizeMarkdownContent(input)).toContain(
      '| generation - contrast | Keep this on one table row. |'
    )
  })

  it('normalizes common malformed table syntax', () => {
    const input = [
      '｜ Concept ｜ Difference ｜',
      '｜ A ｜ B ｜',
      '',
      '#',
      '# Next',
    ].join('\n')

    const normalized = normalizeMarkdownContent(input)

    expect(normalized).toContain('| Concept | Difference |')
    expect(normalized).toContain('| --- | --- |')
    expect(normalized).not.toMatch(/^#$/m)
  })
})

describe('serializeLearningAssetNote', () => {
  it('uses the asset kind label instead of the LLM-provided type', () => {
    const resource: LearningResource = {
      kind: 'quiz',
      type: 'Diagnostic',
      title: 'SSL quiz',
      agent: 'resource-agent',
      format: 'interactive',
      summary: 'Check understanding.',
      content: 'Question content',
      tags: [],
      payload: {},
    }

    const serialized = serializeLearningAssetNote(resource)

    expect(serialized).toContain('Type: Quiz')
    expect(serialized).not.toContain('Diagnostic')
  })
})

describe('LearningAssetPreview mind maps', () => {
  it('renders Mermaid mindmap content as a visual node tree', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'SSL mind map',
      agent: 'resource-agent',
      format: 'Mermaid mindmap',
      summary: 'summary',
      content: [
        'mindmap',
        '  root((SSL))',
        '    Contrastive learning',
        '      SimCLR',
        '    Generative learning',
        '      Masked language modeling',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText('SSL')).toBeInTheDocument()
    expect(screen.getByText('Contrastive learning')).toBeInTheDocument()
    expect(screen.getByText('SimCLR')).toBeInTheDocument()
    expect(screen.getByText('Generative learning')).toBeInTheDocument()
  })

  it('does not render learning-profile metadata as a mind map', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'SSL mind map',
      agent: 'resource-agent',
      format: 'markdown',
      summary: 'summary',
      content: [
        '- ID: source:dvvmpud5wlcoy4v5o9jk',
        '- Topics: learning_profile',
        '- # 学习画像 这个来源由系统维护',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText(/不适合作为知识导图渲染/)).toBeInTheDocument()
    expect(screen.queryByText(/source:dvvmpud5wlcoy4v5o9jk/)).not.toBeInTheDocument()
  })
})
