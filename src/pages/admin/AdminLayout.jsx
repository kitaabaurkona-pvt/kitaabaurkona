import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { LinesSkeleton } from '../../components/store/Skeletons';

// Keeps the menu on screen while the next section loads. Each page draws its own
// heading (components/admin/PageHead.jsx).
function AdminLayout() {
  return (
    <Suspense fallback={<LinesSkeleton />}>
      <Outlet />
    </Suspense>
  );
}

export default AdminLayout;
