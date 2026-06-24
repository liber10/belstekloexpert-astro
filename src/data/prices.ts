export const prices = [
  {
    title: 'Замена лобового стекла',
    priceFrom: 100,
    unit: 'BYN за работу',
    url: '/zamena-lobovogo-stekla/',
  },
  {
    title: 'Ремонт скола',
    priceFrom: 40,
    unit: 'BYN',
    url: '/remont-skolov/',
  },
  {
    title: 'Ремонт трещины',
    priceFrom: 35,
    unit: 'BYN',
    url: '/remont-treshchin/',
  },
  {
    title: 'Замена бокового стекла',
    priceFrom: 80,
    unit: 'BYN за работу',
    url: '/zamena-bokovogo-stekla/',
  },
  {
    title: 'Замена заднего стекла',
    priceFrom: 80,
    unit: 'BYN за работу',
    url: '/zamena-zadnego-stekla/',
  },
  {
    title: 'Выезд по Минску',
    priceFrom: 20,
    unit: 'BYN',
    url: '/vyiezd-po-minsku/',
  },
];

export const priceNote =
  'Точная стоимость зависит от марки, модели, года, типа стекла, молдингов, обогрева, камеры и датчиков.';

export const pricePackages = [
  {
    title: 'Эконом',
    priceFrom: 220,
    unit: 'BYN под ключ',
    text: 'Когда важно быстро закрыть задачу и поставить совместимое стекло без лишних опций.',
    includes: ['стекло совместимого класса', 'работа', 'базовая проверка герметичности'],
    eventName: 'price_package_econom_click',
  },
  {
    title: 'Оптимум',
    priceFrom: 320,
    unit: 'BYN под ключ',
    text: 'Баланс цены и ресурса: подбор по VIN, аккуратная посадка, сохранение датчиков и чистый салон.',
    includes: ['подбор по VIN', 'работа', 'учёт датчика дождя и обогрева', 'рекомендации после выдачи'],
    eventName: 'price_package_optimum_click',
  },
  {
    title: 'Премиум',
    priceFrom: 480,
    unit: 'BYN под ключ',
    text: 'Для свежих авто, камер, ADAS и ситуаций, где важна максимальная близость к заводской комплектации.',
    includes: ['стекло высокого класса', 'датчики и камера', 'контроль посадки', 'гарантия герметичности'],
    eventName: 'price_package_premium_click',
  },
];

export const popularPriceExamples = [
  {
    car: 'Volkswagen Passat',
    glass: 'лобовое стекло',
    range: 'от 320 BYN под ключ',
    note: 'зависит от датчика дождя, обогрева и камеры',
  },
  {
    car: 'Skoda Octavia',
    glass: 'лобовое стекло',
    range: 'от 300 BYN под ключ',
    note: 'часто есть несколько вариантов по году и комплектации',
  },
  {
    car: 'Renault Logan',
    glass: 'лобовое стекло',
    range: 'от 240 BYN под ключ',
    note: 'обычно можно быстро подобрать бюджетный вариант',
  },
  {
    car: 'Geely Coolray',
    glass: 'лобовое стекло',
    range: 'по VIN',
    note: 'важны камера, датчики и комплектация',
  },
  {
    car: 'Kia Rio',
    glass: 'лобовое или боковое',
    range: 'от 260 BYN под ключ',
    note: 'итог зависит от типа стекла и наличия обогрева',
  },
  {
    car: 'BMW X5',
    glass: 'лобовое стекло',
    range: 'по VIN',
    note: 'часто нужны точные опции: камера, ассистенты, обогрев',
  },
];

export const priceFactors = [
  'марка, модель и год автомобиля',
  'оригинал или качественный аналог',
  'датчик дождя, камера, обогрев, антенны',
  'молдинг, клипсы и дополнительные расходники',
  'срочность, выезд и условия установки',
];
