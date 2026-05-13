import { useState, useEffect } from "react";
import Lottie from "lottie-react";

// Well-known free LottieFiles CDN animations
export const LOTTIE_URLS = {
  celebration:  "https://assets5.lottiefiles.com/packages/lf20_obhph3t0.json",
  stars:        "https://assets4.lottiefiles.com/packages/lf20_jbrw3hcz.json",
  thinking:     "https://assets3.lottiefiles.com/packages/lf20_szlepvdh.json",
  checkmark:    "https://assets9.lottiefiles.com/packages/lf20_j1adxtyb.json",
  study:        "https://assets6.lottiefiles.com/packages/lf20_ystsffqy.json",
  trophy:       "https://assets2.lottiefiles.com/packages/lf20_touohxv0.json",
  fire:         "https://assets7.lottiefiles.com/packages/lf20_xlmz9xwm.json",
  rocket:       "https://assets1.lottiefiles.com/packages/lf20_jTT4ZD.json",
  confetti:     "https://assets8.lottiefiles.com/packages/lf20_rcXEHS.json",
  brain:        "https://assets10.lottiefiles.com/packages/lf20_kq5rGs.json",
} as const;

interface Props {
  src: string;            // URL to Lottie JSON
  fallback?: string;      // emoji or text shown if load fails
  loop?: boolean;
  autoplay?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function LottiePlayer({
  src,
  fallback = "✨",
  loop = true,
  autoplay = true,
  style,
  className,
}: Props) {
  const [animData, setAnimData] = useState<object | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) { setFailed(true); return; }
    setAnimData(null);
    setFailed(false);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000); // 4s timeout
    fetch(src, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error("not ok");
        return r.json();
      })
      .then(setAnimData)
      .catch(() => setFailed(true))
      .finally(() => clearTimeout(timer));
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [src]);

  if (failed) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
          animation: "lp-pulse 2s ease-in-out infinite",
          ...style,
        }}
      >
        {fallback}
      </span>
    );
  }

  if (!animData) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 32,
          opacity: 0.4,
          animation: "lp-pulse 1.2s ease-in-out infinite",
          ...style,
        }}
      >
        {fallback}
      </span>
    );
  }

  return (
    <Lottie
      animationData={animData}
      loop={loop}
      autoplay={autoplay}
      className={className}
      style={style}
    />
  );
}
