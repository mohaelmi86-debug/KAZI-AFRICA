import React from 'react';
import { KAZI_BRAND } from '../config/brand';
import { AFRICAN_COUNTRIES_54 } from '../data/africanCountries';
import { TRANSLATIONS, type LangCode } from '../i18n/translations';
import type { CountryRecord } from '../types/kazi';

interface AfricaInteractiveMapProps {
  countries: CountryRecord[];
  selectedIso2: string;
  onSelectCountry: (iso2: string) => void;
  lang: LangCode;
  variant?: 'default' | 'homepageCompact';
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#087F70',
  TESTING: '#E9B66B',
  CONFIGURING: '#0284C7',
  PLANNED: '#94A3B8',
  SUSPENDED: '#DC2626',
};

// Equirectangular projection tuned for Africa (-26..60 lng, -36..38 lat)
function projectPoint(lat: number, lng: number) {
  const x = ((lng + 26) / 86) * 520 + 20;
  const y = ((38 - lat) / 74) * 520 + 20;
  return { x, y };
}

export const AfricaInteractiveMap: React.FC<AfricaInteractiveMapProps> = ({
  countries,
  selectedIso2,
  onSelectCountry,
  lang,
  variant = 'default',
}) => {
  const statusMap = new Map(countries.map((c) => [c.iso2, c]));
  const dict = TRANSLATIONS[lang];

  if (variant === 'homepageCompact') {
    return (
      <div className="relative w-full aspect-square max-w-[230px] mx-auto select-none">
        <svg viewBox="0 0 560 560" className="w-full h-full" role="img" aria-label={dict.map.title}>
          <path
            d="M155,75 L220,58 L305,68 L372,88 L405,135 L438,190 L478,210 L460,260 L415,315 L395,380 L355,445 L312,492 L278,478 L260,415 L240,340 L215,275 L165,245 L108,235 L78,195 L92,135 Z"
            fill="#087F70"
            fillOpacity="0.92"
            stroke="#FAF7F0"
            strokeWidth="4"
          />
          <path
            d="M442,360 L468,350 L462,420 L435,435 L425,390 Z"
            fill="#087F70"
            fillOpacity="0.92"
            stroke="#FAF7F0"
            strokeWidth="4"
          />
          {AFRICAN_COUNTRIES_54.map((seed) => {
            const live = statusMap.get(seed.iso2);
            const status = live?.status || seed.status;
            const { x, y } = projectPoint(seed.lat, seed.lng);
            const isSelected = selectedIso2 === seed.iso2;
            const isHighlighted = status === 'ACTIVE' || status === 'TESTING' || isSelected;
            return (
              <g key={seed.iso2} onClick={() => onSelectCountry(seed.iso2)} className="cursor-pointer">
                {isSelected && <circle cx={x} cy={y} r={14} fill="none" stroke="#E9B66B" strokeWidth={3} />}
                <circle
                  cx={x}
                  cy={y}
                  r={isHighlighted ? 8 : 4.5}
                  fill={status === 'ACTIVE' ? '#E9B66B' : status === 'TESTING' ? '#FFFFFF' : '#102D3A'}
                  fillOpacity={isHighlighted ? 1 : 0.45}
                  stroke="#FFFFFF"
                  strokeWidth={isHighlighted ? 1.8 : 0.8}
                />
                <title>{`${lang === 'ar' ? seed.nameAr : lang === 'en' ? seed.nameEn : lang === 'pt' ? seed.namePt : seed.nameFr} (${seed.iso2}) — ${dict.statuses[status] || status}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-base font-bold text-[#102D3A]">
            {dict.map.title}
          </h3>
          <p className="text-xs text-slate-500">
            {dict.map.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
              <span>{dict.statuses[status] || status}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative w-full aspect-[4/3] max-h-[440px] bg-[#FAF7F0] rounded-lg border border-slate-200 overflow-hidden">
        <svg viewBox="0 0 560 560" className="w-full h-full">
          {/* Simplified African continent & Madagascar silhouette */}
          <path
            d="M155,75 L220,58 L305,68 L372,88 L405,135 L438,190 L478,210 L460,260 L415,315 L395,380 L355,445 L312,492 L278,478 L260,415 L240,340 L215,275 L165,245 L108,235 L78,195 L92,135 Z"
            fill="#E2E8F0"
            stroke="#CBD5E1"
            strokeWidth="2"
          />
          <path
            d="M442,360 L468,350 L462,420 L435,435 L425,390 Z"
            fill="#E2E8F0"
            stroke="#CBD5E1"
            strokeWidth="2"
          />

          {/* 54 Country interactive nodes */}
          {AFRICAN_COUNTRIES_54.map((seed) => {
            const live = statusMap.get(seed.iso2);
            const status = live?.status || seed.status;
            const color = STATUS_COLORS[status] || '#94A3B8';
            const { x, y } = projectPoint(seed.lat, seed.lng);
            const isSelected = selectedIso2 === seed.iso2;
            const label =
              lang === 'ar'
                ? seed.nameAr
                : lang === 'en'
                ? seed.nameEn
                : lang === 'pt'
                ? seed.namePt
                : seed.nameFr;

            return (
              <g
                key={seed.iso2}
                onClick={() => onSelectCountry(seed.iso2)}
                className="cursor-pointer group"
              >
                {isSelected && (
                  <circle cx={x} cy={y} r={14} fill="none" stroke={KAZI_BRAND.palette.navy} strokeWidth={2.5} />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={status === 'ACTIVE' ? 8 : isSelected ? 8 : 6}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
                <title>{`${label} (${seed.iso2}) — ${status}`}</title>
                {(status === 'ACTIVE' || status === 'TESTING' || isSelected) && (
                  <text
                    x={x + 10}
                    y={y + 4}
                    fontSize="10"
                    fontWeight="700"
                    fill="#102D3A"
                    className="select-none pointer-events-none"
                  >
                    {seed.iso2}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
