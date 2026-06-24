import favicon from '../../public/favicon.svg?raw';

export const prerender = true;

export function GET() {
  return new Response(favicon, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
