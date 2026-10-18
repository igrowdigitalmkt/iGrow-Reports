import styles from "./sales-page.module.css";

export type MotionKind = "dashboard" | "message" | "pdf" | "present" | "email" | "ai" | "portal" | "schedule";

// Ilustrações animadas em SVG/CSS (sem imagens nem bibliotecas). O estado base de cada elemento é o
// estado final: com movimento reduzido ou pausa, o quadro continua completo e legível.
// Os dados desenhados são fictícios e decorativos.

/** Gradientes, brilho e malha compartilhados. Renderizar uma única vez na página. */
export function MotionDefs() {
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="gx-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4162de" /><stop offset=".55" stopColor="#7c9bff" /><stop offset="1" stopColor="#6ee7ff" /></linearGradient>
      <linearGradient id="gx-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b7bff" stopOpacity=".55" /><stop offset="1" stopColor="#4162de" stopOpacity="0" /></linearGradient>
      <linearGradient id="gx-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1b2548" /><stop offset="1" stopColor="#0b101d" /></linearGradient>
      <linearGradient id="gx-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".2" /><stop offset="1" stopColor="#ffffff" stopOpacity=".04" /></linearGradient>
      <linearGradient id="gx-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6ee7ff" stopOpacity="0" /><stop offset=".5" stopColor="#6ee7ff" stopOpacity=".55" /><stop offset="1" stopColor="#6ee7ff" stopOpacity="0" /></linearGradient>
      <linearGradient id="gx-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7c9bff" /><stop offset="1" stopColor="#4162de" stopOpacity=".35" /></linearGradient>
      <radialGradient id="gx-core"><stop offset="0" stopColor="#dfe6ff" /><stop offset=".35" stopColor="#6f89ff" /><stop offset="1" stopColor="#4162de" stopOpacity="0" /></radialGradient>
      <filter id="gx-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <pattern id="gx-grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#ffffff" strokeOpacity=".055" /></pattern>
    </defs>
  </svg>;
}

function Stage() {
  return <><rect className={styles.mBg} x="1" y="1" width="318" height="198" rx="16" /><rect className={styles.mGridFill} x="1" y="1" width="318" height="198" rx="16" /><ellipse className={styles.mAura} cx="160" cy="110" rx="130" ry="70" /></>;
}

const LINE = "M24 148 C54 128 72 150 104 118 S160 84 192 92 S252 52 296 40";

