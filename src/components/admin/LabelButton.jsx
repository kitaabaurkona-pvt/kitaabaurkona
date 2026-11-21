import { useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import { carrierOf, getLabel } from '../../services/shippingService';
import { useToast } from '../../hooks/useToast';

// "Label" in the orders table: Xpressbees labels are a saved link; Delhivery makes its
// label on request, so the tab is opened at the click (not blocked as a pop-up) and
// pointed at the label once the link arrives. onOpened runs once the label is open
// (Process orders moves the order from Print to Pack).
function LabelButton({ order, shipment, primary = true, onOpened }) {
  const [working, setWorking] = useState(false);
  const { show } = useToast();
  const className = `btn ${primary ? 'btn-dark' : 'btn-outline'} btn-sm`;

  if (carrierOf(shipment) !== 'delhivery') {
    return (
      <a className={className} href={shipment.label_url} target="_blank" rel="noopener noreferrer" onClick={() => onOpened?.()}>
        <Printer size={16} aria-hidden="true" />
        Label
      </a>
    );
  }

  async function open() {
    if (working) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setWorking(true);
    try {
      const { url } = await getLabel(order.id, 'forward');
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      onOpened?.();
    } catch (err) {
      tab?.close();
      show({ message: err.message, tone: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <button type="button" className={className} aria-busy={working} onClick={open}>
      {working ? <span className="spinner" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
      Label
    </button>
  );
}

export default LabelButton;
