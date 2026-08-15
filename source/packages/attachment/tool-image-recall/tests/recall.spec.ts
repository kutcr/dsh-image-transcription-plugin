import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage, CallId, ImageTranscriptionId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmImageTranscriptionService } from '@deepseek-ai/dsh-image-transcription'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolImageRecall from '../src/index.ts'

const config = { provider: 'vision', model: 'v1', maxOutputTokens: 2048, timeoutMs: 60_000, imageIndexMaxChars: 320 }

class VisionAdapter extends LlmAdapter {
  last?: GenerateOptions

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] as const })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.last = options
    yield { type: 'text-delta', index: 0, text: 'The sign says OPEN.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('recall_image', () => {
  it('exposes the two historical-reference arguments and returns a visual conclusion', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    const adapter = new VisionAdapter()
    ctx.llm.registerAdapter(['vision'], adapter)
    await ctx.plugin(LlmImageTranscriptionService, config)
    await ctx.plugin(ToolImageRecall)
    const session = Session.create(SessionId('s'))
    const attachment = { attachmentId: AttachmentId('a'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    session.append('user/message', createUserMessage({
      content: [{
        type: 'image-transcription',
        transcriptionId: ImageTranscriptionId('source'),
        attachments: [attachment],
        text: 'a storefront',
        model: { provider: 'vision', model: 'v1' },
      }],
      source: { kind: 'user', rpcId: 'upload' },
    }), { surfaceOp: 'append' })

    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'recall_image')
    expect(Object.keys((schema?.parameters as { properties: object }).properties)).toEqual(['transcription_id', 'question'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('recall-1'),
      name: 'recall_image',
      arguments: { transcription_id: 'source', question: 'What does the sign say?' },
      agent: { session } as never,
    })

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([expect.objectContaining({ type: 'image-transcription', text: 'The sign says OPEN.' })])
    expect(adapter.last?.messages[0]?.content).toEqual([
      { type: 'text', text: 'User question: What does the sign say?' },
      { type: 'image', attachment },
    ])
  })

  it('returns a re-upload instruction when the requested transcription is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmImageTranscriptionService, config)
    await ctx.plugin(ToolImageRecall)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('recall-2'),
      name: 'recall_image',
      arguments: { transcription_id: 'hidden', question: 'What is this?' },
      agent: { session: Session.create(SessionId('s')) } as never,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: The referenced image is not available in this conversation. Ask the user to upload it again.' }])
  })
})
