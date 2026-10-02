import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, ReactNode, useId } from "react";
import clsx from "clsx";

interface FieldWrapperProps {
  label?: string;
  error?: string;
  /** معرّف الحقل لربط التسمية به برمجيًا (htmlFor) — تولّده المكوّنات أدناه تلقائيًا. */
  htmlFor?: string;
  errorId?: string;
  /** نص مساعد تحت الحقل (مربوط بـaria-describedby). */
  hint?: ReactNode;
  hintId?: string;
  children: ReactNode;
}

export function FieldWrapper({ label, error, htmlFor, errorId, hint, hintId, children }: FieldWrapperProps) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p id={hintId} className="mt-1 text-xs leading-5 text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** معرّفات الحقل/الخطأ/المساعدة — تُحترم `id` الممرَّرة صراحة. */
function useFieldIds(id: string | undefined, error?: string, hint?: ReactNode) {
  const auto = useId();
  const fieldId = id ?? `f${auto.replace(/:/g, "")}`;
  const errorId = `${fieldId}-err`;
  const hintId = `${fieldId}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return { fieldId, errorId, hintId, describedBy };
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, hint, className, id, ...rest }, ref) => {
  const ids = useFieldIds(id, error, hint);
  return (
    <FieldWrapper label={label} error={error} hint={hint} htmlFor={ids.fieldId} errorId={ids.errorId} hintId={ids.hintId}>
      <input
        ref={ref}
        id={ids.fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
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
  hint?: ReactNode;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ label, error, hint, className, children, id, ...rest }, ref) => {
  const ids = useFieldIds(id, error, hint);
  return (
    <FieldWrapper label={label} error={error} hint={hint} htmlFor={ids.fieldId} errorId={ids.errorId} hintId={ids.hintId}>
      <select
        ref={ref}
        id={ids.fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={clsx("input", error && "border-red-400", className)}
        {...rest}
      >
        {children}
      </select>
    </FieldWrapper>
  );
});
Select.displayName = "Select";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, hint, className, id, ...rest }, ref) => {
  const ids = useFieldIds(id, error, hint);
  return (
    <FieldWrapper label={label} error={error} hint={hint} htmlFor={ids.fieldId} errorId={ids.errorId} hintId={ids.hintId}>
      <textarea
        ref={ref}
        id={ids.fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={clsx("input min-h-[100px] resize-y", error && "border-red-400", className)}
        {...rest}
      />
    </FieldWrapper>
  );
});
Textarea.displayName = "Textarea";
