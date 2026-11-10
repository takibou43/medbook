import { useLanguage } from "../../i18n/LanguageRoot";
import { t } from "../../i18n/locale.ts";
import { InputHTMLAttributes, forwardRef, ReactNode, useId, useState } from "react";
import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";

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

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className, id, type, ...rest }, ref) => {
  const language = useLanguage();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = type === "password";
  const autoId = useId();
  const fieldId = id ?? autoId;
  const input = (
    <input
      ref={ref}
      type={isPassword && passwordVisible ? "text" : type}
      autoCapitalize={isPassword ? "none" : undefined}
      autoCorrect={isPassword ? "off" : undefined}
      spellCheck={isPassword ? false : undefined}
      id={fieldId}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${fieldId}-error` : undefined}
      className={clsx("input", error && "border-red-400", isPassword && "[&::-ms-reveal]:hidden", className)}
      {...rest}
    />
  );
  const toggleLabel = t(passwordVisible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
  const VisibilityIcon = passwordVisible ? EyeOff : Eye;

  return (
    <FieldWrapper label={t(label ?? "")} error={t(error ?? "")} htmlFor={fieldId}>
      {isPassword ? (
        <div className={clsx("relative", language === "ar" ? "[&>input]:pl-12" : "[&>input]:pr-12")}>
          {input}
          <button
            type="button"
            aria-label={toggleLabel}
            aria-controls={fieldId}
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
