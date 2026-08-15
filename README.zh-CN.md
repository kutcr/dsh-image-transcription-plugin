# DSH 图像转述插件

[English](README.md) · [上游：DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [主题](https://github.com/topics/dsh-plugin)

这是 DeepSeek Harness 图像转述功能的源码发布包，由两个 Cordis 插件构成：

- `@deepseek-ai/dsh-image-transcription`：主模型仅支持文本时，把含图消息转换为可持久保存的视觉转述。
- `@deepseek-ai/dsh-tool-image-recall`：注册 `recall_image`，让主模型按需请已配置的视觉模型重新读取被引用的历史图片。

## 内容

- `patches/deepseek-harness-image-transcription.patch`：针对上游提交 `87dd1e51b0fb82e10cfe1af791f99ea4506cc1b1` 的完整补丁。
- `source/`：两个插件的软件包源码、文档和测试，不包含构建产物及依赖。
- `INSTALL.md`：应用补丁及验证步骤。

## 功能

- 稳定 `transcriptionId` 将文本转述与原始附件关联。
- 上下文压缩会生成紧凑图片索引，原图仍保留在会话日志中。
- `recall_image` 只向视觉路由发送被引用图片批次与当前问题。
- Web 界面显示图像转述耗时状态，并保留清晰的失败信息。

## 配置图像转述模型

此插件需要先配置一个图像转述模型，才能处理图片。

1. 打开 **设置 → 模型**。
2. 在 **图像转述模型** 中选择主模型为纯文本时使用的视觉提供方和模型。
3. 展开 **配置**，填写提供方 API 密钥、地址、协议和可用模型 ID。
4. 保存配置。

![图像转述模型配置](assets/image-transcription-model-configuration.png)

## 许可证与署名

本发布包包含对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的修改，遵循 MIT 许可证。二次分发时请保留随附的 `LICENSE` 和上游署名。
