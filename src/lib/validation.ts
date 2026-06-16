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

export function validatePhotos(photos: File[]) {
  if (photos.length > maxPhotoCount) {
    return `Можно отправить не более ${maxPhotoCount} фото.`;
  }

  for (const photo of photos) {
    if (photo.size > maxPhotoSizeBytes) {
      return `Файл ${photo.name || 'photo'} больше 10 МБ.`;
    }

    if (!allowedPhotoTypes.has(photo.type)) {
      return `Файл ${photo.name || 'photo'} должен быть JPG, PNG, WebP или HEIC.`;
    }
  }

  return null;
}
