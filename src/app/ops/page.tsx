'use client';

import AppShell from '@/components/layout/AppShell';
import LoadingState from '@/components/ui/LoadingState';
import JobsBoard from '@/components/ops/JobsBoard';
import { useJobs } from '@/hooks/useJobs';

/**
 * The Jobs screen (lw-5, 2026-10-16): view only, Scott-only by RLS on
 * ops_runs. The old Command Centre bands left this page; their routes and
 * tables stay for now (spec: a later cleanup).
 */
export default function OpsPage() {
  const { screen, loading } = useJobs();

  return (
    <AppShell>
      {loading || !screen ? (
        <div className="p-6">
          <LoadingState />
        </div>
      ) : (
        <JobsBoard screen={screen} />
      )}
    </AppShell>
  );
}
