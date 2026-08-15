# Install into DeepSeek Harness

## Prerequisite

Use a checkout based on upstream commit `87dd1e51b0fb82e10cfe1af791f99ea4506cc1b1`. The patch intentionally targets this revision so its context stays reviewable.

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 87dd1e51b0fb82e10cfe1af791f99ea4506cc1b1
git apply --check --ignore-space-change PATH_TO_THIS_REPOSITORY\patches\deepseek-harness-image-transcription.patch
git apply --ignore-space-change PATH_TO_THIS_REPOSITORY\patches\deepseek-harness-image-transcription.patch
pnpm install --frozen-lockfile
pnpm run build
```

Start the Web profile and select a visual provider in **Settings → Models → Image transcription model**. A text-only primary model receives the transcription; `recall_image` revisits an older image on demand.

## Verify

```powershell
pnpm exec vitest run packages/attachment/image-transcription/tests/transcription.spec.ts
pnpm exec vitest run packages/attachment/tool-image-recall/tests/recall.spec.ts
pnpm exec vitest run packages/client/ui-conversation/tests/chat-view.client.spec.tsx
```

The `source/` directory is for source inspection and review. Apply the patch to install this release because it also wires the two packages into the Harness session, model, bundle, and UI integrations.
