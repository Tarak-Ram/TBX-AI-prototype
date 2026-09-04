import { GoogleGenAI, Type } from '@google/genai';
import { FinancialIntent } from './types';

let genAIClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (genAIClient) return genAIClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY environment variable is missing.');
    return null;
  }
  genAIClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return genAIClient;
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// Fallback rule-based intent parser for instant robustness
function ruleBasedIntentParser(question: string): FinancialIntent {
  const qLower = question.toLowerCase();

  // Operation detection
  let operation: FinancialIntent['operation'] = 'sum';
  if (qLower.includes('compare') || qLower.includes('versus') || qLower.includes(' vs ')) {
    operation = 'comparison';
  } else if (qLower.includes('top') || qLower.includes('rank') || qLower.includes('highest') || qLower.includes('biggest spend')) {
    operation = 'ranking';
  } else if (qLower.includes('how many') || qLower.includes('count') || qLower.includes('number of')) {
    operation = 'count';
  } else if (qLower.includes('list') || qLower.includes('show all') || qLower.includes('transactions behind')) {
    operation = 'list';
  } else if (qLower.includes('breakdown') || qLower.includes('group by') || qLower.includes('category wise')) {
    operation = 'group_by';
  }

  // Known vendors in dataset
  const knownVendors = [
    'Acme Corp',
    'XYZ Logistics',
    'CloudScale Systems',
    'Alpha Security',
    'TechFlow Solutions',
    'Apex Travel',
    'OfficeSphere',
    'Delta Marketing',
    'Global Legal Advisors',
  ];

  let matchedVendor: string | null = null;
  let comparisonVendor: string | null = null;

  for (const v of knownVendors) {
    if (qLower.includes(v.toLowerCase())) {
      if (!matchedVendor) {
        matchedVendor = v;
      } else if (!comparisonVendor) {
        comparisonVendor = v;
      }
    }
  }

  // Known categories
  const knownCategories = [
    'Hardware & Infrastructure',
    'Hardware',
    'Supply Chain',
    'Cloud Services',
    'Cybersecurity',
    'Software',
    'Travel',
    'Office Supplies',
    'Marketing',
    'Legal',
  ];

  let matchedCategory: string | null = null;
  for (const c of knownCategories) {
    if (qLower.includes(c.toLowerCase())) {
      matchedCategory = c;
      break;
    }
  }

  // Status detection
  let matchedStatus: string | null = null;
  if (qLower.includes('unreconciled') || qLower.includes('pending')) {
    matchedStatus = 'Unreconciled';
  } else if (qLower.includes('reconciled')) {
    matchedStatus = 'Reconciled';
  }

  // Date detection
  let dateLabel: string | null = null;
  if (qLower.includes('august 2026') || qLower.includes('aug 2026') || qLower.includes('august')) {
    dateLabel = 'August 2026';
  } else if (qLower.includes('july 2026') || qLower.includes('jul 2026') || qLower.includes('july')) {
    dateLabel = 'July 2026';
  } else if (qLower.includes('june 2026') || qLower.includes('jun 2026') || qLower.includes('june')) {
    dateLabel = 'June 2026';
  } else if (qLower.includes('q3')) {
    dateLabel = 'Q3 2026';
  } else if (qLower.includes('q2')) {
    dateLabel = 'Q2 2026';
  } else if (qLower.includes('2026')) {
    dateLabel = '2026';
  }

  return {
    domain: matchedStatus ? 'reconciliation' : matchedVendor ? 'vendor_payouts' : 'transactions',
    operation,
    metric: operation === 'count' ? 'transaction_count' : 'amount',
    vendor: matchedVendor,
    category: matchedCategory,
    status: matchedStatus,
    date_label: dateLabel,
    group_by: operation === 'group_by' ? (matchedCategory ? 'vendor' : 'category') : null,
    comparison_period: null,
    comparison_vendor: comparisonVendor,
    limit: operation === 'ranking' ? 5 : null,
  };
}

async function callWithTimeout<T>(promise: Promise<T>, ms: number, fallbackValue: T): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallbackValue);
    }, ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch {
    clearTimeout(timer!);
    return fallbackValue;
  }
}

