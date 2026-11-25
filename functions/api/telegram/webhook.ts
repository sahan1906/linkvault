import { handleTelegramWebhook } from '../../_lib/router.ts';
import type { PagesContext } from '../../_lib/types.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  return handleTelegramWebhook(context.request, context.env);
}
