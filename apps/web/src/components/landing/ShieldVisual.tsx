/**
 * Hero illustration: the shield sits between two orbits — Cardano
 * (public settlement) and Midnight (shielded state). Purely decorative;
 * the floating cards are labelled as illustrative and carry no live data.
 */
export function ShieldVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px] sm:max-w-[540px]" aria-hidden="true">
      {/* glow */}
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(130,150,255,0.35),transparent_68%)] blur-2xl" />
      <div className="absolute inset-[30%] rounded-full bg-[radial-gradient(circle,rgba(167,139,255,0.3),transparent_70%)] blur-3xl animate-float-slow" />

      <svg viewBox="0 0 520 520" className="relative h-full w-full" fill="none">
        <defs>
          <linearGradient id="hv-stroke" x1="150" y1="110" x2="370" y2="420" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8fb0ff" />
            <stop offset="0.5" stopColor="#dfe5ff" />
            <stop offset="1" stopColor="#a78bff" />
          </linearGradient>
          <linearGradient id="hv-fill" x1="260" y1="120" x2="260" y2="410" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3a5bd9" stopOpacity="0.38" />
            <stop offset="0.55" stopColor="#5a3fc4" stopOpacity="0.16" />
            <stop offset="1" stopColor="#05060b" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="hv-ring-a" x1="0" y1="0" x2="520" y2="520" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5b84ff" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#5b84ff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#5b84ff" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="hv-ring-b" x1="520" y1="0" x2="0" y2="520" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a78bff" stopOpacity="0.5" />
            <stop offset="0.5" stopColor="#a78bff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#a78bff" stopOpacity="0.4" />
          </linearGradient>
          <radialGradient id="hv-node-a">
            <stop stopColor="#dbe5ff" />
            <stop offset="0.35" stopColor="#5b84ff" />
            <stop offset="1" stopColor="#5b84ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hv-node-b">
            <stop stopColor="#efe9ff" />
            <stop offset="0.35" stopColor="#a78bff" />
            <stop offset="1" stopColor="#a78bff" stopOpacity="0" />
          </radialGradient>
          <pattern id="hv-lattice" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="7" cy="7" r="0.9" fill="#c5d0ff" fillOpacity="0.35" />
          </pattern>
          <clipPath id="hv-shield-clip">
            <path d="M260 112l118 48v86c0 76-50 141-118 164-68-23-118-88-118-164v-86l118-48z" />
          </clipPath>
        </defs>

        {/* static guide rings */}
        <circle cx="260" cy="260" r="246" stroke="white" strokeOpacity="0.04" />
        <circle cx="260" cy="260" r="128" stroke="white" strokeOpacity="0.05" strokeDasharray="2 6" />

        {/* Cardano orbit */}
        <g className="animate-spin-slow" style={{ transformOrigin: "260px 260px" }}>
          <circle cx="260" cy="260" r="222" stroke="url(#hv-ring-a)" strokeWidth="1.2" />
          <circle cx="103" cy="103" r="16" fill="url(#hv-node-a)" />
          <circle cx="103" cy="103" r="4" fill="#eaf0ff" />
          <circle cx="417" cy="417" r="2.5" fill="#5b84ff" fillOpacity="0.8" />
        </g>

        {/* Midnight orbit */}
        <g className="animate-spin-slower" style={{ transformOrigin: "260px 260px" }}>
          <circle cx="260" cy="260" r="176" stroke="url(#hv-ring-b)" strokeWidth="1.2" strokeDasharray="1 7" strokeLinecap="round" />
          <circle cx="260" cy="260" r="176" stroke="url(#hv-ring-b)" strokeOpacity="0.5" />
          <circle cx="436" cy="260" r="14" fill="url(#hv-node-b)" />
          <circle cx="436" cy="260" r="3.5" fill="#f3efff" />
          <circle cx="84" cy="260" r="2.5" fill="#a78bff" />
        </g>

        {/* Shield */}
        <g className="animate-float" style={{ transformOrigin: "260px 260px" }}>
          <path
            d="M260 112l118 48v86c0 76-50 141-118 164-68-23-118-88-118-164v-86l118-48z"
            fill="url(#hv-fill)"
          />
          <g clipPath="url(#hv-shield-clip)">
            <rect x="140" y="110" width="240" height="310" fill="url(#hv-lattice)" />
            {/* light sweep */}
            <rect x="120" y="100" width="70" height="340" fill="white" fillOpacity="0.05" transform="rotate(18 260 260)" />
          </g>
          <path
            d="M260 112l118 48v86c0 76-50 141-118 164-68-23-118-88-118-164v-86l118-48z"
            stroke="url(#hv-stroke)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M260 140l94 38v68c0 61-40 113-94 132-54-19-94-71-94-132v-68l94-38z"
            stroke="white"
            strokeOpacity="0.1"
            strokeLinejoin="round"
          />
          <path d="M260 112v298" stroke="url(#hv-stroke)" strokeOpacity="0.25" />

          {/* keyhole */}
          <circle cx="260" cy="238" r="26" fill="#e4c27a" fillOpacity="0.12" />
          <circle cx="260" cy="238" r="13" fill="#e4c27a" />
          <path d="M260 248v32" stroke="#e4c27a" strokeWidth="9" strokeLinecap="round" />
          <circle cx="260" cy="238" r="13" stroke="white" strokeOpacity="0.4" />
        </g>
      </svg>

      {/* floating annotation cards (illustrative) */}
      <div className="glass-panel animate-float absolute bottom-[-2%] left-0 w-[62%] max-w-[260px] rounded-2xl p-4 sm:bottom-[-4%] sm:left-[-6%] sm:p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono-label text-[9.5px] text-text-dim">Sample policy</p>
          <p className="font-mono-label text-[9px] text-gold">Illustrative</p>
        </div>
        <dl className="mt-3.5 space-y-2.5 text-[12.5px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-dim">Cover</dt>
            <dd className="text-text">Stablecoin depeg</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-dim">Settles on</dt>
            <dd className="flex items-center gap-1.5 text-text">
              <span className="h-1.5 w-1.5 rounded-full bg-cardano" />
              Cardano
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-dim">Position size</dt>
            <dd className="flex items-center">
              <span className="redact w-16" />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-dim">Terms</dt>
            <dd className="flex items-center gap-1.5 text-midnight">
              <LockIcon />
              Shielded
            </dd>
          </div>
        </dl>
      </div>

      <div className="glass-panel animate-float-slow absolute right-0 top-[9%] flex items-center gap-2.5 rounded-full py-2 pl-2.5 pr-3.5 sm:right-[-2%]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--midnight-soft)] text-midnight">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[12px] text-text">
          ZK proof <span className="text-text-dim">· disclosed only what’s needed</span>
        </span>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
