'use client';

export default function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <p className="font-mono text-accent text-lg">
        <span className="inline-block animate-[typing_1.5s_steps(10)_infinite]">
          Loading...
        </span>
        <span className="inline-block w-2 h-5 bg-accent ml-0.5 align-middle animate-[blink_1s_step-end_infinite]" />
      </p>
      <div className="flex gap-2 mt-4">
        <span className="w-2 h-2 rounded-full bg-accent animate-[pulse_1.5s_ease-in-out_infinite]" />
        <span className="w-2 h-2 rounded-full bg-accent animate-[pulse_1.5s_ease-in-out_0.3s_infinite]" />
        <span className="w-2 h-2 rounded-full bg-accent animate-[pulse_1.5s_ease-in-out_0.6s_infinite]" />
      </div>
    </div>
  );
}
