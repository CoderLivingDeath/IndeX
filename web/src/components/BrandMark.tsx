export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ flexShrink: 0, filter: "drop-shadow(0 0 12px rgba(0, 219, 255, 0.45))" }}
    >
      <defs>
        <linearGradient id="ix-diamond" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8DF4FF" />
          <stop offset="0.5" stopColor="#00DBFF" />
          <stop offset="1" stopColor="#0093B8" />
        </linearGradient>
        <linearGradient id="ix-corners" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8DF4FF" />
          <stop offset="1" stopColor="#00DBFF" />
        </linearGradient>
      </defs>

      <path
        d="M8 22V8h14M42 8h14v14M56 42v14H42M22 56H8V42"
        fill="none"
        stroke="url(#ix-corners)"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <rect
        x="18"
        y="18"
        width="28"
        height="28"
        rx="5"
        transform="rotate(45 32 32)"
        fill="url(#ix-diamond)"
        opacity="0.95"
      />
      <rect
        x="23"
        y="23"
        width="18"
        height="18"
        rx="3"
        transform="rotate(45 32 32)"
        fill="#041016"
        opacity="0.7"
      />
      <text
        x="32"
        y="36.5"
        textAnchor="middle"
        fontSize="10.5"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        fill="#00DBFF"
      >
        {"</>"}
      </text>
    </svg>
  );
}
