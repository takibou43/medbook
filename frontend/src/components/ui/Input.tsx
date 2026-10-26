import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { InputHTMLAttributes, forwardRef, ReactNode, useId } from "react";
import clsx from "clsx";

interface FieldWrapperProps {
  label?: string;
  error?: string;
  // يربط <label> بالحقل (إمكانية الوصول) ويربط رسالة الخطأ به عبر aria-describedby.
  htmlFor?: string;
  children: ReactNode;
}

export function FieldWrapper({ label, error, htmlFor, children }: FieldWrapperProps) {
  useLanguage();
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {t(label ?? "")}
        </label>
      )}
      {children}
      {error && (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="mt-1 text-xs text-red-600">
          {t(error ?? "")}
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
  useLanguage();
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrapper label={t(label ?? "")} error={t(error ?? "")} htmlFor={fieldId}>
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
