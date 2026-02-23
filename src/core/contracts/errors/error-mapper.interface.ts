export interface IErrorMapper<T extends Error = Error> {
  mapToKnownError(error: unknown): T | unknown
}
