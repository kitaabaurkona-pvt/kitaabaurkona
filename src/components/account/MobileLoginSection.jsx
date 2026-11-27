import { useState } from 'react';
import { OTP_LENGTH, useMobileOtp } from '../../hooks/useMobileOtp';
import { useAsync } from '../../hooks/useAsync';
import { getVerifiedPhone, linkWithKpToken } from '../../services/kwikpassService';

// My Account: log in with a mobile number too. A signed-in customer proves their number
// with an OTP from GoKwik's KwikPass and it joins this account (the number typed on the
// profile is never trusted for logging in until this is done).
function VerifyForm({ initialPhone, onDone, onCancel }) {
  const otp = useMobileOtp({
    idPrefix: 'link-',
    initialPhone,
    onVerified: async (kpToken) => onDone(await linkWithKpToken(kpToken)),
  });
  const { otpRef } = otp;
  const fieldMessage = (id) =>
    otp.fieldError(id) && (
      <p className="field-message" role="alert">
        {otp.fieldError(id)}
      </p>
    );
  const formError = otp.formError && (
    <p className="notice" data-tone="error" role="alert">
      {otp.formError}
    </p>
  );

  if (otp.step === 'phone') {
    return (
      <form className="panel stack-sm" onSubmit={otp.submitPhone} noValidate>
        <div>
          <label className="label" htmlFor={otp.phoneId}>Mobile number</label>
          <input id={otp.phoneId} className="input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="10-digit mobile number" value={otp.phone} onChange={(e) => otp.setPhone(e.target.value)} aria-invalid={otp.fieldError(otp.phoneId) ? 'true' : undefined} />
          {fieldMessage(otp.phoneId)}
        </div>
        {formError}
        <div className="inline-actions">
          <button type="submit" className="btn btn-primary" aria-busy={otp.busy} aria-disabled={otp.busy || undefined}>
            {otp.busy && <span className="spinner" aria-hidden="true" />}
            {otp.busy ? 'Sending OTP…' : 'Send OTP'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="panel stack-sm" onSubmit={otp.submitOtp} noValidate>
      <p className="mobile-otp-sent">
        OTP sent to <strong>+91 {otp.phone}</strong>{' '}
        <button type="button" className="btn-link" onClick={otp.changeNumber}>
          Change
        </button>
      </p>
      <div>
        <label className="label" htmlFor={otp.otpId}>OTP</label>
        <input ref={otpRef} id={otp.otpId} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_LENGTH} placeholder={`${OTP_LENGTH}-digit OTP`} value={otp.otp} onChange={(e) => otp.setOtp(e.target.value)} aria-invalid={otp.fieldError(otp.otpId) ? 'true' : undefined} />
        {fieldMessage(otp.otpId)}
      </div>
      {formError}
      <div className="inline-actions">
        <button type="submit" className="btn btn-primary" aria-busy={otp.busy} aria-disabled={otp.busy || undefined}>
          {otp.busy && <span className="spinner" aria-hidden="true" />}
          {otp.busy ? 'Verifying…' : 'Verify number'}
        </button>
        <button type="button" className="btn btn-outline" onClick={otp.resend} aria-disabled={otp.busy || otp.wait > 0 || undefined}>
          {otp.wait > 0 ? `Resend OTP in ${otp.wait}s` : 'Resend OTP'}
        </button>
        <button type="button" className="btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function MobileLoginSection({ profilePhone, onVerified }) {
  const verified = useAsync(() => getVerifiedPhone(), []);
  const [open, setOpen] = useState(false);

  if (verified.loading || verified.error) return null;
  const phone = verified.data;

  return (
    <section className="stack-sm" aria-labelledby="mobile-login-heading">
      <div className="section-head">
        <h2 id="mobile-login-heading" className="section-title">
          Mobile number login
        </h2>
      </div>
      {phone ? (
        <p className="mobile-login-state">
          +91 {phone} is verified. You can log in with it and an OTP.
        </p>
      ) : open ? (
        <VerifyForm
          initialPhone={profilePhone ?? ''}
          onCancel={() => setOpen(false)}
          onDone={(linked) => {
            verified.setData(linked);
            setOpen(false);
            onVerified?.(linked);
          }}
        />
      ) : (
        <div>
          <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
            Verify mobile number
          </button>
        </div>
      )}
    </section>
  );
}
