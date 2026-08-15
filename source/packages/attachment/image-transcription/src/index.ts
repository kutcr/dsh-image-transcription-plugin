/** Image transcription Service Definition and LLM-backed provider. @module @deepseek-ai/dsh-image-transcription */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BlockAssembler,
  createUserMessage,
  deepFreeze,
  freezeMessage,
  ImageTranscriptionId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  ImageBlock,
  ImageTranscriptionBlock,
  LlmFailure,
  Message,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** User-settings namespace for the global auxiliary vision route. */
export const IMAGE_TRANSCRIPTION_SETTINGS_NAMESPACE = settingsNamespace('image-transcription')
/** Default auxiliary output limit. */
export const DEFAULT_IMAGE_TRANSCRIPTION_MAX_OUTPUT_TOKENS = 2048
/** Default end-to-end auxiliary deadline. */
export const DEFAULT_IMAGE_TRANSCRIPTION_TIMEOUT_MS = 60_000
/** Default character cap for one compacted image description. */
export const DEFAULT_IMAGE_INDEX_MAX_CHARS = 320
/** Timeout reason code retained by normalized failures. */
export const IMAGE_TRANSCRIPTION_TIMEOUT_CODE = 'IMAGE_TRANSCRIPTION_TIMEOUT'
/** Model-facing explanation for an auxiliary visual-route transport failure. */
export const IMAGE_TRANSCRIPTION_TRANSPORT_MESSAGE = 'The visual model connection ended unexpectedly before image analysis completed. Retry the request; do not infer missing image details.'

/** Global image-transcription settings. Provider and model are an optional pair. */
export interface ImageTranscriptionSettings {
  /** Auxiliary visual provider; set together with {@link model}, or omit both to disable calls. */
  provider?: string
  /** Auxiliary visual model; set together with {@link provider}, or omit both to disable calls. */
  model?: string
  /** Maximum completion tokens sent to the auxiliary visual model. */
  maxOutputTokens: number
  /** End-to-end deadline for one auxiliary visual model call, in milliseconds. */
  timeoutMs: number
  /** Maximum JavaScript characters retained from one initial description in a compacted image index. */
  imageIndexMaxChars: number
}

/** Loader and settings schema. */
export const Config = z.object({
  provider: z.string(),
  model: z.string(),
  maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_IMAGE_TRANSCRIPTION_MAX_OUTPUT_TOKENS),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_IMAGE_TRANSCRIPTION_TIMEOUT_MS),
  imageIndexMaxChars: z.number().step(1).min(1).default(DEFAULT_IMAGE_INDEX_MAX_CHARS),
}).default({
  provider: undefined as unknown as string,
  model: undefined as unknown as string,
  maxOutputTokens: DEFAULT_IMAGE_TRANSCRIPTION_MAX_OUTPUT_TOKENS,
  timeoutMs: DEFAULT_IMAGE_TRANSCRIPTION_TIMEOUT_MS,
  imageIndexMaxChars: DEFAULT_IMAGE_INDEX_MAX_CHARS,
}) as unknown as z<ImageTranscriptionSettings>

/** Durable target of one auxiliary transcription. */
export type ImageTranscriptionTarget =
  | { kind: 'message'; messageId: string }
  | { kind: 'tool'; callId: string }
  | { kind: 'recall'; callId: string; sourceTranscriptionId: ImageTranscriptionId }
  | { kind: 'surface'; seq: number }

/** Complete request audit payload. */
export interface ImageTranscriptionRequestEventData {
  transcriptionId: ImageTranscriptionId
  target: ImageTranscriptionTarget
  route: { provider: string; model: string }
  messages: Message[]
  system: string
  maxTokens: number
}

/** Successful auxiliary output and correlation facts. */
export interface ImageTranscriptionSucceededEventData {
  transcriptionId: ImageTranscriptionId
  target: ImageTranscriptionTarget
  text: string
  output: ContentBlock[]
  usage?: TokenUsage
}

