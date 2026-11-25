import { renderPicLinkPage } from '../_lib/piclink.ts';
import type { PagesContext } from '../_lib/types.ts';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const slug = Array.isArray(context.params.slug)
    ? context.params.slug[0]
    : context.params.slug || '';
  return renderPicLinkPage(slug, context.request, context.env);
}
