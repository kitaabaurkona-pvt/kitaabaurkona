import { useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import { carrierOf, getLabel } from '../../services/shippingService';
import { useToast } from '../../hooks/useToast';

// "Label" in the orders table: Xpressbees labels are a saved link; Delhivery makes its
// label on request, so the tab is opened at the click (not blocked as a pop-up) and
// pointed at the label once the link arrives.
function LabelButton({ order, shipment }) {
  const [working, setWorking] = useState(false);
  const { show } = useToast();

  if (carrierOf(shipment) !== 'delhivery') {
    return (
      <a className="btn btn-dark btn-sm" href={shipment.label_url} target="_blank" rel="noopener noreferrer">
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
    } catch (err) {
      tab?.close();
      show({ message: err.message, tone: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <button type="button" className="btn btn-dark btn-sm" aria-busy={working} onClick={open}>
      {working ? <span className="spinner" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
      Label
    </button>
  );
}

export default LabelButton;
