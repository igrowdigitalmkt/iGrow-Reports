import styles from "./sales-page.module.css";

export type MotionKind = "dashboard" | "message" | "pdf" | "present" | "email" | "ai" | "portal" | "schedule";

// Ilustrações animadas em SVG/CSS. O estado base é o estado final: sem animação (movimento reduzido
// ou pausa), cada quadro permanece completo e legível. Todos os dados são fictícios.
export function Motion({ kind }: { kind: MotionKind }) {
  return <svg className={styles.motion} viewBox="0 0 320 200" role="img" aria-hidden="true" focusable="false">
    <rect className={styles.mFrame} x="1" y="1" width="318" height="198" rx="14" />
    {kind === "dashboard" && <g>
      {[0, 1, 2].map(i => <g key={i}><rect className={styles.mChip} x={22 + i * 92} y="22" width="82" height="36" rx="8" /><rect className={styles.mLineStrong} x={32 + i * 92} y="32" width={34 + i * 6} height="6" rx="3" /><rect className={styles.mLine} x={32 + i * 92} y="44" width="22" height="5" rx="2.5" /></g>)}
      {[44, 70, 56, 92, 78, 108, 96].map((h, i) => <rect key={i} className={styles.mBar} style={{ animationDelay: `${i * 0.12}s` }} x={26 + i * 40} y={178 - h} width="26" height={h} rx="5" />)}
      <path className={styles.mPath} d="M30 150 C70 120 90 140 130 112 S200 96 240 76 S290 60 296 54" pathLength="1" />
    </g>}
    {kind === "message" && <g>
      <rect className={styles.mChip} x="96" y="14" width="128" height="172" rx="20" />
      <rect className={styles.mLine} x="140" y="22" width="40" height="5" rx="2.5" />
      <g className={styles.mBubbleIn}><rect className={styles.mBubbleA} x="108" y="48" width="86" height="34" rx="10" /><rect className={styles.mLineStrong} x="116" y="58" width="60" height="5" rx="2.5" /><rect className={styles.mLine} x="116" y="68" width="40" height="5" rx="2.5" /></g>
      <g className={styles.mBubbleOut}><rect className={styles.mBubbleB} x="124" y="94" width="92" height="46" rx="10" /><rect className={styles.mLineLight} x="132" y="104" width="66" height="5" rx="2.5" /><rect className={styles.mLineLight} x="132" y="115" width="48" height="5" rx="2.5" /><rect className={styles.mLineLight} x="132" y="126" width="28" height="5" rx="2.5" /></g>
      <path className={styles.mTick} d="M196 150l5 5 9-10" pathLength="1" />
    </g>}
    {kind === "pdf" && <g>
      <rect className={styles.mPageBack} x="96" y="22" width="112" height="152" rx="8" />
      <g className={styles.mPageFront}><rect className={styles.mPage} x="116" y="14" width="112" height="152" rx="8" />
        <rect className={styles.mTag} x="126" y="24" width="30" height="16" rx="4" />
        {[52, 66, 80].map((y, i) => <rect key={y} className={styles.mWipe} style={{ animationDelay: `${0.3 + i * 0.25}s` }} x="126" y={y} width={92 - i * 14} height="6" rx="3" />)}
        {[22, 38, 28, 46].map((h, i) => <rect key={i} className={styles.mBarMini} style={{ animationDelay: `${0.9 + i * 0.15}s` }} x={130 + i * 22} y={154 - h} width="14" height={h} rx="3" />)}
      </g>
    </g>}
    {kind === "present" && <g>
      <rect className={styles.mScreen} x="38" y="22" width="244" height="136" rx="10" />
      <g className={styles.mSlide1}><rect className={styles.mLineStrong} x="62" y="48" width="110" height="10" rx="5" /><rect className={styles.mLine} x="62" y="70" width="150" height="6" rx="3" /><rect className={styles.mLine} x="62" y="84" width="120" height="6" rx="3" /></g>
      <g className={styles.mSlide2}>{[50, 76, 62, 100].map((h, i) => <rect key={i} className={styles.mBar2} x={66 + i * 48} y={138 - h} width="30" height={h} rx="5" />)}</g>
      <g className={styles.mSlide3}><circle className={styles.mRing} cx="160" cy="90" r="34" /><circle className={styles.mRingFill} cx="160" cy="90" r="34" pathLength="1" /></g>
      <rect className={styles.mLine} x="130" y="168" width="60" height="6" rx="3" /><rect className={styles.mLine} x="110" y="180" width="100" height="5" rx="2.5" />
    </g>}
    {kind === "email" && <g>
      <g className={styles.mDoc}><rect className={styles.mPage} x="118" y="30" width="84" height="104" rx="6" /><rect className={styles.mTag} x="128" y="40" width="26" height="14" rx="3" />{[66, 80, 94].map(y => <rect key={y} className={styles.mLine} x="128" y={y} width="64" height="5" rx="2.5" />)}</g>
      <rect className={styles.mEnvBody} x="70" y="96" width="180" height="88" rx="10" />
      <path className={styles.mEnvFlap} d="M72 100 L160 150 L248 100" />
    </g>}
    {kind === "ai" && <g>
      <rect className={styles.mChip} x="28" y="26" width="264" height="148" rx="12" />
      <path className={styles.mSpark} d="M52 52 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" />
      {[0, 1, 2, 3].map(i => <rect key={i} className={styles.mType} style={{ animationDelay: `${i * 0.7}s`, width: [190, 214, 170, 120][i] }} x="48" y={82 + i * 20} height="7" rx="3.5" />)}
    </g>}
    {kind === "portal" && <g>
      <rect className={styles.mScreen} x="30" y="22" width="260" height="156" rx="10" />
      <rect className={styles.mLine} x="44" y="34" width="60" height="6" rx="3" />
      <circle className={styles.mRing} cx="86" cy="104" r="30" /><circle className={styles.mRingFill} cx="86" cy="104" r="30" pathLength="1" />
      {[0, 1, 2].map(i => <g key={i}><rect className={styles.mLineStrong} x="146" y={78 + i * 24} width={110 - i * 18} height="7" rx="3.5" /><rect className={styles.mLine} x="146" y={90 + i * 24} width="60" height="5" rx="2.5" /></g>)}
    </g>}
    {kind === "schedule" && <g>
      {Array.from({ length: 28 }, (_, i) => <rect key={i} className={[3, 10, 17, 24].includes(i) ? styles.mDayOn : styles.mDay} style={[3, 10, 17, 24].includes(i) ? { animationDelay: `${[3, 10, 17, 24].indexOf(i) * 0.5}s` } : undefined} x={26 + (i % 7) * 38} y={26 + Math.floor(i / 7) * 38} width="30" height="30" rx="7" />)}
    </g>}
  </svg>;
}
