export class AddressServiceBusyError extends Error {
  constructor(provider: string) {
    super(`Service ${provider} is currently busy (Rate Limit Exceeded).`)
    this.name = 'AddressServiceBusyError'
  }
}
