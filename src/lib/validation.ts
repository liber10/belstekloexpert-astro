export const maxPhotoCount = 5;
export const maxPhotoSizeBytes = 10 * 1024 * 1024;

export const allowedPhotoTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

export function getUploadedPhotos(formData: FormData) {
  return formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);
}
export function getPhotoRefs(formData: FormData) {
  return formData
    .getAll('photo_refs')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function validatePhotoRefs(references: string[]) {
  if (references.length > maxPhotoCount) return 'Too many photo references.';
  if (new Set(references).size !== references.length) return 'Duplicate photo reference.';
  if (references.some((reference) => (
    reference.length > 2_048 || !/^b2:\/\/[a-z0-9][a-z0-9.-]+\/[A-Za-z0-9/_-]+\.[A-Za-z0-9]+$/.test(reference)
  ))) {
    return 'Invalid photo reference.';
  }
  return null;
}

export function validatePhotos(photos: File[]) {
  if (photos.length > maxPhotoCount) {
    return `Можно отправить не более ${maxPhotoCount} фото.`;
  }

  for (const photo of photos) {
    if (photo.size > maxPhotoSizeBytes) {
      if (isHeicPhoto(photo)) {
        return `${photo.name || 'photo'}: Фото iPhone в HEIC слишком большое. Выберите отправку как JPG или сделайте скрин/фото в совместимом формате.`;
      }

      return `Файл ${photo.name || 'photo'} больше 10 МБ.`;
    }

    if (!allowedPhotoTypes.has(photo.type)) {
      return `Файл ${photo.name || 'photo'} должен быть JPG, PNG, WebP или HEIC.`;
    }
  }

  return null;
}

function isHeicPhoto(photo: File) {
  const name = photo.name.toLowerCase();
  return (
    photo.type === 'image/heic' ||
    photo.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}
