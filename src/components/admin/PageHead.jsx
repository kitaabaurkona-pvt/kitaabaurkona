import { Link } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';

// The heading of an admin page, with an optional way back and the page's main actions.
function PageHead({ title, back, backLabel = 'Back', children }) {
  return (
    <div className="ap-head">
      <div className="ap-head-main">
        {back && (
          <Link to={back} className="ap-back" aria-label={backLabel}>
            <ArrowLeft size={20} aria-hidden="true" />
          </Link>
        )}
        <h1 className="ap-title">{title}</h1>
      </div>
      {children && <div className="ap-head-actions">{children}</div>}
    </div>
  );
}

export default PageHead;
