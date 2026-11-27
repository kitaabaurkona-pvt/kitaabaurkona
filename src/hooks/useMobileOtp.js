import { useEffect, useRef, useState } from 'react';
import { RESEND_COOLDOWN_SECONDS } from '../utils/authForm';
import { sendLoginOtp, verifyLoginOtp } from '../services/kwikpassService';

const PHONE = /^[6-9][0-9]{9}$/;
export const OTP_LENGTH = 4;

// The steps of a GoKwik KwikPass OTP: number -> OTP -> GoKwik's sealed token, handed to
// onVerified(kpToken), which logs in (sign-in page) or links the number (My Account).
// onVerified may throw an Error whose message is shown. Field ids: `${idPrefix}mobile`
// and `${idPrefix}otp`.
export function useMobileOtp({ onVerified, initialPhone = '', idPrefix = '' }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhoneValue] = useState(PHONE.test(initialPhone) ? initialPhone : '');
  const [otp, setOtpValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const otpRef = useRef(null);
  const phoneId = `${idPrefix}mobile`;
  const otpId = `${idPrefix}otp`;

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

  async function submitPhone(event) {
    event?.preventDefault();
    if (busy) return;
    if (!PHONE.test(phone)) {
      setError({ field: phoneId, message: 'Enter a valid 10-digit mobile number.' });
      document.getElementById(phoneId)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (await sendOtp()) {
        setOtpValue('');
        setStep('otp');
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || wait > 0) return;
    setError(null);
    setBusy(true);
    try {
      await sendOtp();
    } finally {
      setBusy(false);
    }
  }

  // Stays busy after success: the caller moves on (a new page, or a new state).
  async function submitOtp(event) {
    event?.preventDefault();
    if (busy) return;
    if (otp.length !== OTP_LENGTH) {
      setError({ field: otpId, message: `Enter the ${OTP_LENGTH}-digit OTP.` });
      otpRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await verifyLoginOtp(phone, otp);
      if (!result.ok) {
        setError({ field: otpId, message: result.message });
        setBusy(false);
        return;
      }
      await onVerified(result.kpToken, phone);
    } catch (err) {
      setError({ field: null, message: err.message });
      setBusy(false);
    }
  }

  function changeNumber() {
    setStep('phone');
    setOtpValue('');
    setError(null);
  }

  return {
    step,
    phone,
    otp,
    busy,
    wait,
    otpRef,
    phoneId,
    otpId,
    formError: error && !error.field ? error.message : null,
    fieldError: (field) => (error?.field === field ? error.message : undefined),
    setPhone: (value) => setPhoneValue(value.replace(/\D/g, '').slice(0, 10)),
    setOtp: (value) => setOtpValue(value.replace(/\D/g, '').slice(0, OTP_LENGTH)),
    submitPhone,
    submitOtp,
    resend,
    changeNumber,
  };
}
