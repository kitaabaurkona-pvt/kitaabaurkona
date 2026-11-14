import { Component } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { StateBlock } from './store/States';

// Without this, any error while a page is being drawn (or a page file that cannot be
// loaded) removes everything from the screen and leaves it blank until a refresh. The
// error is caught here instead and a short message with a Reload button is shown in
// place of the page. In the store layout it sits inside the part that is redrawn for
// every page, so moving to another page clears it: one broken page never blocks the
// rest of the site.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV) console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="container page">
        <StateBlock title="This page could not be shown." description="Reload the page to try again." icon={WarningCircle} tone="error">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <ArrowClockwise size={18} aria-hidden="true" /> Reload page
          </button>
        </StateBlock>
      </div>
    );
  }
}

export default ErrorBoundary;