/** Failed auxiliary output and normalized cause. */
export interface ImageTranscriptionFailedEventData {
  transcriptionId: ImageTranscriptionId
  target: ImageTranscriptionTarget
  failure: LlmFailure
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Ignorable pre-dispatch audit of one auxiliary vision request. */
    'image-transcription/request': ImageTranscriptionRequestEventData
    /** Ignorable successful auxiliary output. */
    'image-transcription/succeeded': ImageTranscriptionSucceededEventData
    /** Ignorable normalized auxiliary failure. */
    'image-transcription/failed': ImageTranscriptionFailedEventData
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    imageTranscription: ImageTranscriptionService
  }
}

/** One whole-message transcription request. */
export interface ImageTranscriptionRequest {
  session: Session
  content: ContentBlock[]
  target: ImageTranscriptionTarget
  signal?: AbortSignal
}

/** One visual follow-up over a transcription retained in the session event log. */
export interface ImageTranscriptionRecallRequest {
  /** Session whose event log owns the referenced transcription. */
  session: Session
  /** Stable identifier exposed in the text-only transcription envelope. */
  transcriptionId: ImageTranscriptionId
  /** The current question to answer from the original image alone. */
  question: string
  /** Tool call that requested the recall. */
  callId: string
  /** Cancels the visual request. */
  signal?: AbortSignal
}

/** Image transcription service consumed by prompt, tool, and model-switch entry points. */
export abstract class ImageTranscriptionService extends Service {
  constructor(ctx: Context) { super(ctx, 'imageTranscription') }
  /**
   * Report whether a complete global auxiliary route is selected.
   * @returns whether a complete global auxiliary route is selected.
   */
  abstract configured(): boolean
  /**
   * Transcribe every image in one message as one auxiliary model call.
   * @param request - session, complete message content, target identity, and cancellation.
   * @returns the durable dual image/text block.
   */
  abstract transcribe(request: ImageTranscriptionRequest): Promise<ImageTranscriptionBlock>
  /**
   * Re-read one original image batch retained by the calling session.
   * @param request - transcription id, question, tool identity, and cancellation.
   * @returns a fresh durable visual conclusion retaining the original attachments.
   */
  abstract recall(request: ImageTranscriptionRecallRequest): Promise<ImageTranscriptionBlock>
  /**
   * Replace image-bearing nodes on the current model surface with durable dual representations.
   * @param session - session whose current surface is updated.
   * @param signal - optional cancellation for the serial maintenance operation.
   * @returns fulfillment after all current image nodes have been processed.
   */
  abstract backfill(session: Session, signal?: AbortSignal): Promise<void>
}

const SYSTEM_PROMPT = [
  'Describe all supplied images faithfully for a text-only model.',
  'Report visible text, objects, layout, spatial relationships, and relationships across images.',
  'State uncertainty explicitly. Do not answer the user question and do not infer information that is not visible.',
  'Return plain text only.',
].join('\n')

const RECALL_SYSTEM_PROMPT = [
  'Answer the user question from the supplied images only.',
  'Describe only visible text, people, objects, layout, and spatial relationships.',
  'State uncertainty explicitly. Do not infer identities or facts that are not visible.',
  'Return plain text only.',
].join('\n')

function validate(settings: ImageTranscriptionSettings): void {
  if ((settings.provider === undefined) !== (settings.model === undefined)) {
    throw new Error('image-transcription: provider and model must be configured together')
  }
  if (settings.provider === '' || settings.model === '') {
    throw new Error('image-transcription: provider and model must be non-empty')
  }
}

function imagesOf(content: readonly ContentBlock[]): ImageBlock[] {
  const result: ImageBlock[] = []
  for (const block of content) {
    if (block.type === 'image') result.push(block)
    else if (block.type === 'tool-result') result.push(...imagesOf(block.content))
  }
  return result
}

