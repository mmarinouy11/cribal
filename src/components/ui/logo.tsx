/** Logo B — a "C" arc with a scan line and scan dot (detection/scanning). */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        width="32"
        height="32"
        rx="8"
        fill="#06b6d4"
        fillOpacity="0.15"
        stroke="#06b6d4"
        strokeWidth="0.5"
        strokeOpacity="0.4"
      />
      {/* C arc */}
      <path
        d="M22 9 A10 10 0 1 0 22 23"
        stroke="#06b6d4"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {/* Scan line */}
      <line
        x1="10"
        y1="16"
        x2="20"
        y2="16"
        stroke="#06b6d4"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* Scan dot */}
      <circle cx="20" cy="16" r="2.5" fill="#06b6d4" />
    </svg>
  )
}
