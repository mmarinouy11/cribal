/** Radar / sonar logo mark — concentric arcs from a center dot (detection). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="28" height="28" rx="7" fill="#06b6d4" />
      <circle cx="14" cy="14" r="2.5" fill="#0c1e3c" />
      <path
        d="M14 8 A6 6 0 0 1 20 14"
        stroke="#0c1e3c"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M14 5 A9 9 0 0 1 23 14"
        stroke="#0c1e3c"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M14 2 A12 12 0 0 1 26 14"
        stroke="#0c1e3c"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
        opacity="0.3"
      />
    </svg>
  )
}