export function Motion({ kind }: { kind: MotionKind }) {
  return <svg className={styles.motion} viewBox="0 0 320 200" role="img" aria-hidden="true" focusable="false">
    <Stage />
    {kind === "dashboard" && <g>
      <path className={styles.mArea} d={`${LINE} L296 176 L24 176 Z`} />
      {[0, 1, 2, 3, 4].map(i => <line key={i} className={styles.mGridLine} x1="24" x2="296" y1={52 + i * 31} y2={52 + i * 31} />)}
      <path className={`${styles.mStroke} ${styles.mDraw} ${styles.mGlow}`} d={LINE} pathLength="1" />
      <circle className={`${styles.mDot} ${styles.mGlow} ${styles.mTravel}`} r="5" />
      {[0, 1, 2].map(i => <g key={i} className={styles.mFloat} style={{ animationDelay: `${i * .7}s` }}><rect className={styles.mGlass} x={24 + i * 92} y="16" width="84" height="30" rx="9" /><rect className={styles.mTextHi} x={34 + i * 92} y="25" width={34 + i * 8} height="5" rx="2.5" /><rect className={styles.mTextLine} x={34 + i * 92} y="35" width="24" height="4" rx="2" /></g>)}
    </g>}
    {kind === "message" && <g>
      {[0, 1, 2].map(i => <circle key={i} className={styles.mRipple} style={{ animationDelay: `${i * 1.2}s` }} cx="160" cy="104" r="46" />)}
      <rect className={styles.mGlassStrong} x="118" y="22" width="84" height="156" rx="18" />
      <rect className={styles.mTextLine} x="148" y="30" width="24" height="4" rx="2" />
      <g className={styles.mFromLeft}><rect className={styles.mGlass} x="128" y="52" width="58" height="26" rx="8" /><rect className={styles.mTextHi} x="135" y="60" width="38" height="4" rx="2" /><rect className={styles.mTextLine} x="135" y="68" width="24" height="4" rx="2" /></g>
      <g className={`${styles.mFromRight} ${styles.mGlow}`}><rect className={styles.mBubble} x="140" y="88" width="54" height="40" rx="9" /><rect className={styles.mTextOn} x="148" y="97" width="38" height="4" rx="2" /><rect className={styles.mTextOn} x="148" y="107" width="28" height="4" rx="2" /><rect className={styles.mTextOn} x="148" y="117" width="18" height="4" rx="2" /></g>
      <path className={`${styles.mTick} ${styles.mDraw}`} d="M174 142l5 5 10-11" pathLength="1" />
    </g>}
    {kind === "pdf" && <g className={styles.mFloat}>
      <rect className={styles.mGlass} x="106" y="30" width="108" height="144" rx="10" style={{ transform: "rotate(-7deg)", transformOrigin: "160px 100px" }} />
      <rect className={styles.mGlassStrong} x="106" y="24" width="108" height="144" rx="10" />
      <rect className={styles.mTagFill} x="118" y="36" width="30" height="15" rx="4" />
      {[62, 74, 86].map((y, i) => <rect key={y} className={styles.mTextLine} x="118" y={y} width={84 - i * 14} height="5" rx="2.5" />)}
      {[16, 30, 22, 38].map((h, i) => <rect key={i} className={styles.mBarGrad} style={{ animationDelay: `${i * .15}s` }} x={120 + i * 20} y={152 - h} width="12" height={h} rx="3" />)}
      <rect className={styles.mBeam} x="106" y="24" width="108" height="34" />
    </g>}
    {kind === "present" && <g>
      <g style={{ transform: "perspective(400px)" }}>
        <rect className={styles.mGlassStrong} x="34" y="26" width="252" height="132" rx="12" />
        <g className={styles.mSlideA}><rect className={styles.mTextHi} x="58" y="52" width="104" height="9" rx="4.5" /><rect className={styles.mTextLine} x="58" y="72" width="160" height="5" rx="2.5" /><rect className={styles.mTextLine} x="58" y="84" width="130" height="5" rx="2.5" /><rect className={styles.mGlass} x="58" y="102" width="70" height="28" rx="7" /><rect className={styles.mGlass} x="136" y="102" width="70" height="28" rx="7" /></g>
        <g className={styles.mSlideB}>{[44, 70, 56, 92].map((h, i) => <rect key={i} className={`${styles.mBarGrad} ${styles.mGlow}`} style={{ animationDelay: `${i * .12}s` }} x={62 + i * 54} y={140 - h} width="34" height={h} rx="6" />)}</g>
        <g className={styles.mSlideC}><circle className={styles.mRingBase} cx="160" cy="92" r="36" /><circle className={`${styles.mRingFill} ${styles.mGlow}`} cx="160" cy="92" r="36" pathLength="1" /></g>
      </g>
      <circle className={`${styles.mDot} ${styles.mGlow} ${styles.mPointer}`} r="4" />
      <rect className={styles.mTextLine} x="128" y="172" width="64" height="5" rx="2.5" /><rect className={styles.mTextLine} x="104" y="184" width="112" height="4" rx="2" />
    </g>}
    {kind === "email" && <g>
      <path className={styles.mFlowPath} d="M44 150 C90 70 230 70 276 150" />
      {[0, 1, 2].map(i => <rect key={i} className={`${styles.mPacket} ${styles.mGlow}`} style={{ animationDelay: `${i * 1.1}s` }} width="9" height="9" rx="2" />)}
      <g className={styles.mDoc}><rect className={styles.mPageHolo} x="124" y="46" width="72" height="92" rx="8" /><rect className={styles.mTagFill} x="132" y="54" width="24" height="12" rx="3" />{[76, 88, 100].map(y => <rect key={y} className={styles.mTextLine} x="132" y={y} width="56" height="4" rx="2" />)}</g>
      <rect className={styles.mGlassStrong} x="82" y="102" width="156" height="78" rx="12" />
      <path className={`${styles.mStroke} ${styles.mGlow}`} d="M86 108 L160 152 L234 108" />
    </g>}
    {kind === "ai" && <g>
      {[[160, 100, 70, 52], [160, 100, 250, 56], [160, 100, 60, 150], [160, 100, 262, 148], [160, 100, 160, 30], [160, 100, 160, 176], [70, 52, 60, 150], [250, 56, 262, 148]].map(([x1, y1, x2, y2], i) => <line key={i} className={styles.mEdge} x1={x1} y1={y1} x2={x2} y2={y2} style={{ animationDelay: `${i * .35}s` }} />)}
      {[[70, 52], [250, 56], [60, 150], [262, 148], [160, 30], [160, 176]].map(([cx, cy], i) => <g key={i}><circle className={styles.mNodeHalo} cx={cx} cy={cy} r="12" style={{ animationDelay: `${i * .4}s` }} /><circle className={`${styles.mNode} ${styles.mGlow}`} cx={cx} cy={cy} r="5" /></g>)}
      <circle className={styles.mCoreGlow} cx="160" cy="100" r="34" />
      <circle className={`${styles.mCore} ${styles.mGlow}`} cx="160" cy="100" r="13" />
      <path className={styles.mSpark} d="M160 90 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" />
    </g>}
    {kind === "portal" && <g>
      <circle className={styles.mRingBase} cx="92" cy="100" r="46" /><circle className={`${styles.mRingFill} ${styles.mGlow}`} cx="92" cy="100" r="46" pathLength="1" />
      <circle className={`${styles.mRingBase} ${styles.mSpinSlow}`} cx="92" cy="100" r="30" strokeDasharray="3 7" />
      <path className={`${styles.mStroke} ${styles.mGlow}`} d="M82 100v-6a10 10 0 0120 0v6" />
      <rect className={styles.mGlassStrong} x="76" y="100" width="32" height="24" rx="6" />
      {[0, 1, 2].map(i => <g key={i} className={styles.mFloat} style={{ animationDelay: `${i * .5}s` }}><rect className={styles.mGlass} x="160" y={48 + i * 38} width="136" height="30" rx="9" /><rect className={styles.mTextHi} x="172" y={58 + i * 38} width={70 - i * 10} height="5" rx="2.5" /><rect className={styles.mTextLine} x="172" y={68 + i * 38} width="40" height="4" rx="2" /><circle className={styles.mDot} cx="280" cy={63 + i * 38} r="4" /></g>)}
    </g>}
    {kind === "schedule" && <g>
      <circle className={styles.mRingBase} cx="160" cy="100" r="70" />
      <circle className={styles.mRingBase} cx="160" cy="100" r="46" strokeDasharray="2 8" />
      {Array.from({ length: 12 }, (_, i) => { const a = (i * 30 * Math.PI) / 180; return <line key={i} className={styles.mTick2} x1={160 + Math.sin(a) * 62} y1={100 - Math.cos(a) * 62} x2={160 + Math.sin(a) * 70} y2={100 - Math.cos(a) * 70} />; })}
      <g className={styles.mSweep}><path className={styles.mSweepFill} d="M160 100 L160 30 A70 70 0 0 1 220.6 65 Z" /><line className={`${styles.mStroke} ${styles.mGlow}`} x1="160" y1="100" x2="160" y2="30" /></g>
      {[[160, 54], [206, 100], [160, 146], [114, 100]].map(([cx, cy], i) => <circle key={i} className={`${styles.mNode} ${styles.mBlink} ${styles.mGlow}`} style={{ animationDelay: `${i * .9}s` }} cx={cx} cy={cy} r="5" />)}
      <circle className={styles.mCoreGlow} cx="160" cy="100" r="14" />
    </g>}
  </svg>;
}

