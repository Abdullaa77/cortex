'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

interface SupabaseContext {
  supabase: SupabaseClient;
  session: Session | null;
  loading: boolean;
}

const Context = createContext<SupabaseContext | undefined>(undefined);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSession(session);
      setLoading(false);

      // Seed default areas on first login
      if (session?.user) {
        const { count } = await supabase
          .from('areas')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', session.user.id);

        if (count === 0) {
          await supabase.rpc('seed_default_areas', {
            p_user_id: session.user.id,
          });
        }

        // Seed default routines & habits on first login
        const { count: routineCount } = await supabase
          .from('routines')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', session.user.id);

        if (routineCount === 0) {
          await supabase.rpc('seed_default_routines', {
            p_user_id: session.user.id,
          });
        }
      }
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  return (
    <Context.Provider value={{ supabase, session, loading }}>
      {children}
    </Context.Provider>
  );
}

export function useSupabase() {
  const context = useContext(Context);
  if (context === undefined) {
    throw new Error('useSupabase must be used within a SupabaseProvider');
  }
  return context;
}
