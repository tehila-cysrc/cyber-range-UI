import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  fontSize: '13px',
  borderRadius: 'var(--radius-control)',
  padding: '8px 16px',
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: 'background-color 120ms ease, border-color 120ms ease',
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--text-primary)',
    color: 'var(--surface-floor)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-primary)',
    borderColor: 'rgba(51, 65, 85, 0.7)',
  },
  destructive: {
    background: 'transparent',
    color: 'var(--signal-alert)',
    borderColor: 'var(--signal-alert)',
  },
};

export function Button({ variant = 'primary', style, ...rest }: ButtonProps) {
  return <button style={{ ...base, ...variants[variant], ...style }} {...rest} />;
}
