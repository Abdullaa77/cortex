'use client';

import type { ReactNode } from 'react';

interface ReviewStepProps {
  title: string;
  children: ReactNode;
}

export default function ReviewStep({ title, children }: ReviewStepProps) {
  return (
    <div className="page-enter">
      <div className="mb-6 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
        <span>──</span>
        <span>{title}</span>
        <span className="flex-1 section-line" />
      </div>
      {children}
    </div>
  );
}
