export function ensureError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }

  if (typeof value === 'string') {
    return new Error(value)
  }

  if (typeof value === 'object' && value !== null) {
    const raw = value as Record<string, unknown>

    const message = typeof raw.message === 'string' ? raw.message : JSON.stringify(raw)

    const error = new Error(message)

    Object.assign(error, raw)

    return error
  }

  return new Error(String(value))
}
