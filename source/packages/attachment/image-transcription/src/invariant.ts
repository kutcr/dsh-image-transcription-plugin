/** Durable image-transcription correlation invariants. @module @deepseek-ai/dsh-image-transcription/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ImageTranscriptionId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-image-transcription'
export const name = 'image-transcription-invariant'
export const inject = ['invariants']

function validate(events: readonly SessionEvent[], fail: InvariantFailure): void {
  const requests = new Set<ImageTranscriptionId>()
  const successes = new Set<ImageTranscriptionId>()
  for (const event of events) {
    if (event.type === 'image-transcription/request') requests.add(event.data.transcriptionId)
    else if (event.type === 'image-transcription/succeeded' || event.type === 'image-transcription/failed') {
      if (!requests.has(event.data.transcriptionId)) fail(`${event.type} ${event.data.transcriptionId} has no earlier request`)
      if (event.type === 'image-transcription/succeeded') successes.add(event.data.transcriptionId)
    } else if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result') {
      const blocks = event.type === 'user/message' ? event.data.content : event.data.message.content
      const visit = (content: typeof blocks): void => {
        for (const block of content) {
          if (block.type === 'image-transcription' && !successes.has(block.transcriptionId)) {
            fail(`surface block ${block.transcriptionId} has no earlier success`)
          }
          if (block.type === 'tool-result') visit(block.content)
        }
      }
      visit(blocks)
    }
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (session: Session): void => { validate(session.events, fail) }
  for (const session of ctx.sessions.list()) check(session)
  ctx.on('session/created', check, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validate([...session.events, event], fail)
  }, { global: true })
}, { inject: ['sessions'] })

export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