/** Peça central da seção "como funciona": núcleo de IA com órbitas e dados trafegando. */
export function CoreMotion() {
  const nodes = [["Negócio", 260, 62], ["Contas", 448, 190], ["Limites", 410, 396], ["Ações", 110, 396], ["Resultados", 72, 190]] as const;
  return <svg className={styles.core} viewBox="0 0 520 520" role="img" aria-label="Ilustração: o núcleo de inteligência da Groow Ads conectando negócio, contas, limites, ações e resultados" focusable="false">
    <circle className={styles.coreAura} cx="260" cy="260" r="200" />
    {[190, 150, 108].map((r, i) => <circle key={r} className={styles.coreRing} cx="260" cy="260" r={r} strokeDasharray={i === 1 ? "2 9" : i === 2 ? "40 18" : undefined} />)}
    <g className={styles.coreSpin}><circle className={styles.coreSat} cx="260" cy="70" r="6" /><circle className={styles.coreSat} cx="260" cy="450" r="4" /></g>
    <g className={styles.coreSpinRev}><circle className={styles.coreSat} cx="152" cy="260" r="5" /><circle className={styles.coreSat} cx="408" cy="260" r="3" /></g>
    {nodes.map(([label, x, y], i) => <g key={label}>
      <line className={styles.coreEdge} x1="260" y1="260" x2={x} y2={y} style={{ animationDelay: `${i * .6}s` }} />
      <circle className={styles.coreHalo} cx={x} cy={y} r="22" style={{ animationDelay: `${i * .5}s` }} />
      <circle className={styles.coreNode} cx={x} cy={y} r="8" />
      <text className={styles.coreLabel} x={x} y={y + (y < 260 ? -26 : 34)} textAnchor="middle">{label}</text>
    </g>)}
    <circle className={styles.coreGlowBig} cx="260" cy="260" r="64" />
    <polygon className={styles.coreHex} points="260,222 293,241 293,279 260,298 227,279 227,241" />
    <path className={styles.coreSpark} d="M260 240 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5z" />
  </svg>;
}