function transcriptionIn(content: readonly ContentBlock[], transcriptionId: ImageTranscriptionId): ImageTranscriptionBlock | undefined {
  for (const block of content) {
    if (block.type === 'image-transcription' && block.transcriptionId === transcriptionId) return block
    if (block.type === 'tool-result') {
      const found = transcriptionIn(block.content, transcriptionId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function finishFailure(finish: FinishReason): Error | undefined {
  if (finish.kind === 'stop') return undefined
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    return Object.assign(new Error(finish.failure.message), { code: finish.failure.code, failure: finish.failure })
  }
  if (finish.kind === 'max-tokens') return Object.assign(new Error('Image transcription reached maxOutputTokens.'), { code: 'IMAGE_TRANSCRIPTION_MAX_TOKENS' })
  return Object.assign(new Error('Image transcription model requested a tool.'), { code: 'IMAGE_TRANSCRIPTION_TOOL_CALL' })
}

function normalizedFailure(error: unknown): LlmFailure {
  const candidate = error as { message?: unknown; code?: unknown; failure?: unknown }
  if (typeof candidate.failure === 'object' && candidate.failure !== null) {
    const carried = candidate.failure as Partial<LlmFailure>
    if (typeof carried.message === 'string' && typeof carried.code === 'string') {
      return carried.code === 'TRANSPORT'
        ? { ...carried, message: IMAGE_TRANSCRIPTION_TRANSPORT_MESSAGE } as LlmFailure
        : carried as LlmFailure
    }
  }
  if (candidate.code === 'TRANSPORT') {
    return { message: IMAGE_TRANSCRIPTION_TRANSPORT_MESSAGE, code: 'TRANSPORT' }
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof candidate.code === 'string' ? candidate.code : 'IMAGE_TRANSCRIPTION_FAILED',
  }
}

function replaceImages(content: readonly ContentBlock[], block: ImageTranscriptionBlock): ContentBlock[] {
  let emitted = false
  const walk = (blocks: readonly ContentBlock[]): ContentBlock[] => {
    const result: ContentBlock[] = []
    for (const current of blocks) {
      if (current.type === 'image') {
        if (!emitted) { result.push(block); emitted = true }
      } else if (current.type === 'tool-result') {
        result.push({ ...current, content: walk(current.content) })
      } else result.push(current)
    }
    return result
  }
  return walk(content)
}

function contentOf(event: SessionEvent): ContentBlock[] | undefined {
  if (event.type === 'user/message') return event.data.content
  if (event.type === 'assistant/message') return event.data.message.content
  if (event.type === 'tool/result') return event.data.message.content
  return undefined
}

function retainedTranscription(session: Session, transcriptionId: ImageTranscriptionId): ImageTranscriptionBlock | undefined {
  for (const event of session.events) {
    const content = contentOf(event)
    if (content === undefined) continue
    const found = transcriptionIn(content, transcriptionId)
    if (found !== undefined) return found
  }
  return undefined
}

function retainedImageTranscriptions(session: Session): ImageTranscriptionBlock[] {
  const result: ImageTranscriptionBlock[] = []
  const seen = new Set<ImageTranscriptionId>()
  const visible = new Set(session.surface.nodes)
  const targets = new Map<ImageTranscriptionId, ImageTranscriptionTarget>()
  for (const event of session.events) {
    if (event.type === 'image-transcription/succeeded') targets.set(event.data.transcriptionId, event.data.target)
  }
  for (const event of session.events) {
    if (visible.has(event.seq)) continue
    const content = contentOf(event)
    if (content === undefined) continue
    const visit = (blocks: readonly ContentBlock[]): void => {
      for (const block of blocks) {
        if (block.type === 'image-transcription') {
          if (block.attachments.length > 0
            && targets.get(block.transcriptionId)?.kind !== 'recall'
            && !seen.has(block.transcriptionId)) {
            result.push(block)
            seen.add(block.transcriptionId)
          }
        } else if (block.type === 'tool-result') visit(block.content)
      }
    }
    visit(content)
  }
  return result
}

function truncateImageIndexText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}

function imageIndexText(session: Session, maxChars: number): string | undefined {
  const transcriptions = retainedImageTranscriptions(session)
  if (transcriptions.length === 0) return undefined
  const entries = transcriptions.map((block, index) => [
    `${index + 1}. transcriptionId="${block.transcriptionId}"`,
    truncateImageIndexText(block.text, maxChars),
  ].join('\n'))
  return `<image-index>\n${entries.join('\n\n')}\n</image-index>`
}

function appendImageIndex(session: Session, checkpoint: SessionEvent, maxChars: number): void {
  if (checkpoint.type !== 'user/message' || !isCompactCheckpointSource(checkpoint.data.source)) return
  if (session.events[checkpoint.seq] !== checkpoint || !session.surface.nodes.includes(checkpoint.seq)) return
  const index = imageIndexText(session, maxChars)
  if (index === undefined) return
  session.append('user/message', freezeMessage({
    ...checkpoint.data,
    content: [...checkpoint.data.content, { type: 'text', text: index }],
    source: { kind: 'plugin', plugin: 'dsh-image-transcription' },
  }), {
    surfaceOp: { op: 'replace', start: checkpoint.seq, end: checkpoint.seq },
    sourceEventSeqs: [checkpoint.seq],
  })
}

function appendReplacement(session: Session, event: SessionEvent, block: ImageTranscriptionBlock, successSeq: number): void {
  const content = contentOf(event)
  if (content === undefined) return
  const replaced = replaceImages(content, block)
  const intent = { surfaceOp: { op: 'replace' as const, start: event.seq, end: event.seq }, sourceEventSeqs: [event.seq, successSeq] }
  if (event.type === 'user/message') {
    session.append('user/message', freezeMessage({ ...event.data, content: replaced }), intent)
  } else if (event.type === 'assistant/message') {
    session.append('assistant/message', { ...event.data, message: freezeMessage({ ...event.data.message, content: replaced }) }, intent)
  } else if (event.type === 'tool/result') {
    session.append('tool/result', {
      ...event.data,
      message: freezeMessage({ ...event.data.message, content: replaced as typeof event.data.message.content }),
    }, intent)
  }
}

/** LLM-backed global image transcription provider with live settings. */
export class LlmImageTranscriptionService extends ImageTranscriptionService {
  static inject = ['llm', 'sessions']

  private source: () => ImageTranscriptionSettings
  private disposed = false

  constructor(ctx: Context, config: ImageTranscriptionSettings = {
    maxOutputTokens: DEFAULT_IMAGE_TRANSCRIPTION_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_IMAGE_TRANSCRIPTION_TIMEOUT_MS,
    imageIndexMaxChars: DEFAULT_IMAGE_INDEX_MAX_CHARS,
  }) {
    super(ctx)
    validate(config)
    this.source = () => config
    installSettingsSection(ctx, IMAGE_TRANSCRIPTION_SETTINGS_NAMESPACE, Config, config, {
      setSource: (current) => { this.source = current },
      onChange: () => {},
      validate,
    })
    ctx.effect(() => () => { this.disposed = true }, 'image transcription lifecycle')
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || !isCompactCheckpointSource(event.data.source)) return
      // Session append observers run inside the committed event publication. Defer the
      // replacement until that publication unwinds, then preserve the checkpoint text.
      queueMicrotask(() => {
        if (this.disposed || ctx.sessions.get(session.id) !== session) return
        try {
          appendImageIndex(session, event, this.source().imageIndexMaxChars)
        } catch (error: unknown) {
          ctx.logger.warn(`image-transcription: unable to append image index: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    })
  }

  configured(): boolean {
    const value = this.source()
    return value.provider !== undefined && value.model !== undefined
  }

  async transcribe(request: ImageTranscriptionRequest): Promise<ImageTranscriptionBlock> {
    return this.run({
      ...request,
      system: SYSTEM_PROMPT,
    })
  }

  async recall(request: ImageTranscriptionRecallRequest): Promise<ImageTranscriptionBlock> {
    request.signal?.throwIfAborted()
    if (request.question.trim().length === 0) {
      throw Object.assign(new Error('question must be a non-empty string'), { code: 'IMAGE_TRANSCRIPTION_INVALID_QUESTION' })
    }
    const source = retainedTranscription(request.session, request.transcriptionId)
    if (source === undefined) {
      throw Object.assign(new Error('The referenced image is not available in this conversation. Ask the user to upload it again.'), { code: 'IMAGE_TRANSCRIPTION_NOT_FOUND' })
    }
    if (source.attachments.length === 0) {
      throw Object.assign(new Error('The referenced image attachment is unavailable. Ask the user to upload it again.'), { code: 'IMAGE_TRANSCRIPTION_ATTACHMENT_MISSING' })
    }
    const content: ContentBlock[] = [
      { type: 'text', text: `User question: ${request.question}` },
      ...source.attachments.map(attachment => ({ type: 'image' as const, attachment })),
    ]
    return this.run({
      session: request.session,
      content,
      target: { kind: 'recall', callId: request.callId, sourceTranscriptionId: request.transcriptionId },
      ...request.signal === undefined ? {} : { signal: request.signal },
      system: RECALL_SYSTEM_PROMPT,
    })
  }

  private async run(request: ImageTranscriptionRequest & { system: string }): Promise<ImageTranscriptionBlock> {
    request.signal?.throwIfAborted()
    const images = imagesOf(request.content)
    if (images.length === 0) throw new Error('image-transcription: input contains no images')
    const settings = this.source()
    if (settings.provider === undefined || settings.model === undefined) {
      throw Object.assign(new Error('Configure an image transcription model in Settings → Models.'), { code: 'IMAGE_TRANSCRIPTION_NOT_CONFIGURED' })
    }
    const info = await this.ctx.llm.resolveModelInfo(settings.provider, settings.model)
    if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
      throw Object.assign(new Error(`Image transcription model "${settings.model}" does not explicitly declare image input.`), { code: 'IMAGE_TRANSCRIPTION_ROUTE_NOT_VISUAL' })
    }
    const transcriptionId = ImageTranscriptionId(randomUUID())
    const route = { provider: settings.provider, model: settings.model }
    const messages: Message[] = [createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-image-transcription' },
      content: request.content,
    })]
    request.session.append('image-transcription/request', {
      transcriptionId,
      target: request.target,
      route,
      messages,
      system: request.system,
      maxTokens: settings.maxOutputTokens,
    }, { ignorable: true })
    try {
      using callDeadline = deadline(request.signal, settings.timeoutMs, IMAGE_TRANSCRIPTION_TIMEOUT_CODE)
      const assembler = new BlockAssembler()
      for await (const chunk of this.ctx.llm.stream({
        ...route,
        messages,
        system: request.system,
        maxTokens: settings.maxOutputTokens,
        sessionId: request.session.id,
        purpose: 'image-transcription',
        signal: callDeadline.signal,
      })) assembler.push(chunk)
      callDeadline.signal.throwIfAborted()
      const terminal = finishFailure(assembler.finish)
      if (terminal !== undefined) throw terminal
      const output = assembler.blocks()
      if (output.some(item => item.type !== 'text')) {
        throw Object.assign(new Error('Image transcription output must contain plain text only.'), { code: 'IMAGE_TRANSCRIPTION_NON_TEXT' })
      }
      const text = output.map(item => item.type === 'text' ? item.text : '').join('').trim()
      if (text.length === 0) throw Object.assign(new Error('Image transcription model produced no text.'), { code: 'IMAGE_TRANSCRIPTION_EMPTY' })
      request.session.append('image-transcription/succeeded', {
        transcriptionId,
        target: request.target,
        text,
        output,
        ...assembler.usage === undefined ? {} : { usage: assembler.usage },
      }, { ignorable: true })
      return deepFreeze({
        type: 'image-transcription',
        transcriptionId,
        attachments: images.map(image => image.attachment),
        text,
        model: route,
      })
    } catch (error: unknown) {
      const failure = normalizedFailure(error)
      request.session.append('image-transcription/failed', { transcriptionId, target: request.target, failure }, { ignorable: true })
      throw Object.assign(new Error(failure.message), { code: failure.code, failure })
    }
  }

  async backfill(session: Session, signal?: AbortSignal): Promise<void> {
    for (const seq of [...session.surface.nodes]) {
      signal?.throwIfAborted()
      const event = session.events[seq]
      if (event === undefined) continue
      const content = contentOf(event)
      if (content === undefined || imagesOf(content).length === 0) continue
      const block = await this.transcribe({
        session,
        content,
        target: { kind: 'surface', seq },
        ...signal === undefined ? {} : { signal },
      })
      const success = session.events.findLast(candidate => candidate.type === 'image-transcription/succeeded'
        && candidate.data.transcriptionId === block.transcriptionId)
      if (success === undefined) throw new Error('image-transcription: successful block has no durable success event')
      appendReplacement(session, event, block, success.seq)
    }
  }
}

export const name = 'image-transcription'
export const inject = ['llm', 'sessions']
export default LlmImageTranscriptionService
