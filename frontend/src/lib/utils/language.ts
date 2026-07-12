const LANGUAGE_NAMES: Record<string, string> = {
  'bn-IN': 'বাংলা',
  'ca-ES': 'Català',
  'de-DE': 'Deutsch',
  'en-US': 'English',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'it-IT': 'Italiano',
  'ja-JP': '日本語',
  'pl-PL': 'Polski',
  'pt-BR': 'Português do Brasil',
  'ru-RU': 'Русский',
  'tr-TR': 'Türkçe',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
}

export function getGenerationLanguageFromLocale(language?: string | null) {
  if (!language) {
    return 'English'
  }

  if (LANGUAGE_NAMES[language]) {
    return LANGUAGE_NAMES[language]
  }

  const baseLanguage = language.split('-')[0]
  if (baseLanguage === 'zh') {
    return '中文'
  }

  const matched = Object.entries(LANGUAGE_NAMES).find(([code]) =>
    code.startsWith(`${baseLanguage}-`)
  )

  return matched?.[1] ?? language
}
