import { forwardRef, type ReactNode } from 'react';

export function FieldLabel({ label, required, htmlFor }: { label: string; required?: boolean; htmlFor?: string }) {
  const requiredMarker = required ? <span className="text-red-400" aria-hidden="true"> *</span> : null;

  if (htmlFor) {
    return (
      <div className="text-xs font-medium text-stone-300">
        <label htmlFor={htmlFor}>{label}</label>
        {requiredMarker}
      </div>
    );
  }

  return (
    <div className="text-xs font-medium text-stone-300">
      <span>{label}</span>
      {requiredMarker}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="text-xs text-red-400 mt-1">{message}</div>;
}

type InputFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  ariaLabel?: string;
};

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(props, ref) {
  const hideNumberSpinners = props.type === 'number'
    ? '[appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
    : '';
  return (
    <input
      ref={ref}
      id={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      disabled={props.disabled}
      type={props.type ?? 'text'}
      aria-label={props.ariaLabel}
      className={`
        w-full px-3 py-2 rounded-lg
        bg-white/[0.03] border border-white/[0.06]
        text-stone-200 placeholder:text-stone-600
        focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
        disabled:opacity-50 disabled:cursor-not-allowed
        ${hideNumberSpinners}
      `}
    />
  );
});

type SelectFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(props, ref) {
  return (
    <select
      ref={ref}
      id={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.disabled}
      className={`
        w-full px-3 py-2 rounded-lg
        bg-white/[0.03] border border-white/[0.06]
        text-stone-200
        focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
    >
      {props.children}
    </select>
  );
});
