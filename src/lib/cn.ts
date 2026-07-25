export type ClassValue = string | false | null | undefined

/** Join truthy class names into a single className string. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
