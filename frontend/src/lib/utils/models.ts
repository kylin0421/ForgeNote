import type { Model } from '@/lib/types/models'

export function modelProviderLabel(model: Pick<Model, 'provider' | 'runtime_provider' | 'api_protocol'>) {
  const runtime = model.runtime_provider || model.provider
  return model.api_protocol && model.api_protocol !== runtime
    ? `${runtime} / ${model.api_protocol}`
    : runtime
}

export function modelDisplayName(model: Pick<Model, 'name' | 'provider' | 'runtime_provider' | 'api_protocol'>) {
  return `${modelProviderLabel(model)} / ${model.name}`
}

export function modelWarnings(model: Pick<Model, 'model_spec'>) {
  return model.model_spec?.warnings ?? []
}
