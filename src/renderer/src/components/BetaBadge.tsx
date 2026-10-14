interface BetaBadgeProps {
  className?: string;
}

function BetaBadge({ className = "" }: BetaBadgeProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.15)] ${className}`}
    >
      Beta
    </span>
  );
}

export default BetaBadge;
