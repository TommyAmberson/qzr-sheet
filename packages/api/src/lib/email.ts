import { SOCIAL_PROVIDER_LABEL, type SocialProvider } from '@qzr/shared'

/** Transactional email through Resend's HTTPS API, from the same sender as
 *  verse-vault. */

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/** Starts a send and returns at once. Never throws and never rejects: an auth
 *  flow that awaited the provider, or surfaced its error, would let a caller
 *  tell an existing address from an unknown one by timing or by status
 *  (FR-002). */
export type SendEmail = (message: EmailMessage) => void

const RESEND_URL = 'https://api.resend.com/emails'
const FROM = 'VerseVault <no-reply@versevault.ca>'

export interface EmailSenderOptions {
  apiKey: string | undefined
  /** The Worker's `waitUntil`: a promise not handed to it may be cancelled
   *  once the response returns (FR-020). */
  waitUntil?: (promise: Promise<unknown>) => void
  log?: (line: string) => void
  fetchImpl?: typeof fetch
}

export function createEmailSender({
  apiKey,
  waitUntil,
  log = (line) => console.warn(line),
  fetchImpl = fetch,
}: EmailSenderOptions): SendEmail {
  if (!apiKey) {
    // Local dev has no provider: print the email so reset and verification can
    // still be walked through by hand (FR-021).
    return (message) =>
      log(`[email] not sent (no RESEND_API_KEY) to ${message.to}:\n${message.text}`)
  }
  return (message) => {
    const sending = deliver(apiKey, message, fetchImpl).catch((err: unknown) => {
      // The body holds a live code, so log only who and what failed.
      log(`[email] send failed to ${message.to} (${message.subject}): ${String(err)}`)
    })
    waitUntil?.(sending)
  }
}

async function deliver(apiKey: string, message: EmailMessage, fetchImpl: typeof fetch) {
  const res = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, ...message }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
}

export function resetCodeEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  return codeEmail(to, ttlMinutes, {
    subject: 'Your qzr reset code',
    reason:
      'Someone asked to reset the password for your qzr account. Enter this code with your new ' +
      'password:',
    code,
  })
}

/** The code step for a GitHub or Google sign-in onto an unverified account
 *  (FR-015): says what the code is for, so its owner doesn't hand it over. */
export function providerCodeEmail(
  to: string,
  provider: SocialProvider,
  code: string,
  ttlMinutes: number,
): EmailMessage {
  const label = SOCIAL_PROVIDER_LABEL[provider]
  return codeEmail(to, ttlMinutes, {
    subject: `Your qzr code to connect ${label}`,
    reason:
      `Someone is signing in to qzr with ${label} using this address. Enter this code only if ` +
      'you just did that yourself; otherwise ignore this email, and your account stays as it is:',
    code,
  })
}

export function verificationCodeEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  return codeEmail(to, ttlMinutes, {
    subject: 'Your qzr code',
    reason: 'Enter this code in qzr to confirm that this address is yours:',
    code,
  })
}

/** Sent after every completed password reset (OWASP Forgot Password Cheat
 *  Sheet), saying what the reset did to the account's GitHub and Google
 *  sign-ins (FR-028). */
export function passwordResetEmail(
  to: string,
  providers: { disconnected: SocialProvider[]; stillConnected: SocialProvider[] },
): EmailMessage {
  const lines = [
    'The password for your qzr account was just reset, and every session was signed out.',
    ...providers.disconnected.map(
      (p) =>
        `${SOCIAL_PROVIDER_LABEL[p]} was disconnected from your account, in case someone else had added ` +
        'it. If it was yours, connect it again in account settings.',
    ),
    ...providers.stillConnected.map(
      (p) =>
        `We couldn't disconnect ${SOCIAL_PROVIDER_LABEL[p]} from your account. If you didn't add it, ` +
        'disconnect it in account settings.',
    ),
    'If this wasn\'t you, reset your password again from the sign-in form ("Forgot password?"), ' +
      'and check who can read this inbox.',
  ]
  return noticeEmail(to, 'Your qzr password was reset', lines)
}

/** Sent when GitHub or Google joins an account that already had another way
 *  to sign in, so the owner hears of a connection they didn't make (FR-019). */
export function providerConnectedEmail(to: string, provider: SocialProvider): EmailMessage {
  const label = SOCIAL_PROVIDER_LABEL[provider]
  return noticeEmail(to, `${label} was connected to your qzr account`, [
    `A ${label} account was just connected to your qzr account, so it can now be used to sign in.`,
    "If this wasn't you, sign in with your password (reset it from the sign-in form with " +
      `"Forgot password?" if you need to), then disconnect ${label} in account settings.`,
  ])
}

/** Sent when GitHub or Google is disconnected while the account stays. */
export function providerDisconnectedEmail(to: string, provider: SocialProvider): EmailMessage {
  const label = SOCIAL_PROVIDER_LABEL[provider]
  return noticeEmail(to, `${label} was disconnected from your qzr account`, [
    `A ${label} account was just disconnected from your qzr account, and every other session ` +
      'was signed out.',
    'If this wasn\'t you, reset your password from the sign-in form ("Forgot password?").',
  ])
}

function noticeEmail(to: string, subject: string, lines: string[]): EmailMessage {
  return {
    to,
    subject,
    text: lines.join('\n\n'),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  }
}

interface CodeEmailParts {
  subject: string
  reason: string
  code: string
}

/** The code shown prominently, why it was sent, how long it lasts, not to
 *  share it, and what to do if unexpected (FR-012). */
function codeEmail(to: string, ttlMinutes: number, parts: CodeEmailParts): EmailMessage {
  // Warns against handing the code over, not against the app asking for it.
  const expiry = `The code expires in ${ttlMinutes} minutes. Don't share it with anyone.`
  const ignore = "If you didn't ask for this, you can ignore this email."
  const text = [parts.reason, '', parts.code, '', expiry, ignore].join('\n')
  const html = [
    `<p>${escapeHtml(parts.reason)}</p>`,
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(parts.code)}</p>`,
    `<p>${escapeHtml(expiry)} ${escapeHtml(ignore)}</p>`,
  ].join('\n')
  return { to, subject: parts.subject, text, html }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
