import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Compass, AlertCircle } from 'lucide-react';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleOAuthTokens } = useAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      setTimeout(() => {
        navigate(`/login?error=${encodeURIComponent(errorParam)}`);
      }, 2500);
      return;
    }

    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');

    if (!accessToken || !refreshToken) {
      setError('Missing authentication tokens from OAuth provider.');
      setTimeout(() => {
        navigate('/login?error=missing_oauth_tokens');
      }, 2500);
      return;
    }

    handleOAuthTokens({ accessToken, refreshToken })
      .then((user) => {
        if (user?.role === 'CANDIDATE') {
          navigate('/candidate', { replace: true });
        } else if (user?.role === 'INTERVIEWER') {
          navigate('/interviewer', { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      })
      .catch((err) => {
        console.error('Failed to complete OAuth sign in:', err);
        setError(err.message || 'Failed to complete Google authentication');
        setTimeout(() => {
          navigate(`/login?error=${encodeURIComponent(err.message || 'oauth_failed')}`);
        }, 2500);
      });
  }, [searchParams, handleOAuthTokens, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#ebf3fa] via-[#e4eef8] to-[#d8e6f5] flex items-center justify-center p-4">
      <div className="bg-white/95 backdrop-blur-xl border border-sky-100 rounded-3xl p-8 max-w-md w-full text-center shadow-xl shadow-slate-200/50">
        {error ? (
          <div className="animate-fade-in">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Authentication Error</h2>
            <p className="text-xs text-rose-600 font-medium mb-4">{error}</p>
            <p className="text-[11px] text-slate-400">Redirecting you back to login...</p>
          </div>
        ) : (
          <div>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-sky-500 text-white flex items-center justify-center mx-auto mb-4 shadow-md shadow-brand-500/25">
              <Compass className="h-6 w-6 animate-spin" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Completing Google Authentication
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Synchronizing session credentials and provisioning your workspace role...
            </p>
            <div className="h-1.5 w-32 bg-sky-100 rounded-full mx-auto overflow-hidden">
              <div className="h-full bg-brand-600 rounded-full animate-pulse" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
