import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import type { FaqItem, HomeHighlightsResponse } from '../../types/kazi';
import { HomeHeroSection } from '../home/HomeHeroSection';
import { HomeCategoriesSection } from '../home/HomeCategoriesSection';
import { HomeProsAndJourneySection } from '../home/HomeProsAndJourneySection';
import { HomePillarsSection } from '../home/HomePillarsSection';
import { HomeTrustFaqSection } from '../home/HomeTrustFaqSection';

export const ClientHomeModule: React.FC = () => {
  const [highlights, setHighlights] = useState<HomeHighlightsResponse | null>(null);
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<HomeHighlightsResponse>('/api/home/highlights').catch(() => null),
      apiFetch<{ items: FaqItem[] }>('/api/faq').catch(() => ({ items: [] })),
    ]).then(([hl, faq]) => {
      if (!active) return;
      if (hl) setHighlights(hl);
      if (faq?.items) setFaqItems(faq.items);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="bg-[#FAF7F0] text-[#23343B] pb-16 md:pb-6">
      <HomeHeroSection />
      <HomeCategoriesSection homeCategories={highlights?.homeCategories} />
      <HomeProsAndJourneySection />
      <HomePillarsSection countryStats={highlights?.countryStats} />
      <HomeTrustFaqSection
        testimonials={highlights?.testimonials || []}
        faqItems={faqItems}
      />
    </div>
  );
};
