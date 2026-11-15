import { supabase } from '../clients/supabase';

// Book photos are stored on the owner's Hostinger hosting (hostinger/photos/upload.php),
// not in Supabase. The upload file checks with Supabase that the caller is an admin.
// VITE_PHOTO_UPLOAD_URL overrides the address (used by the browser tests).
export const PHOTO_UPLOAD_URL = import.meta.env.VITE_PHOTO_UPLOAD_URL || 'https://photos.kitaabaurkona.com/upload.php';
const PHOTO_BASE = `${new URL(PHOTO_UPLOAD_URL).origin}/files/`;

export const MAX_PHOTOS = 10;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1600;
const QUALITY = 0.85;

// True for a photo that was uploaded through the admin panel (and so can be deleted).
export const isStoredPhoto = (url) => typeof url === 'string' && url.startsWith(PHOTO_BASE);

export const isPhotoFile = (file) => PHOTO_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);

class PhotoError extends Error {}

// Makes the photo at most 1600px on its longest side and re-saves it as WebP (or JPEG
// where WebP cannot be written). Phone photos of 4-8 MB become about 100-250 KB, which
// keeps the Hostinger space and the shop's page loads small. Re-drawing also drops any
// hidden data in the file (location, camera details).
export async function shrinkPhoto(file) {
  if (!isPhotoFile(file)) throw new PhotoError(`${file.name} is not a JPG, PNG or WebP photo.`);
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError(`${file.name} is larger than 25 MB.`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(`${file.name} could not be opened. Save it as a JPG and try again.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; // transparent PNG areas become white, not black
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new PhotoError(`${file.name} could not be prepared for upload.`);
  return blob;
}

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PhotoError('Your session has expired. Sign in again.');
  return token;
}

function failure(status, code) {
  if (status === 401) return new PhotoError('Your session has expired. Sign in again, then add the photo again.');
  if (status === 403) return new PhotoError(code === 'origin' ? 'The photo storage does not accept uploads from this address.' : "You don't have permission to upload photos.");
  if (status === 413) return new PhotoError('This photo is too large for the photo storage.');
  if (status === 415) return new PhotoError('This file is not a photo the storage accepts (JPG, PNG or WebP).');
  return new PhotoError(`The photo could not be saved (error ${status || 'unknown'}). Try again.`);
}

async function send(body, headers = {}) {
  let response;
  try {
    response = await fetch(PHOTO_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, ...headers },
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('The photo storage could not be reached. Check your internet connection, and that the Hostinger photo upload is set up.');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw failure(response.status, json.error);
  return json;
}

// Shrinks and uploads one photo; resolves with its public https link.
export async function uploadPhoto(file) {
  const blob = await shrinkPhoto(file);
  const form = new FormData();
  form.append('photo', blob, blob.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
  const { url } = await send(form);
  if (typeof url !== 'string' || !isStoredPhoto(url)) throw new PhotoError('The photo storage gave an unexpected answer.');
  return url;
}

// Deletes photos that were uploaded through the panel. Links to other image hosts are
// left alone. Best effort: a photo that cannot be deleted only takes up a little space.
export async function deletePhotos(urls) {
  const ours = [...new Set(urls.filter(isStoredPhoto))];
  for (let i = 0; i < ours.length; i += 20) {
    try {
      await send(JSON.stringify({ action: 'delete', urls: ours.slice(i, i + 20) }), { 'Content-Type': 'application/json' });
    } catch {
      return;
    }
  }
}

// Runs tasks a few at a time, in order of the list, reporting progress.
export async function runLimited(items, worker, { limit = 3, onProgress } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  let stopped = false;
  async function lane() {
    while (next < items.length && !stopped) {
      const index = next++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        stopped = true; // the first failure stops the rest from starting
        throw error;
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export function photoErrorMessage(error) {
  return error instanceof PhotoError ? error.message : 'The photo could not be saved. Try again.';
}
