# @deepseek-ai/dsh-tool-image-recall

English | [中文](README.zh.md)

Model-facing consumer of `ctx.imageTranscription`. It registers `recall_image` with exactly `transcription_id` and `question`. The tool finds an `ImageTranscriptionBlock` in the calling session's complete event log, sends that block's retained original image attachments and the question to the configured visual route, and returns a fresh image-transcription block as the tool result.

The tool schema asks a text-only model to use the stable `transcriptionId` from a prior `<image-transcription>` envelope only for questions about historical images. It is intentionally available without an additional configuration surface; the auxiliary model settings remain owned by `@deepseek-ai/dsh-image-transcription`.

## Model Experience

### Recall result

#### What the model sees

Success returns a new `<image-transcription>` envelope whose `transcriptionId` identifies the recall result. A missing source or attachment, missing configuration, empty visual response, or visual-route failure is an `Error: ...` tool result; an unavailable source or attachment directs the model to ask for an upload.

#### Token effect

The configured visual route receives one question and one retained image batch. The main text model receives only the returned text envelope until compaction.

#### KV Cache effect

The result appends to the conversation and preserves the existing request prefix.

## Known Limitations and Deferred Work

- One call recalls one prior transcription. Comparing multiple images requires one tool call per referenced transcription.
- The tool depends on the retained session log and attachment lifecycle. If either has been deleted, the user must upload the image again.
