import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { StateBlock } from '../components/store/States';

function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Page not found</h1>
      </div>
      <StateBlock title="There is no page at this address.">
        <Link to="/" className="btn btn-dark">
          Go to the store
        </Link>
      </StateBlock>
    </div>
  );
}

export default NotFound;
