export const contacts = {
  phone: '+375 33 682-81-35',
  phoneHref: 'tel:+375336828135',
  telegram: 'https://t.me/belstekloexpert',
  viber: 'viber://chat?number=%2B375336828135',
  instagram: 'https://www.instagram.com/belstekloexpert/',
  yandexMaps: 'https://yandex.by/maps/?ll=27.547441%2C53.954319&z=17&pt=27.547441%2C53.954319%2Cpm2rdm',
  googleMaps: 'https://maps.google.com/?q=53.954319,27.547441',
  twoGisSearch: 'https://2gis.by/minsk/search/BelStekloExpert',
  address: 'Минск, Долгиновский тракт, 150',
  coordinates: {
    latitude: 53.954319,
    longitude: 27.547441,
  },
};

export const reviewLinks = [
  {
    label: 'Яндекс Карты',
    href: contacts.yandexMaps,
    text: 'Лучше всего работает для локального поиска по Минску.',
  },
  {
    label: 'Google Maps',
    href: contacts.googleMaps,
    text: 'Помогает тем, кто строит маршрут из поиска Google.',
  },
  {
    label: '2ГИС',
    href: contacts.twoGisSearch,
    text: 'Полезно для клиентов, которые выбирают сервис по карте и району.',
  },
];
