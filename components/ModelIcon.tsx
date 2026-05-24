'use client';

import { ModelOption } from '@/lib/types';

interface ModelIconProps {
  model?: Partial<ModelOption> | null;
  author?: string;
  color?: string;
  alt?: string;
  className?: string;
}

function resolveLabel(model?: Partial<ModelOption> | null, author?: string): string {
  const source = author || model?.author || model?.name || 'M';
  if (!source) return 'M';
  if (source.toLowerCase() === 'xai') return 'X';
  return source[0].toUpperCase();
}

function resolveColor(model?: Partial<ModelOption> | null, color?: string): string {
  return color || model?.color || '#6b7280';
}

export function ModelIcon({ model, author, color, alt, className = 'w-4 h-4' }: ModelIconProps) {
  const label = resolveLabel(model, author);
  const bg = resolveColor(model, color);
  const ariaLabel = alt || model?.name || author || 'Model';

  return (
    <div
      className={`${className} rounded-sm flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}
      style={{ backgroundColor: bg }}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {label}
    </div>
  );
}
