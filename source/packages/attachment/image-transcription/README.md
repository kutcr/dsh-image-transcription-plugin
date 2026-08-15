# @deepseek-ai/dsh-image-transcription

English | [中文](README.zh.md)

Optional image-transcription capability for explicitly text-only main models. `ctx.imageTranscription` sends one message's text and all images to a configured image-capable route, records the auxiliary request and outcome, and returns a durable `ImageTranscriptionBlock` retaining the original attachments. Each text envelope carries its stable `transcriptionId`; [`dsh-tool-image-recall`](../tool-image-recall/README.md) can use that ID to re-read one original image batch retained in the complete session event log.

Settings namespace: `image-transcription`. The optional `provider`/`model` pair defaults off; `maxOutputTokens` defaults to 2048, `timeoutMs` to 60000, and `imageIndexMaxChars` to 320. Requests are not retried automatically.

Every image-bearing message records its request before visual analysis begins. The Web conversation projects that durable lifecycle as an elapsed-time status until the transcription succeeds, then retains a failure row when it does not. A visual-route `TRANSPORT` termination becomes an explicit retry instruction instead of exposing the raw provider message.

## Compacted History

When compaction writes a checkpoint, this package replaces that checkpoint with the same summary plus a compact `<image-index>`. Each entry has the original image's ordinal, `transcriptionId`, and first description limited by `imageIndexMaxChars`. The index lets a text-only model call `recall_image` without adding every historical image to each request. Original attachment references remain in the session event log; they end only when the session or attachment is deleted.

## Model Experience

### Image-bearing message

#### What the model sees

Text-only models receive a faithful `<image-transcription>` text envelope with its stable `transcriptionId`; visual models receive the original image bytes. Historical recall sends a question and only the cited block's retained image batch to the auxiliary visual route.

#### Token effect

The transcription text adds its ordinary text-token cost to a text-only request. Restored images use the selected visual provider's image-token accounting.

#### KV Cache effect

Adding or backfilling a transcription changes the affected message and invalidates the request suffix from that node.

## Known Limitations and Deferred Work

- The first version has no automatic retry, OCR-specific structured output, or per-session override.
- Backfill covers only the current model surface; historical recall reads the complete event log without backfilling compacted events.
