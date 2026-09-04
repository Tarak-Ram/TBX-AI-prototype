import { FinancialRecord } from './types';

export type FinancialDomain = 'vendor_payouts' | 'reconciliation' | 'transactions' | 'reference';

export interface ColumnMapping {
  canonical: 'vendor' | 'amount' | 'transaction_date' | 'category' | 'status';
  sourceHeader: string;
}

export interface SchemaAnalysisResult {
  domain: FinancialDomain;
  domainLabel: string;
  confidence: number;
  detectedColumns: ColumnMapping[];
  rowCount: number;
  sampleRows: any[];
  summary: string;
}

export function parseAndNormalizeDate(val: any): string {
  if (val === undefined || val === null || val === '') {
    return new Date().toISOString().split('T')[0];
  }

  // 1. JS Date object
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().split('T')[0];
  }

  // 2. Numeric Excel serial date (e.g. 45306 or "45306")
  let numVal: number | null = null;
  if (typeof val === 'number' && !isNaN(val)) {
    numVal = val;
  } else if (typeof val === 'string' && /^\d{5}(\.\d+)?$/.test(val.trim())) {
    numVal = parseFloat(val.trim());
  }

  if (numVal !== null && numVal >= 20000 && numVal <= 90000) {
    // 25569 is Jan 1 1970
    const d = new Date(Math.round((numVal - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  const str = String(val).trim();
  if (!str) return new Date().toISOString().split('T')[0];

  // 3. Check for standard ISO YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // 4. Check for DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const yyyy = slashMatch[3];
    let mm: string;
    let dd: string;
    if (p1 > 12) {
      dd = String(p1).padStart(2, '0');
      mm = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      mm = String(p1).padStart(2, '0');
      dd = String(p2).padStart(2, '0');
    } else {
      dd = String(p1).padStart(2, '0');
      mm = String(p2).padStart(2, '0');
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  // 5. Check for text month dates like "15-Jan-2024", "15 Jan 2024", "January 15, 2024"
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const textMonthMatch = str.match(/([a-zA-Z]{3,9})/);
  const yearMatch = str.match(/\b(19\d\d|20\d\d)\b/);
  const dayMatch = str.match(/\b([0-2]?\d|3[01])\b/);

  if (textMonthMatch && yearMatch) {
    const monthKey = textMonthMatch[1].toLowerCase().slice(0, 3);
    const mm = monthMap[monthKey];
    if (mm) {
      const yyyy = yearMatch[1];
      const dd = dayMatch ? dayMatch[1].padStart(2, '0') : '01';
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // 6. Native Date parse
  const parsedTs = Date.parse(str);
  if (!isNaN(parsedTs)) {
    return new Date(parsedTs).toISOString().split('T')[0];
  }

  return new Date().toISOString().split('T')[0];
}

export function parseAmount(rawAmt: any): number {
  if (rawAmt === undefined || rawAmt === null) return 0;
  if (typeof rawAmt === 'number') return isNaN(rawAmt) ? 0 : rawAmt;
  
  let str = String(rawAmt).trim();
  // Handle accounting format: (1,234.56) -> -1234.56
  const isNegative = str.startsWith('(') && str.endsWith(')');
  if (isNegative) {
    str = str.slice(1, -1).trim();
  }

  // Strip currency symbols and formatting commas
  str = str.replace(/[₹$,€£Rs\s]/gi, '').trim();
  const parsed = parseFloat(str);
  if (isNaN(parsed)) return 0;
  return isNegative ? -parsed : parsed;
}

export function detectSchemaAndDomain(rawRows: any[], fileName: string = ''): SchemaAnalysisResult {
  if (!rawRows || rawRows.length === 0) {
    return {
      domain: 'transactions',
      domainLabel: 'General Transactions',
      confidence: 0.5,
      detectedColumns: [],
      rowCount: 0,
      sampleRows: [],
      summary: 'Empty dataset; defaulting to standard transaction schema.',
    };
  }

  // Extract all headers across sample rows
  const sample = rawRows.slice(0, 10);
  const allHeadersSet = new Set<string>();
  sample.forEach((row) => {
    Object.keys(row).forEach((k) => allHeadersSet.add(k.trim()));
  });
  const headers = Array.from(allHeadersSet);
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const lowerFileName = fileName.toLowerCase();

  // Check if this is a master / reference table (Chart of Accounts or Vendor master)
  const isChartOfAccounts =
    lowerFileName.includes('chart_of_accounts') ||
    lowerFileName.includes('accounts.csv') ||
    lowerFileName.includes('ledger_master') ||
    (lowerHeaders.some((h) => h.includes('account_name') || h.includes('account_type')) &&
      !lowerHeaders.some((h) => h.includes('paid') || h.includes('payout')));

  const isVendorMaster =
    (lowerFileName.includes('vendor') && !lowerFileName.includes('payout') && !lowerFileName.includes('disbursement')) ||
    (lowerHeaders.some((h) => h.includes('vendor_id')) && !lowerHeaders.some((h) => h.includes('amount') || h.includes('paid')));

  // Check if amounts exist in the rows
  const hasAmountColumn = lowerHeaders.some((h) =>
    ['amount', 'paid', 'total', 'cost', 'debit', 'credit', 'value', 'price', 'gross', 'net'].some((k) => h.includes(k))
  );

  if ((isChartOfAccounts || isVendorMaster) && !hasAmountColumn) {
    const detectedColumns: ColumnMapping[] = [];
    const vendorH = headers.find((h) => {
      const lh = h.toLowerCase();
      return lh.includes('name') || lh.includes('account') || lh.includes('vendor') || lh.includes('party');
    });
    if (vendorH) detectedColumns.push({ canonical: 'vendor', sourceHeader: vendorH });
    const catH = headers.find((h) => {
      const lh = h.toLowerCase();
      return lh.includes('type') || lh.includes('category') || lh.includes('group');
    });
    if (catH) detectedColumns.push({ canonical: 'category', sourceHeader: catH });

    return {
      domain: 'reference',
      domainLabel: isChartOfAccounts ? 'Chart of Accounts (Reference)' : 'Vendor Registry (Reference)',
      confidence: 0.95,
      detectedColumns,
      rowCount: rawRows.length,
      sampleRows: sample.slice(0, 3),
      summary: `Identified as Reference Master Data (${rawRows.length} rows).`,
    };
  }

  // Scoring systems
  let payoutScore = 0;
  let reconScore = 0;
  let txScore = 0;

  // 1. Filename clues
  if (lowerFileName.includes('payout') || lowerFileName.includes('disbursement') || lowerFileName.includes('batch')) {
    payoutScore += 5;
  }
  if (lowerFileName.includes('recon') || lowerFileName.includes('match') || lowerFileName.includes('settlement')) {
    reconScore += 5;
  }
  if (lowerFileName.includes('tx') || lowerFileName.includes('transaction') || lowerFileName.includes('ledger') || lowerFileName.includes('expense') || lowerFileName.includes('spend')) {
    txScore += 4;
  }

  // 2. Header analysis
  const payoutKeywords = ['payout', 'disbursement', 'utr', 'beneficiary', 'payee', 'supplier', 'payout_id', 'payout_method', 'batch_id'];
  const reconKeywords = ['recon', 'reconciled', 'match_status', 'reconciliation_status', 'bank_ref', 'variance', 'discrepancy', 'unreconciled', 'settled_at'];
  const txKeywords = ['category', 'department', 'ledger', 'cost_center', 'tx_type', 'debit', 'credit', 'invoice', 'expense_type', 'description'];

  headers.forEach((h) => {
    const lk = h.toLowerCase();
    payoutKeywords.forEach((k) => {
      if (lk.includes(k)) payoutScore += 2;
    });
    reconKeywords.forEach((k) => {
      if (lk.includes(k)) reconScore += 2.5;
    });
    txKeywords.forEach((k) => {
      if (lk.includes(k)) txScore += 1.5;
    });
  });

  // 3. Inspect sample values for distinctive patterns
  sample.forEach((row) => {
    for (const val of Object.values(row)) {
      const strVal = String(val || '').toLowerCase();
      if (strVal === 'reconciled' || strVal === 'unreconciled' || strVal === 'matched' || strVal === 'unmatched') {
        reconScore += 3;
      }
      if (strVal.includes('payout') || strVal.includes('utr') || strVal.includes('neft') || strVal.includes('rtgs') || strVal.includes('imps')) {
        payoutScore += 2;
      }
    }
  });

  // Determine winning domain
  let domain: FinancialDomain = 'transactions';
  let domainLabel = 'General Transactions';
  let maxScore = txScore;

  if (reconScore > maxScore && reconScore >= payoutScore) {
    domain = 'reconciliation';
    domainLabel = 'Reconciliation & Matching';
    maxScore = reconScore;
  } else if (payoutScore > maxScore) {
    domain = 'vendor_payouts';
    domainLabel = 'Vendor Disbursements & Payouts';
    maxScore = payoutScore;
  }

  const confidence = Math.min(0.99, Math.max(0.65, 0.65 + maxScore * 0.03));

  // Determine column mappings
  const detectedColumns: ColumnMapping[] = [];
  const findBestHeader = (candidateNames: string[]): string | undefined => {
    for (const cand of candidateNames) {
      const match = headers.find((h) => h.toLowerCase() === cand.toLowerCase());
      if (match) return match;
    }
    for (const cand of candidateNames) {
      const match = headers.find((h) => h.toLowerCase().includes(cand.toLowerCase()));
      if (match) return match;
    }
    return undefined;
  };

  // Vendor / Payee
  const vendorH = findBestHeader(['vendor', 'payee', 'supplier', 'beneficiary_name', 'merchant', 'beneficiary', 'party_name', 'party', 'entity', 'company', 'name']);
  if (vendorH) detectedColumns.push({ canonical: 'vendor', sourceHeader: vendorH });

  // Amount
  const amountH = findBestHeader(['amount', 'paid_amount', 'net_amount', 'payout_amount', 'total_amount', 'debit', 'total', 'value', 'txn_amount', 'cost', 'gross']);
  if (amountH) detectedColumns.push({ canonical: 'amount', sourceHeader: amountH });

  // Date
  const dateH = findBestHeader(['transaction_date', 'payout_date', 'payment_date', 'date', 'value_date', 'posting_date', 'txn_date', 'created_at', 'timestamp']);
  if (dateH) detectedColumns.push({ canonical: 'transaction_date', sourceHeader: dateH });

  // Category
  const catH = findBestHeader([
    'category',
    'category_name',
    'category name',
    'cat_name',
    'item_category',
    'expense_category',
    'department',
    'cost_center',
    'type',
    'expense_type',
    'expense_head',
    'account_head',
    'head',
    'purpose',
    'ledger_category',
    'particulars',
    'item_name',
    'item',
  ]);
  if (catH) detectedColumns.push({ canonical: 'category', sourceHeader: catH });

  // Status
  const statusH = findBestHeader(['status', 'reconciliation_status', 'recon_status', 'match_status', 'payout_status', 'state', 'remarks']);
  if (statusH) detectedColumns.push({ canonical: 'status', sourceHeader: statusH });

  return {
    domain,
    domainLabel,
    confidence: Math.round(confidence * 100) / 100,
    detectedColumns,
    rowCount: rawRows.length,
    sampleRows: sample.slice(0, 3),
    summary: `Identified as ${domainLabel} (${Math.round(confidence * 100)}% confidence). Mapped ${detectedColumns.length} canonical columns.`,
  };
}

export function normalizeRowsWithSchema(rawRows: any[], fileName: string = ''): { records: FinancialRecord[]; schema: SchemaAnalysisResult } {
  const schema = detectSchemaAndDomain(rawRows, fileName);
  const records: FinancialRecord[] = [];

  const vendorHeader = schema.detectedColumns.find((c) => c.canonical === 'vendor')?.sourceHeader;
  const amountHeader = schema.detectedColumns.find((c) => c.canonical === 'amount')?.sourceHeader;
  const dateHeader = schema.detectedColumns.find((c) => c.canonical === 'transaction_date')?.sourceHeader;
  const catHeader = schema.detectedColumns.find((c) => c.canonical === 'category')?.sourceHeader;
  const statusHeader = schema.detectedColumns.find((c) => c.canonical === 'status')?.sourceHeader;

  rawRows.forEach((row, idx) => {
    // 1. Vendor resolution
    let vendor = vendorHeader ? String(row[vendorHeader] || '').trim() : '';
    if (!vendor) {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('vendor') || lk.includes('payee') || lk.includes('supplier') || lk.includes('name') || lk.includes('party')) {
          vendor = String(v || '').trim();
          break;
        }
      }
    }
    if (!vendor) {
      vendor = schema.domain === 'vendor_payouts' ? 'Vendor Payee' : schema.domain === 'reference' ? 'Reference Entity' : 'Corporate Entity';
    }

    // 2. Amount resolution
    let amount = 0;
    const rawAmt = amountHeader ? row[amountHeader] : undefined;
    if (rawAmt !== undefined && rawAmt !== null) {
      amount = parseAmount(rawAmt);
    } else {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('amount') || lk.includes('paid') || lk.includes('total') || lk.includes('cost') || lk.includes('price')) {
          amount = parseAmount(v);
          if (amount !== 0) break;
        }
      }
    }

    // 3. Date resolution
    let rawDate = dateHeader ? row[dateHeader] : undefined;
    if (rawDate === undefined || rawDate === null || rawDate === '') {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('date') || lk.includes('time') || lk.includes('day')) {
          rawDate = v;
          break;
        }
      }
    }
    const transaction_date = parseAndNormalizeDate(rawDate);

    // 4. Category resolution
    let category = catHeader ? String(row[catHeader] || '').trim() : '';
    if (!category) {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('cat') || lk.includes('dept') || lk.includes('type') || lk.includes('purpose')) {
          category = String(v || '').trim();
          break;
        }
      }
    }
    if (!category) {
      if (schema.domain === 'vendor_payouts') category = 'Vendor Disbursement';
      else if (schema.domain === 'reconciliation') category = 'Settlement & Clearance';
      else if (schema.domain === 'reference') category = 'Reference Master';
      else category = 'General Expense';
    }

    // 5. Status resolution
    let status = statusHeader ? String(row[statusHeader] || '').trim() : '';
    if (!status) {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('status') || lk.includes('recon') || lk.includes('state')) {
          status = String(v || '').trim();
          break;
        }
      }
    }
    if (!status) {
      status = schema.domain === 'reconciliation' ? 'Unreconciled' : 'Reconciled';
    } else {
      // Normalize casing
      const sLower = status.toLowerCase();
      if (sLower.includes('unrecon') || sLower.includes('unmatch')) status = 'Unreconciled';
      else if (sLower.includes('recon') || sLower.includes('match') || sLower.includes('success')) status = 'Reconciled';
      else if (sLower.includes('pend')) status = 'Pending';
      else if (sLower.includes('fail') || sLower.includes('reject')) status = 'Failed';
      else if (sLower.includes('active')) status = 'Active';
      else if (sLower.includes('post')) status = 'Posted';
      else if (sLower.includes('comp')) status = 'Completed';
    }

    records.push({
      id: `${fileName ? fileName.replace(/[^a-zA-Z0-9]/g, '_') : 'file'}_row_${idx + 1}`,
      vendor,
      amount,
      transaction_date,
      category,
      status,
      domain: schema.domain,
      source_file: fileName || 'uploaded_data',
    });
  });

  return { records, schema };
}
