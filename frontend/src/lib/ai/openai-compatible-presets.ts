export type CompatibleModelType =
  | 'language'
  | 'embedding'
  | 'text_to_speech'
  | 'speech_to_text'
  | 'image'

export interface OpenAICompatiblePreset {
  id: string
  label: string
  baseUrl: string
  docsUrl: string
  modalities: CompatibleModelType[]
}

export const OPENAI_COMPATIBLE_PRESETS: OpenAICompatiblePreset[] = [
  {
    id: 'custom',
    label: 'Custom / self-hosted',
    baseUrl: '',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    modalities: ['language', 'embedding', 'text_to_speech', 'speech_to_text', 'image'],
  },
  {
    id: 'kimi',
    label: 'Kimi / Moonshot AI',
    baseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.kimi.com/docs/api/chat',
    modalities: ['language'],
  },
  {
    id: 'zhipu',
    label: 'Zhipu AI / GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
    modalities: ['language'],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/cn/userguide/quickstart',
    modalities: ['language', 'embedding'],
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.ai/v1',
    docsUrl: 'https://docs.together.ai/docs/inference/openai-compatibility',
    modalities: ['language', 'embedding', 'text_to_speech', 'speech_to_text', 'image'],
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    docsUrl: 'https://docs.fireworks.ai/tools-sdks/openai-compatibility',
    modalities: ['language'],
  },
  {
    id: 'cerebras',
    label: 'Cerebras Inference',
    baseUrl: 'https://api.cerebras.ai/v1',
    docsUrl: 'https://inference-docs.cerebras.ai/resources/openai',
    modalities: ['language'],
  },
]

export function compatiblePresetById(id: string): OpenAICompatiblePreset {
  return OPENAI_COMPATIBLE_PRESETS.find((preset) => preset.id === id)
    ?? OPENAI_COMPATIBLE_PRESETS[0]
}

export function compatiblePresetForBaseUrl(baseUrl?: string | null): OpenAICompatiblePreset {
  const normalized = (baseUrl || '').replace(/\/+$/, '').toLowerCase()
  return OPENAI_COMPATIBLE_PRESETS.find(
    (preset) => preset.baseUrl && preset.baseUrl.toLowerCase() === normalized,
  ) ?? OPENAI_COMPATIBLE_PRESETS[0]
}
