import { forwardRef, useRef, useState } from 'react';
import { DropdownPopover, type DropdownPopoverPlacement } from '../DropdownPopover';

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
        focus:outline-none focus:ring-0
        focus:border-white/[0.08]
        focus:shadow-[0_0_0_1px_rgba(232,166,66,0.08)]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${hideNumberSpinners}
      `}
    />
  );
});

type PopoverSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type PopoverSelectFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  options: PopoverSelectOption[];
  placeholder?: string;
  preferPlacement?: DropdownPopoverPlacement;
  ariaLabel?: string;
  icon?: string;
};

export function PopoverSelectField(props: PopoverSelectFieldProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const isDisabled = Boolean(props.disabled);
  const selected = props.options.find((option) => option.value === props.value);
  const shown = selected?.label ?? props.placeholder ?? 'Select…';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        id={props.id}
        type="button"
        onClick={() => setIsOpen((prev) => (isDisabled ? false : !prev))}
        disabled={isDisabled}
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`
          w-full
          inline-flex items-center gap-2
          px-3 py-2 rounded-lg
          text-xs font-medium
          transition-all duration-200
          border
          oh-focus-outline
          bg-white/[0.03] text-stone-400 border-white/[0.06]
          hover:bg-white/[0.08] hover:text-stone-300 hover:border-white/[0.1]
          disabled:opacity-50 disabled:cursor-not-allowed
          disabled:hover:bg-white/[0.03] disabled:hover:text-stone-400 disabled:hover:border-white/[0.06]
        `}
      >
        {props.icon && <span className={`codicon ${props.icon} text-[13px] text-brand-400/70`} aria-hidden="true" />}
        <span className="flex-1 font-mono text-stone-300 truncate">{shown}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'} text-[10px] opacity-70`} aria-hidden="true" />
      </button>

      <DropdownPopover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={buttonRef}
        preferPlacement={props.preferPlacement}
        className="w-full z-50"
      >
        <div
          role="listbox"
          aria-label={props.ariaLabel ?? 'Select'}
          className="
            overflow-hidden rounded-xl
            bg-[var(--surface-2)]/95
            backdrop-blur-md
            border border-white/[0.08]
            shadow-lg shadow-black/30
          "
          style={{
            boxShadow: `
              inset 0 1px 0 rgba(255, 255, 255, 0.06),
              0 12px 24px rgba(0, 0, 0, 0.55),
              0 0 0 1px rgba(232, 166, 66, 0.10)
            `,
          }}
        >
          <div className="p-2 space-y-1">
            {props.options.map((option) => {
              const isSelected = option.value === props.value;
              const isOptionDisabled = isDisabled || option.disabled === true;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-label={option.label}
                  disabled={isOptionDisabled}
                  onClick={() => {
                    if (isOptionDisabled) return;
                    props.onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg
                    text-sm
                    transition-colors duration-150
                    flex items-center gap-2
                    hover:bg-white/10
                    ${isSelected ? 'bg-brand-500/20 text-brand-300' : 'text-stone-300'}
                    ${isOptionDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <span className="codicon codicon-symbol-misc opacity-70" aria-hidden="true" />
                  <span className="flex-1 font-mono truncate">{option.label}</span>
                  {isSelected && <span className="codicon codicon-check text-brand-400" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      </DropdownPopover>
    </div>
  );
}
