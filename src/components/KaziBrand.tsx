import React from 'react';
import {
  KAZI_BRAND,
  type KaziBrandSize,
  type KaziBrandTheme,
  type KaziBrandVariant,
} from '../config/brand';

export interface KaziBrandProps {
  variant?: KaziBrandVariant;
  theme?: KaziBrandTheme;
  size?: KaziBrandSize;
  /** Optional: renders symbol on <640px screens and horizontal lockup on sm+ screens */
  responsiveMobileSymbol?: boolean;
  /** Optional accessible title or descriptor tooltip */
  title?: string;
  className?: string;
  imgClassName?: string;
  alt?: string;
}

const HEIGHT_CLASSES: Record<KaziBrandVariant, Record<KaziBrandSize, string>> = {
  full: {
    xs: 'h-10',
    sm: 'h-12',
    md: 'h-16 sm:h-20',
    lg: 'h-20 sm:h-24',
    xl: 'h-24 sm:h-32',
  },
  compact: {
    xs: 'h-7',
    sm: 'h-9 sm:h-10',
    md: 'h-11 sm:h-12',
    lg: 'h-14 sm:h-16',
    xl: 'h-16 sm:h-20',
  },
  mono: {
    xs: 'h-7',
    sm: 'h-9 sm:h-10',
    md: 'h-11 sm:h-12',
    lg: 'h-14 sm:h-16',
    xl: 'h-16 sm:h-20',
  },
  symbol: {
    xs: 'h-6 w-6',
    sm: 'h-8 w-8',
    md: 'h-11 w-11',
    lg: 'h-14 w-14',
    xl: 'h-20 w-20',
  },
};

const ASPECT_CLASSES: Record<KaziBrandVariant, string> = {
  full: 'aspect-[1438/810]',
  compact: 'aspect-[1438/680]',
  mono: 'aspect-[1438/680]',
  symbol: 'aspect-square',
};

function resolveAssetSrc(variant: KaziBrandVariant, theme: KaziBrandTheme): string {
  if (variant === 'mono') return KAZI_BRAND.assets.mono;
  if (variant === 'full') {
    return theme === 'dark' ? KAZI_BRAND.assets.fullDark : KAZI_BRAND.assets.fullLight;
  }
  if (variant === 'symbol') {
    return theme === 'dark' ? KAZI_BRAND.assets.symbolDark : KAZI_BRAND.assets.symbolLight;
  }
  return theme === 'dark' ? KAZI_BRAND.assets.compactDark : KAZI_BRAND.assets.compactLight;
}

export const KaziBrand: React.FC<KaziBrandProps> = ({
  variant = 'compact',
  theme = 'light',
  size = 'md',
  responsiveMobileSymbol = false,
  title = KAZI_BRAND.alt,
  className = '',
  imgClassName = '',
  alt = KAZI_BRAND.alt,
}) => {
  const mainSrc = resolveAssetSrc(variant, theme);
  const symbolSrc = resolveAssetSrc('symbol', theme);
  const mainSizeCls = HEIGHT_CLASSES[variant][size];
  const symbolSizeCls = HEIGHT_CLASSES.symbol[size];

  return (
    <span
      dir="ltr"
      title={title}
      className={`inline-flex items-center shrink-0 select-none ${className}`}
    >
      {responsiveMobileSymbol && variant !== 'symbol' ? (
        <>
          <img
            src={symbolSrc}
            alt={alt}
            decoding="async"
            draggable={false}
            className={`sm:hidden w-auto max-w-none object-contain shrink-0 pointer-events-none ${symbolSizeCls} ${ASPECT_CLASSES.symbol} ${imgClassName}`}
          />
          <img
            src={mainSrc}
            alt={alt}
            decoding="async"
            draggable={false}
            className={`hidden sm:block w-auto max-w-none object-contain shrink-0 pointer-events-none ${mainSizeCls} ${ASPECT_CLASSES[variant]} ${imgClassName}`}
          />
        </>
      ) : (
        <img
          src={mainSrc}
          alt={alt}
          decoding="async"
          draggable={false}
          className={`w-auto max-w-none object-contain shrink-0 pointer-events-none ${mainSizeCls} ${ASPECT_CLASSES[variant]} ${imgClassName}`}
        />
      )}
    </span>
  );
};
