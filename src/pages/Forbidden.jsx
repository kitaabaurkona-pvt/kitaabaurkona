import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { StateBlock } from '../components/store/States';

function Forbidden() {
  useDocumentTitle('No access');
  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">403: No access</h1>
      </div>
      <StateBlock title="You don't have permission to view this page.">
        <Link to="/" className="btn btn-dark">
          Go to the store
        </Link>
      </StateBlock>
    </div>
  );
}

export default Forbidden;
