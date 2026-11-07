import { Link } from 'react-router-dom';
import { getAdminStats } from '../../services/adminService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { formatCount } from '../../utils/format';
import { LoadError } from '../../components/store/States';
import { StatsSkeleton } from '../../components/store/Skeletons';

function Stat({ to, value, label }) {
  return (
    <Link to={to} className="stat">
      <span className="stat-value">{formatCount(value)}</span>
      <span className="stat-label">{label}</span>
    </Link>
  );
}

function AdminDashboard() {
  useDocumentTitle('Admin');
  const { data: s, loading, error, retry } = useAsync(() => getAdminStats(), []);

  if (loading) return <div className="stack"><StatsSkeleton /><StatsSkeleton /></div>;
  if (error) return <LoadError onRetry={retry} what="the dashboard" />;

  return (
    <div className="stack">
      <section className="stack-sm" aria-labelledby="catalogue-heading">
        <div className="section-head">
          <h2 id="catalogue-heading" className="section-title">
            Catalogue
          </h2>
          <Link to="/admin/bulk-upload" className="section-link">
            Bulk upload
          </Link>
        </div>
        <div className="stat-grid">
          <Stat to="/admin/books" value={s.books} label="Books" />
          <Stat to="/admin/books?filter=hidden" value={s.hidden} label="Hidden" />
          <Stat to="/admin/books?filter=out" value={s.outOfStock} label="Out of stock" />
          <Stat to="/admin/books?filter=low" value={s.lowStock} label="Low stock (1-5)" />
        </div>
      </section>
      <section className="stack-sm" aria-labelledby="orders-heading">
        <div className="section-head">
          <h2 id="orders-heading" className="section-title">
            Orders
          </h2>
          <Link to="/admin/orders" className="section-link">
            All orders
          </Link>
        </div>
        <div className="stat-grid">
          <Stat to="/admin/orders?status=pending_payment" value={s.pending} label="Awaiting payment" />
          <Stat to="/admin/orders?status=paid" value={s.paid} label="Paid, to ship" />
          <Stat to="/admin/orders?status=shipped" value={s.shipped} label="Shipped" />
          <Stat to="/admin/orders?status=delivered" value={s.delivered} label="Delivered" />
        </div>
      </section>
    </div>
  );
}

export default AdminDashboard;
