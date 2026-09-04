import { GoogleGenAI, Type } from '@google/genai';
import { FinancialIntent, BreakdownItem } from './types';

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

export interface DatasetContext {
  vendors?: string[];
  categories?: string[];
  statuses?: string[];
  dateRange?: { minDate: string; maxDate: string } | null;
}

// Fallback rule-based intent parser adapting dynamically to uploaded data
function ruleBasedIntentParser(question: string, context?: DatasetContext): FinancialIntent {
  const qLower = question.toLowerCase();

  const onlyAmount =
    qLower.includes('only amount') ||
    qLower.includes('only the amount') ||
    qLower.includes('show me only amount') ||
    qLower.includes('amount only') ||
    qLower.includes('just the amount') ||
    qLower.includes('just amount') ||
    qLower.includes('only value') ||
    qLower.includes('value only');

  const userRequestedTable =
    qLower.includes('show table') ||
    qLower.includes('display table') ||
    qLower.includes('in a table') ||
    qLower.includes('in table') ||
    qLower.includes('as a table') ||
    qLower.includes('as table') ||
    qLower.includes('table format') ||
    qLower.includes('tabular') ||
    qLower.includes('table view') ||
    qLower.includes('show me table') ||
    qLower.includes('table please') ||
    qLower.includes('with table');

  // Operation detection
  let operation: FinancialIntent['operation'] = 'sum';
  let rankingTarget: FinancialIntent['ranking_target'] = null;
  let limit: number | null = null;

  if (
    qLower.includes('category name') ||
    qLower.includes('categories only') ||
    qLower.includes('category only') ||
    qLower.includes('list categories') ||
    qLower.includes('what are the categories') ||
    qLower.includes('show categories') ||
    qLower.includes('show category') ||
    qLower.includes('category list') ||
    qLower.includes('distinct categories') ||
    qLower.includes('all categories') ||
    (qLower.includes('category') && (qLower.includes('only') || qLower.includes('show') || qLower.includes('name')))
  ) {
    operation = 'list_categories';
  } else if (
    qLower.includes('vendor name') ||
    qLower.includes('vendors only') ||
    qLower.includes('vendor only') ||
    qLower.includes('list vendors') ||
    qLower.includes('what are the vendors') ||
    qLower.includes('show vendors') ||
    qLower.includes('show vendor') ||
    qLower.includes('vendor list') ||
    qLower.includes('distinct vendors') ||
    qLower.includes('all vendors') ||
    (qLower.includes('vendor') && (qLower.includes('only') || qLower.includes('name')))
  ) {
    operation = 'list_vendors';
  } else if (qLower.includes('compare') || qLower.includes('versus') || qLower.includes(' vs ')) {
    operation = 'comparison';
  } else if (
    // MAX / Highest transaction
    qLower.includes('highest transaction') ||
    qLower.includes('highest transactions') ||
    qLower.includes('highest amount') ||
    qLower.includes('maximum transaction') ||
    qLower.includes('max transaction') ||
    qLower.includes('largest transaction') ||
    qLower.includes('biggest transaction') ||
    qLower.includes('max amount') ||
    qLower.includes('maximum amount') ||
    qLower.includes('most expensive transaction') ||
    (qLower.includes('which is highest') && !qLower.includes('vendor')) ||
    (qLower.includes('highest') && (qLower.includes('transaction') || qLower.includes('amount') || qLower.includes('spend')))
  ) {
    const topNumMatch = qLower.match(/\b(?:top|highest|largest|biggest)\s+(\d+)\s+transactions?\b/);
    if (topNumMatch && parseInt(topNumMatch[1], 10) > 1) {
      operation = 'ranking';
      rankingTarget = 'transactions';
      limit = parseInt(topNumMatch[1], 10);
    } else {
      operation = 'max';
      limit = 1;
    }
  } else if (
    // MIN / Lowest transaction
    qLower.includes('lowest transaction') ||
    qLower.includes('lowest transactions') ||
    qLower.includes('lowest amount') ||
    qLower.includes('minimum transaction') ||
    qLower.includes('min transaction') ||
    qLower.includes('smallest transaction') ||
    qLower.includes('smallest amount') ||
    qLower.includes('min amount') ||
    qLower.includes('minimum amount') ||
    qLower.includes('cheapest transaction') ||
    (qLower.includes('which is lowest') && !qLower.includes('vendor')) ||
    (qLower.includes('lowest') && (qLower.includes('transaction') || qLower.includes('amount')))
  ) {
    operation = 'min';
    limit = 1;
  } else if (
    // AVG / Mean
    qLower.includes('average transaction') ||
    qLower.includes('average amount') ||
    qLower.includes('mean transaction') ||
    qLower.includes('avg transaction') ||
    qLower.includes('average spend') ||
    qLower.includes('average of transactions')
  ) {
    operation = 'avg';
  } else if (
    qLower.includes('top') ||
    qLower.includes('rank') ||
    qLower.includes('highest') ||
    qLower.includes('biggest spend') ||
    qLower.includes('largest')
  ) {
    operation = 'ranking';
    const topNumMatch = qLower.match(/\b(?:top|first|rank)\s+(\d+)\b/);
    limit = topNumMatch ? parseInt(topNumMatch[1], 10) : 5;
    if (qLower.includes('transaction')) {
      rankingTarget = 'transactions';
    } else if (qLower.includes('category')) {
      rankingTarget = 'categories';
    } else {
      rankingTarget = 'vendors';
    }
  } else if (qLower.includes('how many') || qLower.includes('count') || qLower.includes('number of')) {
    operation = 'count';
  } else if (
    qLower.includes('list') ||
    qLower.includes('show all') ||
    qLower.includes('transactions behind') ||
    qLower.includes('details')
  ) {
    operation = 'list';
  } else if (qLower.includes('breakdown') || qLower.includes('group by') || qLower.includes('category wise') || qLower.includes('distribution')) {
    operation = 'group_by';
  }

  // Dynamic vendor matching from active dataset with fuzzy/stripped handling
  const activeVendors = context?.vendors || [];
  let matchedVendor: string | null = null;
  let comparisonVendor: string | null = null;

  const qStripped = qLower.replace(/[\s\-_]/g, '');

  for (const v of activeVendors) {
    if (!v) continue;
    const vLower = v.toLowerCase().trim();
    const vStripped = vLower.replace(/[\s\-_]/g, '');

    if (qLower.includes(vLower) || (vStripped.length >= 3 && qStripped.includes(vStripped))) {
      if (!matchedVendor) {
        matchedVendor = v;
      } else if (!comparisonVendor && vLower !== matchedVendor.toLowerCase()) {
        comparisonVendor = v;
      }
    }
  }

  // Dynamic category matching from active dataset
  const activeCategories = context?.categories || [];
  let matchedCategory: string | null = null;
  for (const c of activeCategories) {
    if (!c) continue;
    const cLower = c.toLowerCase().trim();
    const cStripped = cLower.replace(/[\s\-_]/g, '');
    if (qLower.includes(cLower) || (cStripped.length >= 3 && qStripped.includes(cStripped))) {
      matchedCategory = c;
      break;
    }
  }

  // Status detection
  let matchedStatus: string | null = null;
  if (qLower.includes('unreconciled') || qLower.includes('pending') || qLower.includes('un-reconciled') || qLower.includes('unmatched')) {
    matchedStatus = 'Unreconciled';
  } else if (qLower.includes('reconciled') || qLower.includes('matched') || qLower.includes('settled')) {
    matchedStatus = 'Reconciled';
  }

  // Domain determination
  let domain: FinancialIntent['domain'] = 'transactions';
  if (matchedStatus || qLower.includes('recon') || qLower.includes('unrecon') || qLower.includes('match') || qLower.includes('settle')) {
    domain = 'reconciliation';
  } else if (
    qLower.includes('payout') ||
    qLower.includes('disburse') ||
    qLower.includes('received') ||
    qLower.includes('paid out') ||
    qLower.includes('transferred to') ||
    qLower.includes('sent to')
  ) {
    domain = 'vendor_payouts';
  } else {
    domain = 'transactions';
  }

  // Date phrase detection (any month, year, or quarter)
  let dateLabel: string | null = null;
  const monthMatch = qLower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/
  );
  const yearMatch = qLower.match(/\b(19\d\d|20\d\d)\b/);
  const quarterMatch = qLower.match(/\b(q1|q2|q3|q4)\b/);

  if (monthMatch && yearMatch) {
    dateLabel = `${monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1)} ${yearMatch[1]}`;
  } else if (quarterMatch && yearMatch) {
    dateLabel = `${quarterMatch[1].toUpperCase()} ${yearMatch[1]}`;
  } else if (monthMatch) {
    dateLabel = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1);
  } else if (yearMatch) {
    dateLabel = yearMatch[1];
  } else if (quarterMatch) {
    dateLabel = quarterMatch[1].toUpperCase();
  }

  return {
    domain,
    operation,
    metric: operation === 'count' ? 'transaction_count' : 'amount',
    vendor: matchedVendor,
    category: matchedCategory,
    status: matchedStatus,
    date_label: dateLabel,
    group_by: operation === 'group_by' ? (matchedCategory ? 'vendor' : 'category') : null,
    comparison_period: null,
    comparison_vendor: comparisonVendor,
    limit: limit || (operation === 'ranking' ? 5 : operation === 'max' || operation === 'min' ? 1 : null),
    ranking_target: rankingTarget,
    only_amount: onlyAmount,
    show_table:
      !onlyAmount &&
      (userRequestedTable ||
        operation === 'group_by' ||
        operation === 'ranking' ||
        operation === 'comparison' ||
        operation === 'list'),
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

export async function extractFinancialIntent(
  question: string,
  context?: DatasetContext
): Promise<FinancialIntent> {
  const fallback = ruleBasedIntentParser(question, context);
  const client = getGeminiClient();
  if (!client) {
    return fallback;
  }

  const geminiPromise = (async (): Promise<FinancialIntent> => {
    try {
      const contextPrompt = context
        ? `
ACTIVE DATASET ONTOLOGY & ENTITIES:
- Uploaded Vendors/Payees: ${context.vendors && context.vendors.length > 0 ? context.vendors.slice(0, 50).join(', ') : 'No predefined vendors'}
- Uploaded Categories: ${context.categories && context.categories.length > 0 ? context.categories.slice(0, 30).join(', ') : 'No predefined categories'}
- Uploaded Statuses: ${context.statuses && context.statuses.length > 0 ? context.statuses.join(', ') : 'Reconciled, Unreconciled, Settled, Pending'}
- Uploaded Date Span: ${context.dateRange ? `${context.dateRange.minDate} to ${context.dateRange.maxDate}` : 'All periods'}
`
        : '';

      const prompt = `You are a Natural Language Financial Query Compiler.
Translate the user's financial question into a strictly structured JSON object.

RULES:
1. NEVER compute calculations, totals, or financial sums. The database executes them deterministically.
2. Domain must be: "transactions", "vendor_payouts", or "reconciliation".
3. Operation must be:
- "max": user asks for highest transaction, maximum transaction, largest transaction amount (e.g. "which is highest transactions amount", "max transaction", "largest spend").
- "min": user asks for lowest, minimum, or smallest transaction or amount.
- "avg": user asks for average or mean transaction amount.
- "sum": total spend, sum, or overall expenditures.
- "count": how many transactions or count of records.
- "ranking": ranking multiple entities (e.g. "top 5 vendors", "top 3 transactions"). Use "ranking_target": "transactions" when ranking individual transactions, "vendors" for vendors, "categories" for categories.
- "list_categories": asking for category names, list of categories, or categories only.
- "list_vendors": asking for vendor names or list of vendors.
- "group_by": breakdown by vendor, category, or status.
- "comparison": vendor A vs vendor B.
4. If the user explicitly asks for a table (e.g. "show table", "display table", "in a table", "tabular", "as table"), or if the user asks for breakdown/ranking/comparison, set "show_table": true. If the user asks for a simple sum, count, max, min, avg, single vendor spend, or specifies "only amount" without asking for a table, set "show_table": false.
5. If the user explicitly asks for amount only (e.g. "show me only amount", "amount only", "just the amount"), set "only_amount": true and "show_table": false.
6. Extract vendor names into "vendor" (match or closely align with the uploaded vendors in the active dataset if present).
7. If comparing two vendors (e.g. "Vendor A vs Vendor B"), put second vendor into "comparison_vendor".
8. Extract date phrases (e.g. "August 2026", "July", "Q2", "2025") into "date_label".
9. Extract status ("Reconciled", "Unreconciled", "Pending", "Settled") into "status".
10. Extract category into "category" (match uploaded categories if present).
${contextPrompt}
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
              ranking_target: { type: Type.STRING },
              only_amount: { type: Type.BOOLEAN },
              show_table: { type: Type.BOOLEAN },
            },
            required: ['domain', 'operation', 'metric'],
          },
        },
      });

      const text = response.text?.trim();
      if (!text) return fallback;

      const parsed = JSON.parse(text) as FinancialIntent;
      const parsedOperation = ['sum', 'count', 'max', 'min', 'avg', 'list', 'ranking', 'group_by', 'comparison', 'list_categories', 'list_vendors'].includes(parsed.operation)
        ? parsed.operation
        : fallback.operation;
      const parsedOnlyAmount = parsed.only_amount !== undefined ? parsed.only_amount : fallback.only_amount;
      const parsedShowTable =
        !parsedOnlyAmount &&
        (parsed.show_table !== undefined
          ? parsed.show_table
          : fallback.show_table);

      return {
        domain: ['transactions', 'vendor_payouts', 'reconciliation'].includes(parsed.domain)
          ? parsed.domain
          : fallback.domain,
        operation: parsedOperation,
        metric: parsed.metric === 'transaction_count' ? 'transaction_count' : 'amount',
        vendor: parsed.vendor || fallback.vendor,
        category: parsed.category || fallback.category,
        status: parsed.status || fallback.status,
        date_label: parsed.date_label || fallback.date_label,
        group_by: parsed.group_by || fallback.group_by,
        comparison_period: parsed.comparison_period || fallback.comparison_period,
        comparison_vendor: parsed.comparison_vendor || fallback.comparison_vendor,
        limit: parsed.limit || (parsedOperation === 'ranking' ? 5 : parsedOperation === 'max' || parsedOperation === 'min' ? 1 : null),
        ranking_target: (parsed.ranking_target as any) || fallback.ranking_target,
        only_amount: parsedOnlyAmount,
        show_table: parsedShowTable,
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
  breakdown: BreakdownItem[]
): Promise<string> {
  const formattedINR = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(totalAmount);

  const qLower = question.toLowerCase();
  let fallbackAnswer = '';
  if (recordCount === 0) {
    const target = intent.vendor || intent.category || intent.status || 'the specified filters';
    fallbackAnswer = `No records matching "${target}" were found in the uploaded active dataset.`;
  } else if (
    intent.operation === 'list_categories' ||
    qLower.includes('category name') ||
    (qLower.includes('category') && (qLower.includes('only') || qLower.includes('show') || qLower.includes('list') || qLower.includes('what')))
  ) {
    const categories = Array.from(new Set(breakdown.map((b) => b.entity || b.category).filter(Boolean)));
    if (categories.length > 0) {
      fallbackAnswer = `The active dataset contains ${categories.length} categories:\n${categories.map((c, i) => `${i + 1}. **${c}**`).join('\n')}`;
    } else {
      fallbackAnswer = 'No distinct categories were found in the active dataset.';
    }
  } else if (
    intent.operation === 'list_vendors' ||
    qLower.includes('vendor name') ||
    (qLower.includes('vendor') && (qLower.includes('only') || qLower.includes('show') || qLower.includes('list') || qLower.includes('what')))
  ) {
    const vendors = Array.from(new Set(breakdown.map((b) => b.entity || b.vendor).filter(Boolean)));
    if (vendors.length > 0) {
      fallbackAnswer = `The active dataset contains ${vendors.length} vendors:\n${vendors.map((v, i) => `${i + 1}. **${v}**`).join('\n')}`;
    } else {
      fallbackAnswer = 'No distinct vendors were found in the active dataset.';
    }
  } else if (intent.operation === 'max') {
    if (intent.only_amount || qLower.includes('only amount') || qLower.includes('amount only')) {
      fallbackAnswer = `The highest transaction amount is ${formattedINR}.`;
    } else if (breakdown.length > 0 && breakdown[0]?.entity) {
      fallbackAnswer = `The highest transaction is ${formattedINR} (${breakdown[0].entity}).`;
    } else {
      fallbackAnswer = `The highest transaction amount is ${formattedINR}.`;
    }
  } else if (intent.operation === 'min') {
    if (intent.only_amount || qLower.includes('only amount') || qLower.includes('amount only')) {
      fallbackAnswer = `The lowest transaction amount is ${formattedINR}.`;
    } else if (breakdown.length > 0 && breakdown[0]?.entity) {
      fallbackAnswer = `The lowest transaction is ${formattedINR} (${breakdown[0].entity}).`;
    } else {
      fallbackAnswer = `The lowest transaction amount is ${formattedINR}.`;
    }
  } else if (intent.operation === 'avg') {
    fallbackAnswer = `The average transaction amount is ${formattedINR} calculated across ${recordCount} transactions.`;
  } else if (intent.operation === 'count') {
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
    const entityPart = intent.vendor
      ? `for ${intent.vendor}`
      : intent.category
      ? `for ${intent.category}`
      : intent.status
      ? `for ${intent.status} transactions`
      : 'total spend';
    const periodPart = intent.date_label ? ` in ${intent.date_label}` : '';
    fallbackAnswer = `The verified ${entityPart}${periodPart} is ${formattedINR} calculated across ${recordCount} supporting transactions.`;
  }

  const client = getGeminiClient();
  if (!client) {
    return fallbackAnswer;
  }

  const geminiPromise = (async (): Promise<string> => {
    try {
      const isEntityListing =
        intent.operation === 'list_categories' ||
        intent.operation === 'list_vendors' ||
        qLower.includes('category name') ||
        (qLower.includes('category') && qLower.includes('only'));

      const distinctEntities = Array.from(new Set(breakdown.map((b) => b.entity || b.category || b.vendor).filter(Boolean)));

      const prompt = `You are an objective, professional financial assistant.
Explain this verified query result clearly, authoritatively, and concisely.

CRITICAL RULES:
1. ONLY cite the exact numbers and entity names provided below. NEVER invent, extrapolate, or estimate figures.
2. If the user asked for "only amount" or asked for highest/lowest transaction amount specifically, state the exact amount directly (e.g. "The highest transaction amount is ₹30,000."). Do NOT include unrequested breakdown lists or other vendors.
3. If the user asked for category names (e.g. "show me the category name only" or "what are the categories"), directly list the category names from the Distinct Entities list clearly in bullet points or a numbered list. Do NOT answer with just a total spend sum.
4. If the user asked for vendor names, directly list the vendor names.
5. Always format currency figures with the Indian Rupee symbol (₹).
6. If record count is 0, clearly inform the user that no matching transactions exist for their request in the uploaded dataset.

User Question: "${question}"
Calculation Formula: ${calculationDesc}
Total Amount: ${totalAmount} (${formattedINR})
Record Count: ${recordCount}
Period: ${intent.date_label || 'All recorded periods'}
Distinct Entities: ${distinctEntities.join(', ')}
Breakdown Sample: ${JSON.stringify(breakdown.slice(0, 5))}

Write a crisp, professional answer:`;

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
