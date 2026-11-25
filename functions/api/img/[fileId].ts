import { handleImageProxy } from '../../_lib/router.ts';
import type { PagesContext } from '../../_lib/types.ts';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const fileId = Array.isArray(context.params.fileId)
    ? context.params.fileId[0]
    : context.params.fileId || '';
  return handleImageProxy(fileId, context.env);
}
