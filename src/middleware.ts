import { defineMiddleware } from 'astro:middleware';

const canonicalHost = 'belstekloexpert.by';
const previewHostSuffixes = ['.workers.dev', '.pages.dev'];

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.hostname === `www.${canonicalHost}`) {
    const canonicalUrl = new URL(context.url);
    canonicalUrl.hostname = canonicalHost;
    return Response.redirect(canonicalUrl, 308);
  }

  const response = await next();
  const isPublicPreview =
    process.env.DEPLOY_ENV === 'preview' ||
    previewHostSuffixes.some((suffix) => context.url.hostname.endsWith(suffix));

  if (!isPublicPreview) return response;

  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
