import { loadSupabase } from '../clients/supabase';
import { isUuid, unwrap } from './request';
import { RETURN_PHOTO_LIMIT } from '../utils/returns';

// Customer photos for a return request live in the private Supabase Storage bucket
// "return-photos", in a folder named after the customer (only they and admins can see
// them; schema.sql 9i).
const BUCKET = 'return-photos';
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1600;
export const RETURN_PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export class ReturnPhotoError extends Error {}

const isPhoto = (file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);

// At most 1600px on the longest side, saved as WebP (or JPEG where WebP cannot be
// written). Re-drawing also drops hidden data in the file (location, camera details).
async function shrink(file) {
  if (!isPhoto(file)) throw new ReturnPhotoError(`${file.name} is not a JPG, PNG or WebP photo.`);
  if (file.size > MAX_INPUT_BYTES) throw new ReturnPhotoError(`${file.name} is larger than 25 MB.`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ReturnPhotoError(`${file.name} could not be opened. Save it as a JPG and try again.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new ReturnPhotoError(`${file.name} could not be prepared for upload.`);
  return blob;
}

const randomName = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Uploads one photo to the customer's folder and returns its path.
export async function uploadReturnPhoto(file) {
  const supabase = await loadSupabase();
  const blob = await shrink(file);
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new ReturnPhotoError('Your session has expired. Sign in again.');
  const path = `${userId}/${randomName()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw new ReturnPhotoError('The photo could not be uploaded. Try again.');
  return path;
}

// Short-lived links to show stored photos ({ path: url }).
export async function returnPhotoUrls(paths) {
  if (!paths?.length) return {};
  const supabase = await loadSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  if (error) return {};
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
}

export async function listMyReturnRequests(orderId) {
  if (!isUuid(orderId)) return [];
  const supabase = await loadSupabase();
  const { data } = unwrap(await supabase.from('return_requests').select('*').eq('order_id', orderId).order('created_at', { ascending: false }));
  return data ?? [];
}

// items: [{ sku, quantity }]; photos: stored paths. Returns the new request's id.
export async function requestReturn({ orderId, kind, items, reason, remark, photos, refundUpi }) {
  const supabase = await loadSupabase();
  const { data } = unwrap(
    await supabase.rpc('request_return', {
      p_order: orderId,
      p_kind: kind,
      p_items: items,
      p_reason: reason,
      p_remark: remark || null,
      p_photos: (photos ?? []).slice(0, RETURN_PHOTO_LIMIT),
      p_refund_upi: refundUpi || null,
    }),
  );
  return data;
}

export async function withdrawReturnRequest(requestId) {
  const supabase = await loadSupabase();
  unwrap(await supabase.rpc('withdraw_return_request', { p_request: requestId }));
}
