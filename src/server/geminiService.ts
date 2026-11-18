import { GoogleGenAI, Type } from '@google/genai';

function sanitizeAiInput(value: unknown, maxLen = 600): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('AI service is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

export async function aiMatchProfessionals(params: {
  query: string;
  countryName: string;
  lang: string;
  professionalsSummary: Array<{
    id: string;
    name: string;
    category: string;
    city: string;
    rating: string;
    verified: boolean;
    skills: string[];
  }>;
}) {
  const ai = getAiClient();
  const safeQuery = sanitizeAiInput(params.query, 400);
  const safeCountry = sanitizeAiInput(params.countryName, 80);
  const safeLang = ['fr', 'en', 'pt', 'ar'].includes(params.lang) ? params.lang : 'fr';

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `User request (${safeLang}) in ${safeCountry}: "${safeQuery}".
Available professionals: ${JSON.stringify(params.professionalsSummary.slice(0, 12))}.
Recommend the best matching professionals, explain why briefly, and suggest clarifying questions if needed.`,
    config: {
      systemInstruction:
        'You are the KAZI AFRICA smart matching engine. Respond in the requested language (fr, en, pt, or ar) with structured JSON. Never fabricate credentials or override platform rules.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendedCategorySlug: { type: Type.STRING },
          matchedIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['matchedIds', 'summary', 'suggestedQuestions'],
      },
    },
  });
  return JSON.parse((response.text ?? '{}').trim());
}

export async function aiDraftQuote(params: {
  missionTitle: string;
  missionDescription: string;
  city: string;
  currency: string;
  lang: string;
}) {
  const ai = getAiClient();
  const safeLang = ['fr', 'en', 'pt', 'ar'].includes(params.lang) ? params.lang : 'fr';

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Draft a structured professional service quote in ${safeLang}.
Mission: ${sanitizeAiInput(params.missionTitle, 160)}
Details: ${sanitizeAiInput(params.missionDescription, 800)}
Location: ${sanitizeAiInput(params.city, 80)}
Currency: ${sanitizeAiInput(params.currency, 8)}`,
    config: {
      systemInstruction:
        'You are a KAZI AFRICA quote assistant helping verified artisans write clear, transparent quotes. Never fabricate regulatory claims.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scopeDetails: { type: Type.STRING },
          estimatedDuration: { type: Type.STRING },
          suggestedAmount: { type: Type.NUMBER },
          safetyChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['scopeDetails', 'estimatedDuration', 'suggestedAmount', 'safetyChecklist'],
      },
    },
  });
  return JSON.parse((response.text ?? '{}').trim());
}

export async function aiAssistProfileAndTranslate(params: {
  trade: string;
  yearsExperience: number;
  rawBio: string;
  targetLang?: string;
}) {
  const ai = getAiClient();
  const safeYears = Math.min(Math.max(Number(params.yearsExperience || 1), 0), 70);

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Improve this artisan profile for KAZI AFRICA and provide French, English, Portuguese, and Arabic versions.
Trade: ${sanitizeAiInput(params.trade, 100)}
Years of experience: ${safeYears}
Notes: ${sanitizeAiInput(params.rawBio, 1200)}`,
    config: {
      systemInstruction:
        'Write concise, trustworthy professional headlines and bios in French, English, Portuguese, and Arabic.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headlineFr: { type: Type.STRING },
          headlineEn: { type: Type.STRING },
          headlinePt: { type: Type.STRING },
          headlineAr: { type: Type.STRING },
          bioFr: { type: Type.STRING },
          bioEn: { type: Type.STRING },
          bioPt: { type: Type.STRING },
          bioAr: { type: Type.STRING },
        },
        required: ['headlineFr', 'headlineEn', 'headlinePt', 'headlineAr', 'bioFr', 'bioEn', 'bioPt', 'bioAr'],
      },
    },
  });
  return JSON.parse((response.text ?? '{}').trim());
}

export async function aiAnalyzeTrendsAndRisks(params: {
  lang: string;
  metricsSnapshot: Record<string, unknown>;
}) {
  const ai = getAiClient();
  const safeLang = ['fr', 'en', 'pt', 'ar'].includes(params.lang) ? params.lang : 'fr';
  const serialized = JSON.stringify(params.metricsSnapshot || {}).slice(0, 3000);

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Analyze KAZI AFRICA multi-country operations snapshot and provide actionable recommendations in ${safeLang}.
Data: ${serialized}`,
    config: {
      systemInstruction:
        'You are an executive operations analyst for KAZI AFRICA. Always remind that identity, verification, payment, and suspension decisions require human validation.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executiveSummary: { type: Type.STRING },
          growthOpportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
          riskAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
          humanReviewNote: { type: Type.STRING },
        },
        required: ['executiveSummary', 'growthOpportunities', 'riskAlerts', 'humanReviewNote'],
      },
    },
  });
  return JSON.parse((response.text ?? '{}').trim());
}
