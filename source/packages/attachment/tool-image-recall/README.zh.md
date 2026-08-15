# @deepseek-ai/dsh-tool-image-recall

[English](README.md) | 中文

`ctx.imageTranscription` 的模型可见 Consumer。它注册仅带 `transcription_id` 和 `question` 的 `recall_image`。工具在调用代理的完整会话事件日志中查找 `ImageTranscriptionBlock`，将该块保留的原始图像附件与问题发送到已配置的视觉路由，并将新的图像转述块作为工具结果返回。

工具 schema 要求纯文本模型仅在用户询问历史图片时使用先前 `<image-transcription>` 信封中的稳定 `transcriptionId`。它不增加第二个配置入口；辅助模型设置仍由 `@deepseek-ai/dsh-image-transcription` 所有。

## 模型体验

### 回看结果

#### 模型看到什么

成功时返回带新 `transcriptionId` 的 `<image-transcription>` 信封。来源或附件缺失、缺少配置、视觉模型空输出或视觉调用失败时，工具结果为 `Error: ...`；来源或附件不可用时错误会要求模型请用户重新上传。

#### Token 影响

已配置的视觉路由接收一个问题和一批保留图像。主纯文本模型直到压缩前只接收返回的文本信封。

#### KV Cache 影响

结果追加到会话，并保留既有请求前缀。

## 已知限制与后续工作

- 一次调用只回看一条先前转述。比较多张图片需要对每条引用分别调用工具。
- 工具依赖会话日志和附件生命周期；任一方被删除时，用户需要重新上传图片。
