import { Link } from 'react-router-dom';

// Centred UPPERCASE heading with an underlined VIEW ALL under it, as on the previous store.
function SectionHead({ id, title, href }) {
  return (
    <div className="home-head">
      <h2 id={id} className="home-title">
        {title}
      </h2>
      {href && (
        <Link to={href} className="view-all">
          View all
        </Link>
      )}
    </div>
  );
}

export default SectionHead;
