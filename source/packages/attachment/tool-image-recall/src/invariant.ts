/** Package invariant registration for the historical-image recall tool. @module @deepseek-ai/dsh-tool-image-recall/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-image-recall'
/** Cordis companion plugin name. */
export const name = 'tool-image-recall-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: this consumer delegates durable relations to image-transcription. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
