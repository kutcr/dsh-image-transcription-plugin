import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ImageTranscriptionId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import { IMAGE_TRANSCRIPTION_TRANSPORT_MESSAGE, LlmImageTranscriptionService } from '../src/index.ts'

const config = {
  provider: 'vision',
  model: 'v1',
  maxOutputTokens: 2048,
  timeoutMs: 60_000,
  imageIndexMaxChars: 18,
}

function appendHistoricalTranscription(
  session: Session,
  transcriptionId: ImageTranscriptionId,
  attachment: { attachmentId: AttachmentId; mediaType: 'image/png'; bytes: number; width: number; height: number },
  text: string,
): number {
  const target = { kind: 'surface' as const, seq: session.seq }
  session.append('image-transcription/request', {
    transcriptionId,
    target,
    route: { provider: 'vision', model: 'v1' },
    messages: [],
    system: 'describe',
    maxTokens: 1,
  }, { ignorable: true })
  session.append('image-transcription/succeeded', {
    transcriptionId,
    target,
    text,
    output: [{ type: 'text', text }],
  }, { ignorable: true })
  return session.append('user/message', createUserMessage({
    content: [{
      type: 'image-transcription', transcriptionId, attachments: [attachment], text,
      model: { provider: 'vision', model: 'v1' },
    }], source: { kind: 'user', rpcId: `${transcriptionId}-upload` },
  }), { surfaceOp: 'append' }).seq
}

class VisionAdapter extends LlmAdapter {
  last?: GenerateOptions
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] as const })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.last = options
    yield { type: 'text-delta', index: 0, text: 'two related screenshots' }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class TransportFailureVisionAdapter extends VisionAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.last = options
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'terminated' } } }
  }
}

describe('LLM image transcription', () => {
  it('sends a whole image batch once and logs correlated audit events', async () => {
    const root = new Context()
    await root.plugin(LlmRuntime)
    await root.plugin(SessionStore)
    const adapter = new VisionAdapter()
    root.llm.registerAdapter(['vision'], adapter)
    await root.plugin(LlmImageTranscriptionService, config)
    const session = Session.create(SessionId('s'))
    const image = { type: 'image' as const, attachment: { attachmentId: AttachmentId('a'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 } }
    const block = await root.imageTranscription.transcribe({ session, content: [{ type: 'text', text: 'compare' }, image, image], target: { kind: 'message', messageId: 'm' } })
    expect(block.attachments).toHaveLength(2)
    expect(adapter.last?.purpose).toBe('image-transcription')
    expect(adapter.last?.maxTokens).toBe(2048)
    expect(adapter.last?.messages[0]?.content.filter(item => item.type === 'image')).toHaveLength(2)
    expect(session.events.map(event => event.type)).toEqual(['image-transcription/request', 'image-transcription/succeeded'])
    expect(session.events.every(event => event.ignorable === true)).toBe(true)
  })

  it('turns a visual-route transport termination into an actionable transcription failure', async () => {
    const root = new Context()
    await root.plugin(LlmRuntime)
    await root.plugin(SessionStore)
    const adapter = new TransportFailureVisionAdapter()
    root.llm.registerAdapter(['vision'], adapter)
    await root.plugin(LlmImageTranscriptionService, config)
    const session = Session.create(SessionId('s'))
    const image = { type: 'image' as const, attachment: { attachmentId: AttachmentId('a'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 } }

    await expect(root.imageTranscription.transcribe({
      session, content: [image], target: { kind: 'message', messageId: 'm' },
    })).rejects.toMatchObject({ code: 'TRANSPORT', message: IMAGE_TRANSCRIPTION_TRANSPORT_MESSAGE })

    expect(session.events.at(-1)).toMatchObject({
      type: 'image-transcription/failed',
      data: { failure: { code: 'TRANSPORT', message: IMAGE_TRANSCRIPTION_TRANSPORT_MESSAGE } },
    })
  })

  it('recalls a transcription retained by the event log', async () => {
    const root = new Context()
    await root.plugin(LlmRuntime)
    await root.plugin(SessionStore)
    const adapter = new VisionAdapter()
    root.llm.registerAdapter(['vision'], adapter)
    await root.plugin(LlmImageTranscriptionService, config)
    const session = Session.create(SessionId('s'))
    const attachment = { attachmentId: AttachmentId('a'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    const source = {
      type: 'image-transcription' as const,
      transcriptionId: ImageTranscriptionId('source'),
      attachments: [attachment],
      text: 'a red square',
      model: { provider: 'vision', model: 'v1' },
    }
    session.append('user/message', createUserMessage({ content: [source], source: { kind: 'user', rpcId: 'upload' } }), { surfaceOp: 'append' })

    const recalled = await root.imageTranscription.recall({
      session,
      transcriptionId: source.transcriptionId,
      question: 'What color is the square?',
      callId: 'recall-1',
    })

    expect(recalled.attachments).toEqual([attachment])
    expect(adapter.last?.messages[0]?.content).toEqual([
      { type: 'text', text: 'User question: What color is the square?' },
      { type: 'image', attachment },
    ])
    const request = session.events.find(event => event.type === 'image-transcription/request')
    expect(request?.type === 'image-transcription/request' && request.data.target).toEqual({
      kind: 'recall', callId: 'recall-1', sourceTranscriptionId: ImageTranscriptionId('source'),
    })
  })

  it('indexes compacted images and recalls only the requested original attachment batch', async () => {
    const root = new Context()
    await root.plugin(LlmRuntime)
    await root.plugin(SessionStore)
    const adapter = new VisionAdapter()
    root.llm.registerAdapter(['vision'], adapter)
    await root.plugin(LlmImageTranscriptionService, config)
    const session = root.sessions.create(SessionId('s'))
    const first = { attachmentId: AttachmentId('first'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    const second = { attachmentId: AttachmentId('second'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    const third = { attachmentId: AttachmentId('third'), mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    const firstSeq = appendHistoricalTranscription(
      session,
      ImageTranscriptionId('first-image'),
      first,
      'first description is deliberately longer than the configured compact index cap',
    )
    const secondSeq = appendHistoricalTranscription(session, ImageTranscriptionId('second-image'), second, 'second description')
    appendHistoricalTranscription(session, ImageTranscriptionId('third-image'), third, 'third description')
    const checkpoint = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted summary' }],
      source: compactCheckpointSource(CompactionId('compact-1')),
    }), { surfaceOp: { op: 'replace', start: firstSeq, end: secondSeq }, sourceEventSeqs: [firstSeq, secondSeq] })
    await new Promise<void>(resolve => { queueMicrotask(resolve) })

    const indexed = session.events.at(-1)
    expect(indexed).toMatchObject({
      type: 'user/message',
      sourceEventSeqs: [checkpoint.seq],
      surfaceOp: { op: 'replace', start: checkpoint.seq, end: checkpoint.seq },
    })
    expect(indexed?.type === 'user/message' && indexed.data.content.at(-1)).toEqual({
      type: 'text',
      text: '<image-index>\n1. transcriptionId="first-image"\nfirst description ...\n\n2. transcriptionId="second-image"\nsecond description\n</image-index>',
    })

    const recalled = await root.imageTranscription.recall({
      session,
      transcriptionId: ImageTranscriptionId('second-image'),
      question: 'What does the second image contain?',
      callId: 'recall-2',
    })
    expect(recalled.attachments).toEqual([second])
    expect(adapter.last?.messages[0]?.content).toEqual([
      { type: 'text', text: 'User question: What does the second image contain?' },
      { type: 'image', attachment: second },
    ])
  })
})
