import { useEffect, useRef, useState } from 'react';
import { PhoneField, SubmitButton, TextField } from './fields';
import { digitsOnly, RESEND_COOLDOWN_SECONDS } from '../../utils/authForm';
import { sendLoginOtp, signInWithKpToken, verifyLoginOtp } from '../../services/kwikpassService';

const PHONE = /^[6-9][0-9]{9}$/;
const OTP_LENGTH = 4;

// Log in with a mobile number: GoKwik's KwikPass sends a 4-digit OTP and checks it, then
// the kwikpass Edge Function signs the customer in (making an account the first time).
// The page that shows this form moves on by itself once the session starts.
export default function MobileOtpForm() {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const otpRef = useRef(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (step === 'otp') otpRef.current?.focus();
  }, [step]);

  async function sendOtp() {
    const result = await sendLoginOtp(phone);
    if (!result.ok) {
      setError({ field: null, message: result.message });
      return false;
    }
    setWait(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  async function handlePhone(event) {
    event.preventDefault();
    if (busy) return;
    if (!PHONE.test(phone)) {
      setError({ field: 'mobile', message: 'Enter a valid 10-digit mobile number.' });
      document.getElementById('mobile')?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (await sendOtp()) {
        setOtp('');
        setStep('otp');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (busy || wait > 0) return;
    setError(null);
    setBusy(true);
    try {
      await sendOtp();
    } finally {
      setBusy(false);
    }
  }

  async function handleOtp(event) {
    event.preventDefault();
    if (busy) return;
    if (otp.length !== OTP_LENGTH) {
      setError({ field: 'otp', message: `Enter the ${OTP_LENGTH}-digit OTP.` });
      otpRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await verifyLoginOtp(phone, otp);
      if (!result.ok) {
        setError({ field: 'otp', message: result.message });
        setBusy(false);
        return;
      }
      await signInWithKpToken(result.kpToken);
      // Stays busy: the sign-in page leaves as soon as the session arrives.
    } catch (err) {
      setError({ field: null, message: err.message });
      setBusy(false);
    }
  }

  function changeNumber() {
    setStep('phone');
    setOtp('');
    setError(null);
  }

  const fieldError = (field) => (error?.field === field ? error.message : undefined);
  const formError = error && !error.field && (
    <p className="auth-error" role="alert">
      {error.message}
    </p>
  );

  if (step === 'phone') {
    return (
      <form className="auth-form" onSubmit={handlePhone} noValidate>
        <PhoneField
          id="mobile"
          label="Mobile number"
          prefix="+91"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="10-digit mobile number"
          required
          value={phone}
          onChange={(event) => setPhone(digitsOnly(event.target.value, 10))}
          error={fieldError('mobile')}
        />
        {formError}
        <SubmitButton busy={busy} idleLabel="Send OTP" busyLabel="Sending OTP…" />
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleOtp} noValidate>
      <div className="otp-sent">
        <span>
          OTP sent to <strong>+91 {phone}</strong>
        </span>
        <button type="button" className="field-link" onClick={changeNumber}>
          Change
        </button>
      </div>
      <TextField
        ref={otpRef}
        id="otp"
        label="OTP"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        placeholder={`${OTP_LENGTH}-digit OTP`}
        required
        value={otp}
        onChange={(event) => setOtp(digitsOnly(event.target.value, OTP_LENGTH))}
        error={fieldError('otp')}
      />
      {formError}
      <SubmitButton busy={busy} idleLabel="Verify and log in" busyLabel="Logging in…" />
      <button type="button" className="btn-secondary" onClick={handleResend} aria-disabled={busy || wait > 0 || undefined}>
        {wait > 0 ? `Resend OTP in ${wait}s` : 'Resend OTP'}
      </button>
    </form>
  );
}
