'use client';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const supabase = createClient();

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center">
        <h1 className="font-mono text-4xl font-bold tracking-tight text-accent">
          CORTEX
        </h1>
        <p className="mt-2 font-sans text-sm text-text-muted">Brain OS</p>
        <button
          onClick={handleGoogleLogin}
          className="mt-8 w-full rounded-md border border-accent bg-transparent px-4 py-3 font-mono text-sm text-text-primary transition-colors hover:bg-accent/10 hover:text-accent"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
