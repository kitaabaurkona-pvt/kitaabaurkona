import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { StateBlock } from '../components/store/States';
import { SearchIcon } from '../components/icons';

function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Page not found</h1>
      </div>
      <StateBlock title="This page isn’t on the shelf." description="The link may have changed, or the address may be incomplete. Head back to the store to find your next read." icon={SearchIcon}>
        <Link to="/" className="btn btn-dark">
          Back to the store
        </Link>
      </StateBlock>
    </div>
  );
}

export default NotFound;
