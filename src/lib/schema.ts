import { businessHours } from '@/data/business-hours';
import { contacts } from '@/data/contacts';
import { pricePackages, prices } from '@/data/prices';
import { site } from '@/data/site';

const businessId = `${site.domain}/#business`;

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.domain}/#organization`,
    name: site.name,
    legalName: site.legalName,
    url: site.domain,
    email: site.email,
    telephone: contacts.phone,
    taxID: site.unp,
  };
}

export function autoRepairSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': ['AutoRepair', 'LocalBusiness'],
    '@id': businessId,
    name: site.name,
    url: site.domain,
    telephone: contacts.phone,
    email: site.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address,
      addressLocality: site.city,
      addressCountry: 'BY',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: contacts.coordinates.latitude,
      longitude: contacts.coordinates.longitude,
    },
    openingHours: businessHours.iso,
    areaServed: {
      '@type': 'City',
      name: site.city,
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Услуги BelStekloExpert',
      itemListElement: [
        ...prices.map((item) => ({
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: item.title,
            url: `${site.domain}${item.url}`,
          },
          ...(item.priceFrom > 0
            ? {
                priceCurrency: 'BYN',
                price: item.priceFrom,
                priceSpecification: {
                  '@type': 'PriceSpecification',
                  priceCurrency: 'BYN',
                  price: item.priceFrom,
                  description: item.unit,
                },
              }
            : {}),
        })),
        ...pricePackages.map((item) => ({
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: `Пакет ${item.title}: автостекло под ключ`,
          },
          priceCurrency: 'BYN',
          price: item.priceFrom,
          priceSpecification: {
            '@type': 'PriceSpecification',
            priceCurrency: 'BYN',
            price: item.priceFrom,
            description: item.unit,
          },
        })),
      ],
    },
  };
}

export function serviceSchema({
  name,
  description,
  url,
  priceFrom,
}: {
  name: string;
  description: string;
  url: string;
  priceFrom?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    description,
    url,
    provider: {
      '@id': businessId,
    },
    areaServed: site.city,
    ...(priceFrom
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: 'BYN',
            price: priceFrom,
            url,
          },
        }
      : {}),
  };
}

export function faqPageSchema(
  items: Array<{
    question: string;
    answer: string;
  }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export function breadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
