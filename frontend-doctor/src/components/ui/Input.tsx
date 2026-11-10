import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, ReactNode, useId, useState } from "react";
import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";

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
  useLanguage();
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {t(label ?? "")}
        </label>
      )}
      {children}
      {hint && (
        <p id={hintId} className="mt-1 text-xs leading-5 text-slate-600">
          {t(hint ?? "")}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {t(error ?? "")}
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

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, hint, className, id, type, ...rest }, ref) => {
  const language = useLanguage();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = type === "password";
  const ids = useFieldIds(id, error, hint);
  const input = (
    <input
      ref={ref}
      type={isPassword && passwordVisible ? "text" : type}
      autoCapitalize={isPassword ? "none" : undefined}
      autoCorrect={isPassword ? "off" : undefined}
      spellCheck={isPassword ? false : undefined}
      id={ids.fieldId}
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.describedBy}
      className={clsx("input", error && "border-red-400", isPassword && "[&::-ms-reveal]:hidden", className)}
      {...rest}
    />
  );
  const toggleLabel = t(passwordVisible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
  const VisibilityIcon = passwordVisible ? EyeOff : Eye;

  return (
    <FieldWrapper label={t(label ?? "")} error={t(error ?? "")} hint={t(hint ?? "")} htmlFor={ids.fieldId} errorId={ids.errorId} hintId={ids.hintId}>
      {isPassword ? (
        <div className={clsx("relative", language === "ar" ? "[&>input]:pl-12" : "[&>input]:pr-12")}>
          {input}
          <button
            type="button"
            aria-label={toggleLabel}
            aria-controls={ids.fieldId}
            title={toggleLabel}
            disabled={rest.disabled}
            className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-xl text-slate-600 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            <VisibilityIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ) : input}
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
  useLanguage();
  const ids = useFieldIds(id, error, hint);
  return (
    <FieldWrapper label={t(label ?? "")} error={t(error ?? "")} hint={t(hint ?? "")} htmlFor={ids.fieldId} errorId={ids.errorId} hintId={ids.hintId}>
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
  useLanguage();
  const ids = useFieldIds(id, error, hint);
  return (
    <FieldWrapper label={t(label ?? "")} error={t(error ?? "")} hint={t(hint ?? "")} htmlFor={ids.fieldId} errorId={ids.errorId} hintId={ids.hintId}>
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
