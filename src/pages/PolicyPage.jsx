import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { POLICIES } from '../content/policies';
import NotFound from './NotFound';

// About / Return / Shipping / Privacy pages, with the previous store's text.
function PolicyPage({ page }) {
  const policy = POLICIES[page];
  useDocumentTitle(policy?.title ?? 'Page not found');
  if (!policy) return <NotFound />;
  return (
    <div className="container page policy">
      <h1 className="page-title policy-title">{policy.title}</h1>
      {policy.blocks.map((block, index) => {
        if (block.h) return <h2 key={index}>{block.h}</h2>;
        if (block.ul)
          return (
            <ul key={index}>
              {block.ul.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        if (block.strong)
          return (
            <p key={index}>
              <strong>{block.strong}</strong>
            </p>
          );
        return <p key={index}>{block.p}</p>;
      })}
    </div>
  );
}

export default PolicyPage;
