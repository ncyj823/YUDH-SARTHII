import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import { Shield, Lock, User, AlertCircle } from 'lucide-react';
import { cn } from './lib/utils';
import { validateAadhar, validatePAN, validateOTP, validateSecurityKey, validateAuthorityID } from './lib/validation';
import { auth, db } from './lib/firebase';
import { 
  signInWithPhoneNumber, 
  RecaptchaVerifier, 
  ConfirmationResult,
  signInWithEmailAndPassword,
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useRef } from 'react';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<'citizen' | 'authority'>('citizen');
  const [authMode, setAuthMode] = useState<'citizen' | 'authority'>('citizen');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [idValue, setIdValue] = useState('');
  const [securityValue, setSecurityValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Phone Auth States
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loginStep, setLoginStep] = useState<'phone' | 'otp'>('phone');
  const [resendTimer, setResendTimer] = useState(0);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists() && userDoc.data().role === 'authority') {
            setUserRole('authority');
          } else {
            setUserRole('citizen');
          }
        } catch (err) {
          console.error("Error fetching user role:", err);
          setUserRole('citizen');
        }
      }
      setUser(currentUser);
      setIsLoading(false);
    });
    return () => {
      unsubscribe();
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleModeChange = (mode: 'citizen' | 'authority') => {
    setAuthMode(mode);
    setError(null);
    setIdValue('');
    setSecurityValue('');
    setPhoneNumber('');
    setOtp(['', '', '', '', '', '']);
    setConfirmationResult(null);
    setLoginStep('phone');
  };

  const setupRecaptcha = () => {
    if (!recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }
    return recaptchaVerifierRef.current;
  };

  const handlePhoneSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!/^[6-9]\d{9}$/.test(phoneNumber)) {
      setError('Please enter a valid 10-digit mobile number starting with 6-9.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const verifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, '+91' + phoneNumber, verifier);
      setConfirmationResult(result);
      setLoginStep('otp');
      setResendTimer(30);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to send OTP. Please try again.');
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter the 6-digit OTP.');
      return;
    }

    setIsLoggingIn(true);
    try {
      if (confirmationResult) {
        await confirmationResult.confirm(otpCode);
      }
    } catch (err: any) {
      console.error(err);
      setError('Invalid OTP. Please try again.');
      setOtp(['', '', '', '', '', '']);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    setError(null);
    setIsLoggingIn(true);
    try {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      const verifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, '+91' + phoneNumber, verifier);
      setConfirmationResult(result);
      setResendTimer(30);
    } catch (err: any) {
      console.error(err);
      setError('Failed to resend OTP.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const pasted = value.slice(0, 6).split('');
      const newOtp = [...otp];
      pasted.forEach((char, i) => {
        if (i < 6) newOtp[i] = char;
      });
      setOtp(newOtp);
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto focus next
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoggingIn(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, idValue, securityValue);
      const loggedInUser = userCredential.user;

      if (authMode === 'authority') {
        const userDoc = await getDoc(doc(db, 'users', loggedInUser.uid));
        if (!userDoc.exists() || userDoc.data().role !== 'authority') {
          await signOut(auth);
          setError('Unauthorized: Not an authority account.');
          setIsLoggingIn(false);
          return;
        }
      }
    } catch (err: any) {
      console.error(err);
      let message = 'Login failed. Please check your credentials.';
      if (err.code === 'auth/user-not-found') message = 'User not found.';
      else if (err.code === 'auth/wrong-password') message = 'Incorrect password.';
      else if (err.code === 'auth/invalid-email') message = 'Invalid email format.';
      setError(message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (!auth) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-sans text-center space-y-6">
        <div className="inline-flex p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl shadow-2xl shadow-amber-500/10">
          <AlertCircle className="w-12 h-12 text-amber-500" />
        </div>
        <div className="space-y-2 max-w-md">
          <h1 className="text-2xl font-black tracking-tighter uppercase leading-none text-amber-500">
            Firebase Not Configured
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Your application's backend is not yet connected. Please use the <strong>Firebase Setup</strong> tool in the AI Studio Build settings to provision your database and authentication.
          </p>
        </div>
        <div className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest bg-white/5 px-4 py-2 rounded-lg border border-white/5">
          Error: auth/invalid-api-key
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    return <Dashboard userRole={userRole} onLogout={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Logo Section */}
        <div className="text-center space-y-4">
          <div className="inline-flex p-4 bg-red-600 rounded-2xl shadow-2xl shadow-red-600/20 mb-2">
            <Shield className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">
            Rapid Crisis<br />Response
          </h1>
          <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest">
            Emergency Management System
          </p>
        </div>

        {/* Login Card */}
          <div className="bg-[#141414] p-8 rounded-3xl border border-white/10 shadow-2xl space-y-6">
            {/* Mode Selector */}
            <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
              <button 
                onClick={() => handleModeChange('citizen')}
                className={cn(
                  "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                  authMode === 'citizen' ? "bg-white/10 text-white shadow-inner" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Citizen
              </button>
              <button 
                onClick={() => handleModeChange('authority')}
                className={cn(
                  "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                  authMode === 'authority' ? "bg-white/10 text-white shadow-inner" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Authority
              </button>
            </div>

            {authMode === 'citizen' ? (
              loginStep === 'phone' ? (
                <form onSubmit={handlePhoneSignIn} className="space-y-4">
                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-500 text-xs animate-in slide-in-from-top-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">
                      Mobile Number
                    </label>
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-zinc-500 group-focus-within:text-red-500 transition-colors">
                        <span className="text-sm font-bold">🇮🇳 +91</span>
                      </div>
                      <input 
                        type="tel" 
                        required
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="XXXXXXXXXX"
                        className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-20 pr-4 text-sm focus:outline-none focus:border-red-500/50 focus:ring-4 focus:ring-red-500/10 transition-all font-mono"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isLoggingIn || phoneNumber.length !== 10}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-zinc-800 text-white font-bold py-4 rounded-xl transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-2 group"
                  >
                    {isLoggingIn ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="uppercase tracking-widest text-sm">Send OTP</span>
                        <Shield className="w-4 h-4 group-hover:scale-110 transition-transform" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-6">
                  <div className="text-center space-y-1">
                    <p className="text-xs text-zinc-400">OTP sent to <span className="text-white font-bold">+91 {phoneNumber}</span></p>
                    <button 
                      type="button"
                      onClick={() => setLoginStep('phone')}
                      className="text-[10px] font-bold text-red-500 uppercase tracking-widest hover:text-red-400 transition-colors"
                    >
                      ← Change Number
                    </button>
                  </div>

                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-500 text-xs animate-in slide-in-from-top-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-2">
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        id={`otp-${idx}`}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        className="w-12 h-14 bg-black/40 border border-white/10 rounded-xl text-center text-xl font-bold focus:outline-none focus:border-red-500/50 focus:ring-4 focus:ring-red-500/10 transition-all font-mono"
                      />
                    ))}
                  </div>

                  <div className="space-y-4">
                    <button 
                      type="submit" 
                      disabled={isLoggingIn || otp.join('').length !== 6}
                      className="w-full bg-red-600 hover:bg-red-700 disabled:bg-zinc-800 text-white font-bold py-4 rounded-xl transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-2 group"
                    >
                      {isLoggingIn ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <span className="uppercase tracking-widest text-sm">Verify OTP</span>
                          <Shield className="w-4 h-4 group-hover:scale-110 transition-transform" />
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={resendTimer > 0 || isLoggingIn}
                      onClick={handleResendOtp}
                      className="w-full text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 disabled:text-zinc-700 transition-colors"
                    >
                      {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
                    </button>
                  </div>
                </form>
              )
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-500 text-xs animate-in slide-in-from-top-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">
                    Authority ID
                  </label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-red-500 transition-colors" />
                    <input 
                      type="text" 
                      required
                      value={idValue}
                      onChange={(e) => setIdValue(e.target.value)}
                      placeholder="authority@example.com"
                      className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:border-red-500/50 focus:ring-4 focus:ring-red-500/10 transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">
                    Security Key
                  </label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-red-500 transition-colors" />
                    <input 
                      type="password" 
                      required
                      value={securityValue}
                      onChange={(e) => setSecurityValue(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:border-red-500/50 focus:ring-4 focus:ring-red-500/10 transition-all font-mono"
                    />
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={isLoggingIn}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:bg-zinc-800 text-white font-bold py-4 rounded-xl transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-2 group"
                >
                  {isLoggingIn ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="uppercase tracking-widest text-sm">Secure Access</span>
                      <Shield className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            )}

            <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-[10px] text-amber-200/70 leading-relaxed font-medium">
                By logging in, you agree to emergency data sharing protocols. Your location will be tracked for safety purposes.
              </p>
            </div>
          </div>

        {/* Footer Info */}
        <div className="text-center space-y-2">
          <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
            End-to-End Encrypted • Low Bandwidth Optimized
          </p>
          <div className="flex justify-center gap-4 text-[9px] text-zinc-700 font-bold uppercase">
            <a href="#" className="hover:text-zinc-500 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-zinc-500 transition-colors">Emergency Terms</a>
            <a href="#" className="hover:text-zinc-500 transition-colors">Contact Support</a>
          </div>
        </div>
      </div>
      <div id="recaptcha-container"></div>
    </div>
  );
}
