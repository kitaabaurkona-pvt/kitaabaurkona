import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { StateBlock } from '../components/store/States';
import { TagIcon } from '../components/icons';

function Offers() {
  useDocumentTitle('Offers');
  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Offers</h1>
      </div>
      <StateBlock title="There are no offers right now." icon={TagIcon}>
        <Link to="/books" className="btn btn-dark">
          Browse books
        </Link>
      </StateBlock>
    </div>
  );
}

export default Offers;