export async function extractFinancialIntent(question: string): Promise<FinancialIntent> {
  const fallback = ruleBasedIntentParser(question);
  const client = getGeminiClient();
  if (!client) {
    return fallback;
  }

  const geminiPromise = (async (): Promise<FinancialIntent> => {
    try {
      const prompt = `You are a Natural Language Financial Query Compiler.
Translate the user's financial question into a strictly structured JSON object.

RULES:
1. NEVER compute calculations, totals, or financial sums. The database executes them deterministically.
2. Domain must be: "transactions", "vendor_payouts", or "reconciliation".
3. Operation must be: "sum", "count", "list", "ranking", "group_by", or "comparison".
4. Extract vendor names (e.g. "Acme Corp", "XYZ Logistics", "CloudScale Systems", "Alpha Security", etc.) into "vendor".
5. If comparison ("Acme vs XYZ"), put second vendor into "comparison_vendor".
6. Extract date phrases ("August 2026", "July 2026", "Q2", "Q3", "2026") into "date_label".
7. Extract status ("Reconciled", "Unreconciled") into "status".
8. Extract category ("Cloud Services", "Travel", "Cybersecurity", "Supply Chain", etc.) into "category".

Question: "${question}"`;

      const response = await client.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              domain: { type: Type.STRING },
              operation: { type: Type.STRING },
              metric: { type: Type.STRING },
              vendor: { type: Type.STRING },
              category: { type: Type.STRING },
              status: { type: Type.STRING },
              date_label: { type: Type.STRING },
              group_by: { type: Type.STRING },
              comparison_vendor: { type: Type.STRING },
              comparison_period: { type: Type.STRING },
              limit: { type: Type.INTEGER },
            },
            required: ['domain', 'operation', 'metric'],
          },
        },
      });

      const text = response.text?.trim();
      if (!text) return fallback;

      const parsed = JSON.parse(text) as FinancialIntent;
      return {
        domain: ['transactions', 'vendor_payouts', 'reconciliation'].includes(parsed.domain) ? parsed.domain : fallback.domain,
        operation: ['sum', 'count', 'list', 'ranking', 'group_by', 'comparison'].includes(parsed.operation) ? parsed.operation : fallback.operation,
        metric: parsed.metric === 'transaction_count' ? 'transaction_count' : 'amount',
        vendor: parsed.vendor || fallback.vendor,
        category: parsed.category || fallback.category,
        status: parsed.status || fallback.status,
        date_label: parsed.date_label || fallback.date_label,
        group_by: parsed.group_by || fallback.group_by,
        comparison_period: parsed.comparison_period || fallback.comparison_period,
        comparison_vendor: parsed.comparison_vendor || fallback.comparison_vendor,
        limit: parsed.limit || (parsed.operation === 'ranking' ? 5 : null),
      };
    } catch (error) {
      console.warn('Gemini intent extraction fell back:', error);
      return fallback;
    }
  })();

  return callWithTimeout(geminiPromise, 4500, fallback);
}

export async function generateExplanation(
  question: string,
  intent: FinancialIntent,
  calculationDesc: string,
  totalAmount: number,
  recordCount: number,
  breakdown: Array<{ entity: string; amount: number; count: number }>
): Promise<string> {
  const formattedINR = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(totalAmount);

  // Deterministic baseline template
  let fallbackAnswer = '';
  if (intent.operation === 'count') {
    fallbackAnswer = `There are ${recordCount} recorded transactions matching your criteria.`;
  } else if (intent.operation === 'ranking') {
    const top = breakdown[0];
    fallbackAnswer = `The top vendor by spend is ${top?.entity || 'None'} with ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(top?.amount || 0)} across ${top?.count || 0} transactions.`;
  } else if (intent.operation === 'comparison') {
    const bA = breakdown[0];
    const bB = breakdown[1];
    const amtA = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(bA?.amount || 0);
    const amtB = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(bB?.amount || 0);
    fallbackAnswer = `${bA?.entity || 'First entity'} totaled ${amtA} across ${bA?.count || 0} transactions compared to ${bB?.entity || 'Second entity'} at ${amtB} across ${bB?.count || 0} transactions.`;
  } else {
    const entityPart = intent.vendor ? `for ${intent.vendor}` : intent.category ? `for ${intent.category}` : intent.status ? `for ${intent.status} transactions` : 'total spend';
    const periodPart = intent.date_label ? ` in ${intent.date_label}` : '';
    fallbackAnswer = `The verified ${entityPart}${periodPart} is ${formattedINR} calculated across ${recordCount} supporting transactions.`;
  }

  const client = getGeminiClient();
  if (!client) {
    return fallbackAnswer;
  }

  const geminiPromise = (async (): Promise<string> => {
    try {
      const prompt = `You are an objective, professional financial assistant.
Explain this verified financial calculation result clearly, authoritatively, and concisely in 1-2 sentences.

CRITICAL RULES:
1. ONLY cite the exact numbers provided below. NEVER invent, extrapolate, or estimate figures.
2. Always format currency figures with the Indian Rupee symbol (₹).
3. Mention the total amount, the number of records (${recordCount}), and the period if applicable.

User Question: "${question}"
Calculation Formula: ${calculationDesc}
Total Amount: ${totalAmount} (${formattedINR})
Record Count: ${recordCount}
Period: ${intent.date_label || 'All recorded periods'}
Breakdown: ${JSON.stringify(breakdown.slice(0, 3))}

Write a crisp, professional 1-2 sentence answer:`;

      const response = await client.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
      });

      const text = response.text?.trim();
      return text || fallbackAnswer;
    } catch (err) {
      console.warn('Gemini explanation synthesis failed, using deterministic template:', err);
      return fallbackAnswer;
    }
  })();

  return callWithTimeout(geminiPromise, 4500, fallbackAnswer);
}
