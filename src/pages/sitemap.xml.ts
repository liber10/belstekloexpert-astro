import { getCollection } from 'astro:content';
import { brandModels, brands } from '@/data/brands';
import { site } from '@/data/site';

export const prerender = true;

const staticPaths = [
  '/',
  '/kalkulyator/',
  '/ceny/',
  '/kejsy/',
  '/otzyvy/',
  '/otzyv/',
  '/faq/',
  '/kontakty/',
  '/o-kompanii/',
  '/marki/',
  '/blog/',
  '/privacy/',
  '/llms.txt',
];

export async function GET() {
  const services = await getCollection('services');
  const blog = await getCollection('blog');

  const paths = [
    ...staticPaths,
    ...services.map((entry) => `/${entry.data.pageSlug}/`),
    ...blog.map((entry) => `/blog/${entry.id}/`),
    ...brands.map((brand) => `/marki/${brand.slug}/`),
    ...brandModels.map(({ brand, model }) => `/marki/${brand.slug}/${model.slug}/`),
  ];

  const uniquePaths = Array.from(new Set(paths)).sort();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...uniquePaths.map((path) => `  <url><loc>${site.domain}${path}</loc></url>`),
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
