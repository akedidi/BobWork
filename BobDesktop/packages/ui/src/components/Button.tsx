import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    // A simplified implementation. The real one would use Tailwind classes
    return (
      <button ref={ref} className={`btn btn-${variant} btn-${size} ${className || ''}`} {...props}>
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
