import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    h1: z.string(),
    pageSlug: z.string(),
    priceFrom: z.number(),
    duration: z.string(),
    metaTitle: z.string(),
    metaDescription: z.string(),
    cta: z.string(),
    serviceType: z.string(),
    benefits: z.array(z.string()).default([]),
    includes: z.array(z.string()).default([]),
    faq: z
      .array(
        z.object({
          question: z.string(),
          answer: z.string(),
        }),
      )
      .default([]),
  }),
});

const faq = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/faq' }),
  schema: z.object({
    question: z.string(),
    category: z.string(),
    order: z.number(),
  }),
});

const cases = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cases' }),
  schema: z.object({
    title: z.string(),
    car: z.string(),
    service: z.string(),
    duration: z.string(),
    price: z.string(),
    imageBefore: z.string().optional(),
    imageAfter: z.string().optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
  }),
});

const reviews = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/reviews' }),
  schema: z.object({
    title: z.string(),
    draft: z.boolean().default(true),
    source: z.string().optional(),
  }),
});

export const collections = { services, faq, cases, blog, reviews };
