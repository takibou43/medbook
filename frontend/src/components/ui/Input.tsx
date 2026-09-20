import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, ReactNode, useId } from "react";
import clsx from "clsx";

interface FieldWrapperProps {
  label?: string;
  error?: string;
  // يربط <label> بالحقل (إمكانية الوصول) ويربط رسالة الخطأ به عبر aria-describedby.
  htmlFor?: string;
  children: ReactNode;
}

export function FieldWrapper({ label, error, htmlFor, children }: FieldWrapperProps) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error && (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className, id, ...rest }, ref) => {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrapper label={label} error={error} htmlFor={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={clsx("input", error && "border-red-400", className)}
        {...rest}
      />
    </FieldWrapper>
  );
});
Input.displayName = "Input";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ label, error, className, children, ...rest }, ref) => (
  <FieldWrapper label={label} error={error}>
    <select ref={ref} className={clsx("input", error && "border-red-400", className)} {...rest}>
      {children}
    </select>
  </FieldWrapper>
));
Select.displayName = "Select";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, className, ...rest }, ref) => (
  <FieldWrapper label={label} error={error}>
    <textarea ref={ref} className={clsx("input min-h-[100px] resize-y", error && "border-red-400", className)} {...rest} />
  </FieldWrapper>
));
Textarea.displayName = "Textarea";
