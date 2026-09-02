interface LogoProps {
  className?: string;
}

export function Logo({ className = "h-8 w-8" }: LogoProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mb-logo-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0f3d5c" />
        </linearGradient>
      </defs>
      <path
        d="M24 10 C18 6 9 6 6 9 V37 C9 34 18 34 24 38 C30 34 39 34 42 37 V9 C39 6 30 6 24 10 Z"
        fill="url(#mb-logo-grad)"
      />
      <path
        d="M11 21 H16 L19 15 L23 27 L26 19 L29 23 H37"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
