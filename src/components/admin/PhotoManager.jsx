import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImageSquare, Star, Trash } from '@phosphor-icons/react';
import { isPhotoFile, MAX_PHOTOS, PHOTO_ACCEPT, photoErrorMessage, uploadPhoto } from '../../services/photoService';
import { photoEntry } from '../../utils/photoEntry';

// The photos of one book: add from the computer (or drag in), change the order, choose
// the cover (the first photo) and remove. New photos are shrunk and uploaded right
// away; the book itself only changes when the editor is saved.
//   photos     [{ key, url, uploading, preview }]
//   onChange   receives an updater function (photos => photos)
//   onUploaded called with each new photo's link (so unsaved uploads can be cleaned up)
function PhotoManager({ photos, onChange, onUploaded, onBusyChange }) {
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const previews = useRef(new Set());
  const uploading = photos.some((p) => p.uploading);

  useEffect(() => onBusyChange?.(uploading), [uploading, onBusyChange]);
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addFiles(fileList) {
    const files = [...(fileList ?? [])];
    if (files.length === 0) return;
    const usable = files.filter(isPhotoFile);
    const room = MAX_PHOTOS - photos.length;
    const problems = [];
    if (usable.length < files.length) problems.push('Only JPG, PNG and WebP photos can be added.');
    if (usable.length > room) problems.push(`A book can have up to ${MAX_PHOTOS} photos, so only the first ${Math.max(room, 0)} were added.`);
    setError(problems.join(' ') || null);

    for (const file of usable.slice(0, Math.max(room, 0))) {
      const entry = { ...photoEntry(null), uploading: true, preview: URL.createObjectURL(file) };
      previews.current.add(entry.preview);
      onChange((list) => [...list, entry]);
      uploadPhoto(file)
        .then((url) => {
          onUploaded?.(url);
          onChange((list) => list.map((p) => (p.key === entry.key ? { ...p, url, uploading: false } : p)));
        })
        .catch((err) => {
          setError(photoErrorMessage(err));
          onChange((list) => list.filter((p) => p.key !== entry.key));
        });
    }
  }

  const move = (index, to) => onChange((list) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    return next;
  });
  const remove = (key) => onChange((list) => list.filter((p) => p.key !== key));

  return (
    <div className="stack-sm">
      <ul className="ap-photos" aria-label="Photos">
        {photos.map((photo, index) => (
          <li key={photo.key} className="ap-photo">
            <div className="ap-photo-img">
              {photo.uploading ? (
                <>
                  {photo.preview && <img src={photo.preview} alt="" style={{ opacity: 0.35 }} />}
                  <span className="ap-photo-progress" style={{ position: 'absolute', inset: 0 }} role="status">
                    <span className="spinner" aria-hidden="true" />
                    Uploading…
                  </span>
                </>
              ) : (
                <img src={photo.url} alt={`Photo ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
              )}
              {index === 0 && <span className="ap-photo-cover">Cover</span>}
            </div>
            <div className="ap-photo-tools">
              <button type="button" aria-label={`Move photo ${index + 1} left`} title="Move left" aria-disabled={index === 0 || undefined} onClick={() => index > 0 && move(index, index - 1)}>
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              <button type="button" aria-label={`Make photo ${index + 1} the cover`} title="Make cover" aria-disabled={index === 0 || undefined} onClick={() => index > 0 && move(index, 0)}>
                <Star size={18} aria-hidden="true" weight={index === 0 ? 'fill' : 'regular'} />
              </button>
              <button type="button" aria-label={`Move photo ${index + 1} right`} title="Move right" aria-disabled={index === photos.length - 1 || undefined} onClick={() => index < photos.length - 1 && move(index, index + 1)}>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <button type="button" data-kind="remove" aria-label={`Remove photo ${index + 1}`} title="Remove" aria-disabled={photo.uploading || undefined} onClick={() => !photo.uploading && remove(photo.key)}>
                <Trash size={18} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
        {photos.length < MAX_PHOTOS && (
          <li>
            <label
              className="ap-photo-add"
              data-dragging={dragging || undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <ImageSquare size={32} aria-hidden="true" />
              {photos.length === 0 ? 'Add photos' : 'Add more photos'}
              <input
                type="file"
                accept={PHOTO_ACCEPT}
                multiple
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
          </li>
        )}
      </ul>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default PhotoManager;
