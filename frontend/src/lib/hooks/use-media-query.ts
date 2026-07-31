'use client'

import { useState, useEffect } from 'react'

/**
 * Hook to detect if viewport matches a media query.
 * Returns false during SSR to avoid hydration mismatches.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    setMatches(mediaQuery.matches)

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [query])

  return matches
}

/**
 * Returns true when the three-column notebook workspace has enough room.
 * Narrower viewports use the single-column tab layout so media and controls
 * never have to force the canvas wider than the viewport.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1280px)')
}
