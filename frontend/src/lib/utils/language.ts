const LANGUAGE_NAMES: Record<string, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
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
