import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowSquareOut, CaretDown } from '@phosphor-icons/react';
import { adminCreateBook, adminErrorMessage, adminGetBook, adminListCategories, adminSaveBook, photoUsedElsewhere } from '../../services/adminService';
import { deletePhotos, isStoredPhoto } from '../../services/photoService';
import { discountOf, emptyBookForm, otherAttributesOf, toBookForm, validateBookForm } from '../../utils/bookForm';
import { CATEGORIES } from '../../utils/categories';
import { LIVE_ORIGIN } from '../../utils/release';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';
import PhotoManager from '../../components/admin/PhotoManager';
import { photoEntry } from '../../utils/photoEntry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One labelled input. Errors are tied to the input so screen readers read them out.
function Field({ name, label, form, errors, onChange, hint, prefix, className, multiline = false, ...props }) {
  const id = `book-${name}`;
  const error = errors[name];
  const control = multiline ? (
    <textarea id={id} name={name} className="textarea" value={form[name]} onChange={onChange} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...props} />
  ) : (
    <input id={id} name={name} className="input" value={form[name]} onChange={onChange} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...props} />
  );
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {prefix ? (
        <div className="ap-input-prefix">
          <span aria-hidden="true">{prefix}</span>
          {control}
        </div>
      ) : (
        control
      )}
      {hint}
      {error && (
        <p id={`${id}-error`} className="ap-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Editor({ book, categories }) {
  const isNew = !book;
  const navigate = useNavigate();
  const { show } = useToast();
  const [form, setForm] = useState(() => (book ? toBookForm(book) : emptyBookForm()));
  const [photos, setPhotos] = useState(() => (book?.image_urls ?? []).map(photoEntry));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);
  const busy = useRef(false);
  // What is in the database now (the form starts out equal to it).
  const [saved, setSaved] = useState(() => ({ form, urls: book?.image_urls ?? [] }));
  const savedUrls = useRef(saved.urls);
  const sessionUploads = useRef(new Set());

  const urls = photos.filter((p) => !p.uploading && p.url).map((p) => p.url);
  const dirty = JSON.stringify([form, urls]) !== JSON.stringify([saved.form, saved.urls]);
  const discount = discountOf(form);
  const categoryOptions = useMemo(() => [...new Set([...CATEGORIES, ...categories, ...(form.category ? [form.category] : [])])], [categories, form.category]);

  // Photos uploaded here but never saved to a book are removed from Hostinger again
  // when the editor closes, so they do not take up space.
  useEffect(() => {
    const uploads = sessionUploads.current;
    const saved = savedUrls;
    return () => {
      const unused = [...uploads].filter((url) => !saved.current.includes(url));
      if (unused.length > 0) deletePhotos(unused);
    };
  }, []);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onUploaded = useCallback((url) => sessionUploads.current.add(url), []);

  function change(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function save(event) {
    event?.preventDefault();
    if (busy.current || (!dirty && !isNew)) return;
    if (photosBusy) {
      setFailure('Wait for the photos to finish uploading, then save.');
      return;
    }
    const result = validateBookForm(form, { otherAttributes: otherAttributesOf(book) });
    if (result.errors) {
      setErrors(result.errors);
      setFailure('Some details need fixing. They are marked in red.');
      const first = Object.keys(result.errors)[0];
      if (['length_cm', 'breadth_cm', 'height_cm', 'weight_kg', 'return_policy', 'pickup_address_code', 'ideal_for', 'pack_of', 'country_of_origin'].includes(first)) {
        document.getElementById('more-details')?.setAttribute('open', '');
      }
      document.getElementById(`book-${first}`)?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setFailure(null);
    setErrors({});
    const fields = { ...result.fields, image_urls: urls };
    try {
      const saved = isNew ? await adminCreateBook(fields, result.internal) : await adminSaveBook(book.id, fields, result.internal);
      const removed = savedUrls.current.filter((url) => !urls.includes(url) && isStoredPhoto(url));
      savedUrls.current = urls;
      setSaved({ form, urls });
      // Photos taken off this book are deleted from Hostinger unless another book uses them.
      for (const url of removed) {
        photoUsedElsewhere(url, saved.id)
          .then((used) => !used && deletePhotos([url]))
          .catch(() => {});
      }
      if (isNew) {
        show({ message: `Added “${saved.title}”` });
        navigate(`/admin/books/${saved.id}`, { replace: true });
      } else {
        show({ message: 'Changes saved' });
        busy.current = false;
        setSaving(false);
      }
    } catch (err) {
      if (err?.code !== '23505') console.error('[BookEditor] save failed', err?.details ?? err);
      busy.current = false;
      setSaving(false);
      setFailure(adminErrorMessage(err));
      if (err?.code === '23505') setErrors({ sku: 'This SKU or product code is already used by another book.' });
    }
  }

  function discard() {
    if (isNew) {
      navigate('/admin/books');
      return;
    }
    setForm(saved.form);
    setPhotos(saved.urls.map(photoEntry));
    setErrors({});
    setFailure(null);
  }

  const field = { form, errors, onChange: change };

  return (
    <form onSubmit={save} noValidate>
      <PageHead title={isNew ? 'Add book' : 'Edit book'} back="/admin/books" backLabel="Back to books">
        {!isNew && book.is_visible && (
          <a className="btn btn-outline" href={`${LIVE_ORIGIN}/books/${book.id}`} target="_blank" rel="noopener noreferrer">
            <ArrowSquareOut size={18} aria-hidden="true" />
            View in store
          </a>
        )}
      </PageHead>

      <div className="ap-editor">
        <div>
          <section className="ap-card" aria-labelledby="photos-heading">
            <div className="ap-card-head">
              <h2 id="photos-heading" className="ap-card-title">
                Photos
              </h2>
              <span className="page-meta">The first photo is the cover</span>
            </div>
            <div className="ap-card-body">
              <PhotoManager photos={photos} onChange={setPhotos} onUploaded={onUploaded} onBusyChange={setPhotosBusy} />
            </div>
          </section>

          <section className="ap-card" aria-labelledby="details-heading">
            <div className="ap-card-head">
              <h2 id="details-heading" className="ap-card-title">
                Book details
              </h2>
            </div>
            <div className="ap-card-body ap-fields">
              <Field name="title" label="Book name" className="ap-span-all" maxLength={300} placeholder="For example Godan by Munshi Premchand" required {...field} />
              <Field name="author" label="Author" maxLength={100} {...field} />
              <Field name="brand" label="Publisher" maxLength={100} {...field} />
              <div>
                <label className="label" htmlFor="book-category">
                  Category
                </label>
                <select id="book-category" name="category" className="select" value={form.category} onChange={change}>
                  <option value="">No category</option>
                  {categoryOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <Field name="genre" label="Genre" maxLength={100} {...field} />
              <Field
                name="description"
                label="Description"
                className="ap-span-all"
                multiline
                maxLength={5000}
                rows={8}
                placeholder="What the book is about, the language, the edition…"
                hint={<p className="ap-counter">{form.description.length.toLocaleString('en-IN')} / 5,000</p>}
                {...field}
              />
            </div>
          </section>

          <section className="ap-card" aria-labelledby="price-heading">
            <div className="ap-card-head">
              <h2 id="price-heading" className="ap-card-title">
                Price
              </h2>
            </div>
            <div className="ap-card-body">
              <div className="ap-fields ap-fields-3">
                <Field name="price" label="Selling price" prefix="₹" inputMode="decimal" required {...field} />
                <Field name="mrp" label="MRP" prefix="₹" inputMode="decimal" required {...field} />
                <Field name="gst_percent" label="GST %" inputMode="decimal" placeholder="0" {...field} />
              </div>
              {discount > 0 && <p className="ap-discount">Customers save {discount}%</p>}
            </div>
          </section>

          <section className="ap-card" aria-labelledby="stock-heading">
            <div className="ap-card-head">
              <h2 id="stock-heading" className="ap-card-title">
                Stock and codes
              </h2>
            </div>
            <div className="ap-card-body ap-fields ap-fields-3">
              <Field name="stock_quantity" label="Copies in stock" inputMode="numeric" required {...field} />
              <Field name="sku" label="SKU" maxLength={64} required {...field} />
              <Field name="product_code" label="Product code" maxLength={64} placeholder={form.sku ? `Same as SKU` : ''} {...field} />
            </div>
          </section>

          <details className="ap-card ap-more" id="more-details">
            <summary>
              More details
              <CaretDown size={20} aria-hidden="true" />
            </summary>
            <div className="ap-card-body ap-fields">
              <Field name="cost_price" label="Cost price (only admins see this)" prefix="₹" inputMode="decimal" {...field} />
              <Field name="return_policy" label="Return or exchange window (days)" inputMode="numeric" {...field} />
              <Field name="ideal_for" label="Ideal for" maxLength={100} {...field} />
              <Field name="pack_of" label="Pack of" maxLength={100} {...field} />
              <Field name="country_of_origin" label="Country of origin" maxLength={100} {...field} />
              <Field name="pickup_address_code" label="Pickup address code" maxLength={64} {...field} />
              <div className="ap-span-all ap-fields ap-fields-4">
                <Field name="length_cm" label="Package length (cm)" inputMode="decimal" {...field} />
                <Field name="breadth_cm" label="Package breadth (cm)" inputMode="decimal" {...field} />
                <Field name="height_cm" label="Package height (cm)" inputMode="decimal" {...field} />
                <Field name="weight_kg" label="Package weight (kg)" inputMode="decimal" {...field} />
              </div>
            </div>
          </details>
        </div>

        <aside className="ap-editor-side">
          <section className="ap-card" aria-labelledby="status-heading">
            <div className="ap-card-head">
              <h2 id="status-heading" className="ap-card-title">
                In the store
              </h2>
            </div>
            <div className="ap-card-body stack-sm">
              <label className="ap-toggle" htmlFor="book-is_visible">
                <input id="book-is_visible" name="is_visible" type="checkbox" checked={form.is_visible} onChange={change} />
                <span className="ap-toggle-track" aria-hidden="true" />
                {form.is_visible ? 'Shown in the store' : 'Hidden from the store'}
              </label>
              {!isNew && (
                <dl className="ap-meta-list">
                  <div>
                    <dt>Photos</dt>
                    <dd>{urls.length}</dd>
                  </div>
                  <div>
                    <dt>Last changed</dt>
                    <dd>{new Date(book.updated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
                  </div>
                </dl>
              )}
            </div>
          </section>
        </aside>
      </div>

      <div className="ap-savebar" role="region" aria-label="Save">
        <p>{saving ? 'Saving…' : photosBusy ? 'Uploading photos…' : dirty ? 'You have unsaved changes' : isNew ? 'New book' : 'All changes saved'}</p>
        <div className="ap-savebar-actions">
          <button type="button" className="btn btn-outline" onClick={discard} aria-disabled={saving || (!dirty && !isNew) || undefined} disabled={saving || (!dirty && !isNew)}>
            {isNew ? 'Cancel' : 'Discard changes'}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={saving} aria-disabled={saving || (!dirty && !isNew) || undefined}>
            {saving && <span className="spinner" aria-hidden="true" />}
            {isNew ? 'Add book' : 'Save changes'}
          </button>
        </div>
        {failure && (
          <p className="notice" data-tone="error" role="alert" style={{ flexBasis: '100%' }}>
            {failure}
          </p>
        )}
      </div>
    </form>
  );
}

function BookEditor() {
  const { id } = useParams();
  const isNew = id === undefined;
  useDocumentTitle(isNew ? 'Add book' : 'Edit book');
  const book = useAsync(() => (isNew || !UUID.test(id) ? Promise.resolve(null) : adminGetBook(id)), [id]);
  const categories = useAsync(() => adminListCategories(), []);

  if (book.loading || categories.loading) return <LinesSkeleton count={6} label="Loading the book…" />;
  if (book.error) return <LoadError onRetry={book.retry} what="this book" />;
  if (!isNew && !book.data) {
    return (
      <StateBlock title="This book could not be found.">
        <Link to="/admin/books" className="btn btn-primary">
          Back to books
        </Link>
      </StateBlock>
    );
  }
  // key: a different book (or a fresh "Add book") starts a fresh form.
  return <Editor key={book.data?.id ?? 'new'} book={book.data} categories={categories.data ?? []} />;
}

export default BookEditor;
