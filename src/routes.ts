export const navigation = ['Office', 'Agents', 'Task Board', 'Calendar', 'Activity', 'Memory', 'Folders', 'Logs', 'System'] as const
export type Page = typeof navigation[number]

/** The page shown when the address names no page (or an unknown one). */
export const HOME: Page = 'Office'

export function pageSlug(page: Page): string {
  return page.toLowerCase().replace(/\s+/g, '-')
}

export function pageFromHash(hash: string): Page {
  const slug = hash.replace(/^#\/?/, '').split('/')[0].toLowerCase()
  if (slug === 'knowledge') return 'Memory'
  // The Dashboard's statistics now live in the Office HUD and panel.
  if (slug === 'dashboard') return 'Office'
  return navigation.find((page) => pageSlug(page) === slug) ?? HOME
}
