import { Link } from 'react-router-dom';
import { Plus, Receipt, Truck, UploadSimple } from '@phosphor-icons/react';
import { getAdminStats } from '../../services/adminService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { formatCount } from '../../utils/format';
import { LoadError } from '../../components/store/States';
import { StatsSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';

// A number that needs action is highlighted when it is above zero.
function Stat({ to, value, label, attention = false }) {
  return (
    <Link to={to} className="ap-stat" data-tone={attention && value > 0 ? 'warn' : undefined}>
      <span className="ap-stat-value">{formatCount(value)}</span>
      <span className="ap-stat-label">{label}</span>
    </Link>
  );
}

function Section({ id, title, link, linkLabel, children }) {
  return (
    <section className="ap-card" aria-labelledby={id}>
      <div className="ap-card-head">
        <h2 id={id} className="ap-card-title">
          {title}
        </h2>
        {link && (
          <Link to={link} className="ap-card-link">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function AdminDashboard() {
  useDocumentTitle('Admin');
  const { data: s, loading, error, retry } = useAsync(() => getAdminStats(), []);

  return (
    <>
      <PageHead title="Home">
        <Link to="/admin/books/new" className="btn btn-primary">
          <Plus size={18} weight="bold" aria-hidden="true" />
          Add book
        </Link>
      </PageHead>

      {loading && (
        <div className="stack">
          <StatsSkeleton />
          <StatsSkeleton />
        </div>
      )}
      {error && <LoadError onRetry={retry} what="the dashboard" />}
      {s && (
        <>
          <Section id="orders-heading" title="Orders" link="/admin/orders/track" linkLabel="See all orders">
            <div className="ap-stats">
              <Stat to="/admin/orders?stage=all&pay=cod" value={s.confirmed} label="Cash on delivery, to ship" attention />
              <Stat to="/admin/orders?stage=all&pay=online" value={s.paid} label="Paid, to ship" attention />
              <Stat to="/admin/orders?tab=pending" value={s.pending} label="Awaiting payment" />
              <Stat to="/admin/orders/track?tab=shipped" value={s.shipped} label="Shipped" />
              <Stat to="/admin/orders/track?tab=delivered" value={s.delivered} label="Delivered" />
              <Stat to="/admin/shipping" value={s.problems} label="Parcels needing attention" attention />
            </div>
          </Section>
          <Section id="catalogue-heading" title="Books" link="/admin/books" linkLabel="See all books">
            <div className="ap-stats">
              <Stat to="/admin/books" value={s.books} label="Books in the catalogue" />
              <Stat to="/admin/books?filter=out" value={s.outOfStock} label="Out of stock" attention />
              <Stat to="/admin/books?filter=low" value={s.lowStock} label="Low stock (1 to 5 left)" attention />
              <Stat to="/admin/books?filter=hidden" value={s.hidden} label="Hidden from the store" />
              <Stat to="/admin/books?filter=nophoto" value={s.noPhoto} label="Without a photo" attention />
            </div>
          </Section>
          <Section id="quick-heading" title="Quick actions">
            <div className="ap-quick">
              <Link to="/admin/books/new">
                <Plus size={22} aria-hidden="true" />
                Add a book
              </Link>
              <Link to="/admin/bulk-upload">
                <UploadSimple size={22} aria-hidden="true" />
                Upload many books at once
              </Link>
              <Link to="/admin/orders">
                <Receipt size={22} aria-hidden="true" />
                See orders
              </Link>
              <Link to="/admin/shipping">
                <Truck size={22} aria-hidden="true" />
                Shipping settings
              </Link>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

export default AdminDashboard;
