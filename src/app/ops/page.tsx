'use client';

import AppShell from '@/components/layout/AppShell';
import LoadingState from '@/components/ui/LoadingState';
import OpsBoard from '@/components/ops/OpsBoard';
import { useOps } from '@/hooks/useOps';

/** The Command Centre. Scott-only by RLS on ops_runs; read-only by construction. */
export default function OpsPage() {
  const { board, loading, refetch } = useOps();

  return (
    <AppShell>
      {loading || !board ? (
        <div className="p-6">
          <LoadingState />
        </div>
      ) : (
        <OpsBoard board={board} onRefresh={refetch} />
      )}
    </AppShell>
  );
}
