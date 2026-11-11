'use client';

import AppShell from '@/components/layout/AppShell';
import LoadingState from '@/components/ui/LoadingState';
import JobsBoard from '@/components/ops/JobsBoard';
import TicketsBoardView from '@/components/ops/TicketsBoard';
import { useJobs } from '@/hooks/useJobs';

/**
 * The Jobs screen (lw-5, 2026-10-16): view only, Scott-only by RLS on
 * ops_runs. The old Command Centre bands left this page; their routes and
 * tables stay for now (spec: a later cleanup). Below the Jobs: the Tickets
 * board (2026-11-11, T-1) — every ticket in its ledger column.
 */
export default function OpsPage() {
  const { screen, tickets, loading } = useJobs();

  return (
    <AppShell>
      {loading || !screen ? (
        <div className="p-6">
          <LoadingState />
        </div>
      ) : (
        <>
          <JobsBoard screen={screen} />
          {tickets && <TicketsBoardView board={tickets} />}
        </>
      )}
    </AppShell>
  );
}
