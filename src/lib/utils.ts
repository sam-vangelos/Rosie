import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function qualifyIntakeNotes(value: string): string | null {
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\s+/g, ' ')
  // ponytail: this is a friction check for trusted operators, not semantic
  // validation; add structured intake fields if vague notes become routine.
  return normalized.length >= 40 && normalized.split(' ').length >= 5
    ? trimmed
    : null
}
