# @deepseek-ai/dsh-image-transcription

[English](README.md) | 中文

为明确的纯文本主模型提供可选图像转述能力。`ctx.imageTranscription` 将一条消息的文字和全部图片发送给已配置的视觉路由，记录辅助请求及结果，并返回保留原始附件的持久 `ImageTranscriptionBlock`。每个文本信封带有稳定 `transcriptionId`；[`dsh-tool-image-recall`](../tool-image-recall/README.md) 可使用该 ID 回看完整会话事件日志中保留的一批原图。

设置 namespace 为 `image-transcription`。可选的 `provider`/`model` 组合默认关闭；`maxOutputTokens` 默认 2048，`timeoutMs` 默认 60000，`imageIndexMaxChars` 默认 320。请求不自动重试。

每条含图消息都会在视觉分析开始前记录请求。Web 对话会将该持久生命周期投影为带已等待时长的状态，直到转述成功；失败时保留失败行。视觉路由的 `TRANSPORT` 中断会转换为明确的重试提示，不再暴露原始提供商消息。

## 已压缩历史

compaction 写入检查点时，本包会将检查点替换为原摘要加紧凑的 `<image-index>`。每条记录有原图顺序号、`transcriptionId` 和按 `imageIndexMaxChars` 截断的首次转述。索引让纯文本模型可以调用 `recall_image`，而不必在每次请求中附带全部历史图片。原始附件引用保留在会话事件日志中，只有删除会话或附件时才结束。

## 模型体验

### 含图消息

#### 模型看到什么

纯文本模型接收带稳定 `transcriptionId` 的忠实 `<image-transcription>` 文本信封；视觉模型接收原始图片字节。历史回看会将问题和仅被引用块保留的一批原图发送至辅助视觉路由。

#### Token 影响

转述文字按普通文本计入纯文本请求；恢复后的图片采用所选视觉提供商的图片 token 计量。

#### KV Cache 影响

新增或补齐转述会改变对应消息，并使从该节点开始的请求后缀失效。

## 已知限制与后续工作

- 首版没有自动重试、OCR 专用结构化输出或会话级覆盖。
- 补齐仅处理当前模型 surface；历史回看从完整事件日志读取，不会补齐已压缩事件。
