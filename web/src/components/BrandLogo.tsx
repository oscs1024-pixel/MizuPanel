type BrandLogoProps = {
  className?: string
}

export function BrandLogo({ className = 'h-9 w-9' }: BrandLogoProps) {
  return (
    <svg
      role="img"
      aria-label="MizuPanel logo"
      data-testid="mizupanel-logo-mark"
      viewBox="0 0 40 40"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="mizupanel-logo-bg" x1="7" y1="5" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="0.55" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="mizupanel-logo-line" x1="10" y1="12" x2="30" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbeafe" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="35" height="35" rx="11" fill="url(#mizupanel-logo-bg)" />
      <path d="M9.5 15.5C14.8 9.8 25.2 9.8 30.5 15.5" stroke="white" strokeOpacity="0.34" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.5 25.2V14.8c0-1.4 1.75-2 2.63-.92L20 23.2l7.87-9.32c0.88-1.08 2.63-.48 2.63.92v10.4" stroke="url(#mizupanel-logo-line)" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 29.5h16" stroke="white" strokeOpacity="0.38" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="15" r="2.15" fill="#ecfeff" />
      <circle cx="30" cy="15" r="2.15" fill="#ecfeff" />
      <circle cx="20" cy="23" r="2.3" fill="#ecfeff" />
      <circle cx="20" cy="23" r="4.8" stroke="white" strokeOpacity="0.24" strokeWidth="1.1" />
    </svg>
  )
}
