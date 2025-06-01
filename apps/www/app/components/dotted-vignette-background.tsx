import { motion, useScroll, useTransform } from 'framer-motion';
import React, { useMemo } from 'react';

interface DottedBackgroundProps {
  // Style props
  dotColor?: string;
  backgroundColor?: string;
  dotSize?: number;
  dotSpacing?: number;

  // Effects props
  enableVignette?: boolean;
  vignetteColor?: string;
  enableInnerGlow?: boolean;
  innerGlowColor?: string;

  // Container props
  className?: string;
  style?: React.CSSProperties;
}

const DottedBackground: React.FC<DottedBackgroundProps> = ({
  dotColor = '#215769',
  backgroundColor = 'transparent',
  dotSize = 2,
  dotSpacing = 10,
  enableVignette = true,
  vignetteColor = 'rgb(0,0,0)',
  enableInnerGlow = true,
  innerGlowColor = 'rgb(0,0,0)',
  className = '',
  style = {},
}) => {
  const { scrollY } = useScroll();
  const ids = useMemo(() => {
    const baseId = `dotted-bg-${Math.random().toString(36).substr(2, 9)}`;
    return {
      pattern: `${baseId}-pattern`,
      vignette: `${baseId}-vignette`,
      innerGlow: `${baseId}-inner-glow`,
    };
  }, []);

  // Create animations that make the pattern move downward and disappear
  const translateY = useTransform(
    scrollY,
    [0, 300, 600],
    [0, 200, 500], // Move downward more aggressively
  );

  // Move left instead of right
  const translateX = useTransform(
    scrollY,
    [0, 300, 600],
    [0, -20, -50], // changed to negative to shift toward bottom-left
  );

  // Rotate slightly as it moves down
  const rotate = useTransform(scrollY, [0, 600], [0, 15]);

  // Gradually fade out
  const opacity = useTransform(scrollY, [0, 200, 500], [1, 0.5, 0]);

  return (
    <div className={`h-full w-full ${className}`} style={style}>
      <motion.svg
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Pattern */}
          <pattern
            id={ids.pattern}
            x="0"
            y="0"
            width={dotSpacing}
            height={dotSpacing}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={dotSpacing / 2}
              cy={dotSpacing / 2}
              r={dotSize}
              fill={dotColor}
            />
          </pattern>

          {/* Vignette Gradient */}
          {enableVignette && (
            <radialGradient
              id={ids.vignette}
              cx="50%"
              cy="50%"
              r="50%"
              fx="50%"
              fy="50%"
            >
              <stop offset="40%" stopColor={vignetteColor} stopOpacity="0" />
              <stop offset="100%" stopColor={vignetteColor} stopOpacity="1" />
            </radialGradient>
          )}

          {/* Inner Glow Gradient */}
          {enableInnerGlow && (
            <radialGradient
              id={ids.innerGlow}
              cx="50%"
              cy="50%"
              r="50%"
              fx="50%"
              fy="50%"
            >
              <stop offset="50%" stopColor={innerGlowColor} stopOpacity="0.7" />
              <stop offset="100%" stopColor={innerGlowColor} stopOpacity="0" />
            </radialGradient>
          )}
        </defs>

        {/* Background and Pattern Group with Framer Motion */}
        <motion.g
          style={{
            translateX,
            translateY,
            rotate,
            opacity,
            originX: '50%',
            originY: '50%',
          }}
        >
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={backgroundColor}
            stroke="none"
          />
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={`url(#${ids.pattern})`}
            stroke="none"
          />
        </motion.g>

        {/* Vignette */}
        {enableVignette && (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={`url(#${ids.vignette})`}
            stroke="none"
          />
        )}

        {/* Inner Glow */}
        {enableInnerGlow && (
          <circle
            cx="50%"
            cy="50%"
            r="25%"
            fill={`url(#${ids.innerGlow})`}
            stroke="none"
          />
        )}
      </motion.svg>
    </div>
  );
};

export { DottedBackground };
