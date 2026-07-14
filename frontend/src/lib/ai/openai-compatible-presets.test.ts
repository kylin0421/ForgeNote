import { describe, expect, it } from 'vitest'

import {
  OPENAI_COMPATIBLE_PRESETS,
  compatiblePresetById,
  compatiblePresetForBaseUrl,
} from './openai-compatible-presets'

describe('OpenAI-compatible provider presets', () => {
  it('uses unique HTTPS base URLs ending at the API root', () => {
    const cloudPresets = OPENAI_COMPATIBLE_PRESETS.filter((preset) => preset.id !== 'custom')
    const baseUrls = cloudPresets.map((preset) => preset.baseUrl)

    expect(new Set(baseUrls).size).toBe(baseUrls.length)
    for (const baseUrl of baseUrls) {
      expect(baseUrl).toMatch(/^https:\/\//)
      expect(baseUrl).not.toMatch(/\/$/)
      expect(baseUrl).not.toMatch(/\/(chat\/completions|models)$/)
    }
  })

  it('resolves presets by id and normalized base URL', () => {
    expect(compatiblePresetById('kimi').baseUrl).toBe('https://api.moonshot.cn/v1')
    expect(compatiblePresetForBaseUrl('https://api.together.ai/v1/').id).toBe('together')
    expect(compatiblePresetForBaseUrl('http://127.0.0.1:1234/v1').id).toBe('custom')
  })
})
