import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input ref={ref} className={`input ${error ? 'input-error' : ''} ${className || ''}`} {...props} />
    );
  }
);
Input.displayName = 'Input';
