import type { Model } from '@/lib/types/models'

const PROVIDER_LABELS: Record<string, string> = {
  dashscope: 'DashScope',
  mimo: 'Xiaomi MiMo',
  openai_compatible: 'OpenAI Compatible',
  'openai-compatible': 'OpenAI Compatible',
}

function providerLabel(provider?: string | null) {
  if (!provider) return ''
  return PROVIDER_LABELS[provider] || provider
}

export function modelProviderLabel(model: Pick<Model, 'provider' | 'runtime_provider' | 'api_protocol'>) {
  const runtime = model.runtime_provider || model.provider
  return model.api_protocol && model.api_protocol !== runtime
    ? `${providerLabel(runtime)} / ${model.api_protocol}`
    : providerLabel(runtime)
}

export function modelDisplayName(model: Pick<Model, 'name' | 'provider' | 'runtime_provider' | 'api_protocol'>) {
  return `${modelProviderLabel(model)} / ${model.name}`
}

export function modelWarnings(model: Pick<Model, 'model_spec'>) {
  return model.model_spec?.warnings ?? []
}
