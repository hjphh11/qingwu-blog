export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, reason: string, message: string): never {
  throw new AuthError(status, reason, message);
}
