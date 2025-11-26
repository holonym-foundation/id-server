import { updatePhoneSession, updateSandboxPhoneSession } from './dynamodb.js'
import { sessionStatusEnum } from '../../../constants/misc.js'

export async function failPhoneSession(
  sessionId: string,
  failureReason: string
): Promise<void> {
  await updatePhoneSession(
    sessionId,
    null,
    sessionStatusEnum.VERIFICATION_FAILED,
    null,
    null,
    null,
    null,
    null,
    failureReason
  )
}

export async function setPhoneSessionIssued(sessionId: string): Promise<void> {
  await updatePhoneSession(
    sessionId,
    null,
    sessionStatusEnum.ISSUED,
    null,
    null,
    null,
    null,
    null,
    null
  )
}

export async function failSandboxPhoneSession(
  sessionId: string,
  failureReason: string
): Promise<void> {
  await updateSandboxPhoneSession(
    sessionId,
    null,
    sessionStatusEnum.VERIFICATION_FAILED,
    null,
    null,
    null,
    null,
    null,
    failureReason
  )
}

export async function setSandboxPhoneSessionIssued(
  sessionId: string
): Promise<void> {
  await updateSandboxPhoneSession(
    sessionId,
    null,
    sessionStatusEnum.ISSUED,
    null,
    null,
    null,
    null,
    null,
    null
  )
}
