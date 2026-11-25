import { handleApiRequest } from '../_lib/router.ts';
import type { PagesContext } from '../_lib/types.ts';

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleApiRequest(context.request, context.env);
}
