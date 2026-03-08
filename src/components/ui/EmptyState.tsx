'use client';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      {icon && (
        <div className="text-text-muted mb-4 text-4xl">{icon}</div>
      )}
      <p className="font-mono text-text-muted text-lg mb-1">
        {'> '}{title}
      </p>
      {description && (
        <p className="font-sans text-text-muted/60 text-sm mt-2 max-w-sm text-center">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-6 px-4 py-2 font-mono text-sm bg-accent/10 text-accent border border-accent/30
            rounded-lg hover:bg-accent/20 transition-colors duration-150"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
