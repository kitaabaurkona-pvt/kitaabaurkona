import { PhoneField, SubmitButton, TextField } from './fields';
import { OTP_LENGTH, useMobileOtp } from '../../hooks/useMobileOtp';
import { signInWithKpToken } from '../../services/kwikpassService';
import { rememberLoginPhone } from '../../utils/loginPhone';

// Log in with a mobile number: GoKwik's KwikPass sends a 4-digit OTP and checks it, then
// the kwikpass Edge Function signs the customer in (making an account the first time).
// The page that shows this form moves on by itself once the session starts.
export default function MobileOtpForm() {
  const otp = useMobileOtp({
    onVerified: async (kpToken, phone) => {
      // Remembered first: the session starting moves the page on straight away.
      rememberLoginPhone(phone);
      await signInWithKpToken(kpToken);
    },
  });
  const { otpRef } = otp;
  const formError = otp.formError && (
    <p className="auth-error" role="alert">
      {otp.formError}
    </p>
  );

  if (otp.step === 'phone') {
    return (
      <form className="auth-form" onSubmit={otp.submitPhone} noValidate>
        <PhoneField
          id={otp.phoneId}
          label="Mobile number"
          prefix="+91"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="10-digit mobile number"
          required
          value={otp.phone}
          onChange={(event) => otp.setPhone(event.target.value)}
          error={otp.fieldError(otp.phoneId)}
        />
        {formError}
        <SubmitButton busy={otp.busy} idleLabel="Send OTP" busyLabel="Sending OTP…" />
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={otp.submitOtp} noValidate>
      <div className="otp-sent">
        <span>
          OTP sent to <strong>+91 {otp.phone}</strong>
        </span>
        <button type="button" className="field-link" onClick={otp.changeNumber}>
          Change
        </button>
      </div>
      <TextField
        ref={otpRef}
        id={otp.otpId}
        label="OTP"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        placeholder={`${OTP_LENGTH}-digit OTP`}
        required
        value={otp.otp}
        onChange={(event) => otp.setOtp(event.target.value)}
        error={otp.fieldError(otp.otpId)}
      />
      {formError}
      <SubmitButton busy={otp.busy} idleLabel="Verify and log in" busyLabel="Logging in…" />
      <button type="button" className="btn-secondary" onClick={otp.resend} aria-disabled={otp.busy || otp.wait > 0 || undefined}>
        {otp.wait > 0 ? `Resend OTP in ${otp.wait}s` : 'Resend OTP'}
      </button>
    </form>
  );
}
