export function toAlreadyRegisteredStr(userId: string) {
  return `User has already registered. User ID: ${userId}`
}

export class CustomError extends Error {
  userFacingMessage: string;
  logMessage: string;
  httpStatusCode: number;

  constructor({
    userFacingMessage,
    logMessage,
    httpStatusCode
  }: {
    userFacingMessage: string,
    logMessage: string,
    httpStatusCode: number
  }) {
    super(userFacingMessage);
    this.userFacingMessage = userFacingMessage;
    this.logMessage = logMessage;
    this.httpStatusCode = httpStatusCode;
  }
}
