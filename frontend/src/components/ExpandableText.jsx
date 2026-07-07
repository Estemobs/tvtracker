import { useState } from 'react';

export default function ExpandableText({ text, limit = 400, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  const isLong = text.length > limit;
  const shown = expanded || !isLong ? text : `${text.slice(0, limit).trimEnd()}…`;

  return (
    <p className={className}>
      {shown}
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-accent-500 hover:underline text-xs font-medium ml-2 whitespace-nowrap"
        >
          {expanded ? 'Voir moins' : 'Voir plus'}
        </button>
      )}
    </p>
  );
}
