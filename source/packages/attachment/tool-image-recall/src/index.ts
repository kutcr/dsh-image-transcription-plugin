/** Model-facing historical image recall over the image-transcription service. @module @deepseek-ai/dsh-tool-image-recall */

import type { Context } from '@deepseek-ai/cordis'
import { ImageTranscriptionId } from '@deepseek-ai/dsh-llm'
import type { ImageTranscriptionBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-image-transcription'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Loader name for the historical-image recall tool. */
export const name = 'tool-image-recall'
/** Services needed to register and dispatch history recall. */
export const inject = ['tools', 'imageTranscription']

const IMAGE_TRANSCRIPTION_VALUE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', const: 'image-transcription', required: true },
    transcriptionId: { type: 'string', required: true },
    attachments: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          name: { type: 'string' },
        },
      },
    },
    text: { type: 'string', required: true },
    model: {
      type: 'object', additionalProperties: false, required: true,
      properties: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
      },
    },
  },
} as const

/** Register `recall_image` for questions about one prior image transcription. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'recall_image',
    description: 'Re-read one historical image when the user asks about its people, text, objects, or relationship to another image. Use only a transcription_id shown in an earlier <image-transcription> block. Do not use when the current model can already see the original image.',
    parameters: {
      transcription_id: { type: 'string', required: true, description: 'The transcriptionId from the historical <image-transcription> block.' },
      question: { type: 'string', required: true, description: 'The user question to answer from that image.' },
    },
    output: {
      schema: IMAGE_TRANSCRIPTION_VALUE,
      render: (_args, value) => [value as unknown as ImageTranscriptionBlock],
    },
    async execute(args, exec) {
      if (args.transcription_id.trim().length === 0) throw new Error('transcription_id must be a non-empty string')
      if (args.question.trim().length === 0) throw new Error('question must be a non-empty string')
      if (exec.agent === undefined) throw new Error('recall_image requires an active conversation session')
      return await ctx.imageTranscription.recall({
        session: exec.agent.session,
        transcriptionId: ImageTranscriptionId(args.transcription_id),
        question: args.question,
        callId: exec.callId,
        signal: exec.signal,
      })
    },
  }))
}
