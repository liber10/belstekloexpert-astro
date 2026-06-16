import { site } from '@/data/site';

export function buildSeo({
  title,
  description,
  path,
  image,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return {
    title,
    description,
    canonical: `${site.domain}${normalizedPath}`,
    image: image ?? '/images/hero-autoglass.png',
  };
}
