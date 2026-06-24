export interface BrandModel {
  name: string;
  slug: string;
}

export interface BrandPage {
  name: string;
  slug: string;
  priceFrom: number;
  lead: string;
  models: BrandModel[];
  notes: string[];
}

export const brands: BrandPage[] = [
  {
    name: 'Volkswagen',
    slug: 'volkswagen',
    priceFrom: 300,
    lead: 'Подбираем лобовые, боковые и задние стёкла Volkswagen по VIN, чтобы не ошибиться с датчиком дождя, обогревом и креплениями.',
    models: [
      { name: 'Passat', slug: 'passat' },
      { name: 'Golf', slug: 'golf' },
      { name: 'Polo', slug: 'polo' },
      { name: 'Tiguan', slug: 'tiguan' },
    ],
    notes: ['часто есть несколько вариантов лобового стекла', 'важны год, кузов и комплектация', 'проверяем датчики перед заказом'],
  },
  {
    name: 'Skoda',
    slug: 'skoda',
    priceFrom: 300,
    lead: 'Для Skoda особенно важно сверить поколение и комплектацию: у Octavia, Superb и Kodiaq часто отличаются датчики и обогрев.',
    models: [
      { name: 'Octavia', slug: 'octavia' },
      { name: 'Superb', slug: 'superb' },
      { name: 'Rapid', slug: 'rapid' },
      { name: 'Kodiaq', slug: 'kodiaq' },
    ],
    notes: ['подбор по VIN снижает риск ошибки', 'можно согласовать эконом и оптимум варианты', 'после замены даём рекомендации по выдержке'],
  },
  {
    name: 'Geely',
    slug: 'geely',
    priceFrom: 330,
    lead: 'Geely часто требует точного подбора по комплектации: камеры, ассистенты, обогрев и крепления могут отличаться даже внутри одной модели.',
    models: [
      { name: 'Coolray', slug: 'coolray' },
      { name: 'Atlas Pro', slug: 'atlas-pro' },
      { name: 'Tugella', slug: 'tugella' },
      { name: 'Emgrand', slug: 'emgrand' },
    ],
    notes: ['проверяем камеру и ассистенты', 'согласуем доступные варианты стекла', 'объясняем сроки поставки до записи'],
  },
  {
    name: 'Renault',
    slug: 'renault',
    priceFrom: 240,
    lead: 'Работаем с легковыми Renault и коммерческими машинами: подбираем стекло, согласуем время и стараемся сократить простой.',
    models: [
      { name: 'Logan', slug: 'logan' },
      { name: 'Duster', slug: 'duster' },
      { name: 'Sandero', slug: 'sandero' },
      { name: 'Master', slug: 'master' },
    ],
    notes: ['для коммерческих авто можно планировать окно заранее', 'ремонт скола иногда выгоднее замены', 'подскажем варианты по бюджету'],
  },
  {
    name: 'Kia',
    slug: 'kia',
    priceFrom: 260,
    lead: 'Для Kia подбираем стекло по модели, году и опциям: Rio, Ceed, Sportage и Sorento могут иметь разные комплектации стекла.',
    models: [
      { name: 'Rio', slug: 'rio' },
      { name: 'Sportage', slug: 'sportage' },
      { name: 'Ceed', slug: 'ceed' },
      { name: 'Sorento', slug: 'sorento' },
    ],
    notes: ['сверяем обогрев и датчики', 'можно отправить фото маркировки стекла', 'после установки проверяем прилегание'],
  },
  {
    name: 'Hyundai',
    slug: 'hyundai',
    priceFrom: 260,
    lead: 'Подбираем автостёкла Hyundai для популярных моделей и заранее уточняем опции, которые влияют на цену и наличие.',
    models: [
      { name: 'Solaris', slug: 'solaris' },
      { name: 'Tucson', slug: 'tucson' },
      { name: 'Creta', slug: 'creta' },
      { name: 'Santa Fe', slug: 'santa-fe' },
    ],
    notes: ['важен год выпуска и рестайлинг', 'датчики и камера проверяются до заказа', 'можно выбрать несколько уровней бюджета'],
  },
  {
    name: 'Toyota',
    slug: 'toyota',
    priceFrom: 300,
    lead: 'Toyota часто имеет разные варианты стекла под одну модель, поэтому начинаем с VIN, фото маркировки или комплектации.',
    models: [
      { name: 'Camry', slug: 'camry' },
      { name: 'RAV4', slug: 'rav4' },
      { name: 'Corolla', slug: 'corolla' },
      { name: 'Land Cruiser Prado', slug: 'land-cruiser-prado' },
    ],
    notes: ['учитываем обогрев зоны дворников', 'проверяем камеры и ассистенты', 'согласуем срок и наличие до записи'],
  },
  {
    name: 'BMW',
    slug: 'bmw',
    priceFrom: 420,
    lead: 'Для BMW критичны точные опции стекла: камеры, ассистенты, датчики, акустика и обогрев. Подбор делаем по VIN.',
    models: [
      { name: 'X5', slug: 'x5' },
      { name: '3 Series', slug: '3-series' },
      { name: '5 Series', slug: '5-series' },
      { name: 'X3', slug: 'x3' },
    ],
    notes: ['не подбираем стекло на глаз', 'сохраняем датчики и крепления', 'объясняем разницу между вариантами'],
  },
  {
    name: 'Audi',
    slug: 'audi',
    priceFrom: 390,
    lead: 'У Audi много комплектаций стекла, поэтому заранее сверяем датчики, камеры, акустику и обогрев.',
    models: [
      { name: 'A4', slug: 'a4' },
      { name: 'A6', slug: 'a6' },
      { name: 'Q5', slug: 'q5' },
      { name: 'Q7', slug: 'q7' },
    ],
    notes: ['подбор по VIN обязателен для сложных комплектаций', 'можно сравнить несколько производителей', 'аккуратно работаем с салоном и кузовом'],
  },
  {
    name: 'Mercedes-Benz',
    slug: 'mercedes-benz',
    priceFrom: 420,
    lead: 'Для Mercedes-Benz подбираем стекло по VIN и учитываем камеры, ассистенты, обогрев, акустику и тип кузова.',
    models: [
      { name: 'E-Class', slug: 'e-class' },
      { name: 'GLC', slug: 'glc' },
      { name: 'Sprinter', slug: 'sprinter' },
      { name: 'Vito', slug: 'vito' },
    ],
    notes: ['важны ассистенты и камера', 'для коммерческих моделей согласуем простой', 'даём рекомендации после замены'],
  },
  {
    name: 'Ford',
    slug: 'ford',
    priceFrom: 260,
    lead: 'Работаем с легковыми и коммерческими Ford, заранее уточняем стекло, молдинги и сроки.',
    models: [
      { name: 'Focus', slug: 'focus' },
      { name: 'Mondeo', slug: 'mondeo' },
      { name: 'Transit', slug: 'transit' },
      { name: 'Kuga', slug: 'kuga' },
    ],
    notes: ['для Transit удобно планировать запись заранее', 'ремонт скола иногда спасает стекло', 'согласуем стекло и расходники до работ'],
  },
  {
    name: 'Nissan',
    slug: 'nissan',
    priceFrom: 280,
    lead: 'Для Nissan подбираем стекло по модели и году, отдельно проверяем камеры, датчики и обогрев.',
    models: [
      { name: 'Qashqai', slug: 'qashqai' },
      { name: 'X-Trail', slug: 'x-trail' },
      { name: 'Juke', slug: 'juke' },
      { name: 'Note', slug: 'note' },
    ],
    notes: ['уточняем поколение и рестайлинг', 'можно отправить VIN или фото маркировки', 'объясняем итоговую цену до записи'],
  },
];

export const brandModels = brands.flatMap((brand) =>
  brand.models.map((model) => ({
    brand,
    model,
  })),
);

export function findBrand(slug: string) {
  return brands.find((brand) => brand.slug === slug);
}
