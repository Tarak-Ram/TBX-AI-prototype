import { FinancialRecord } from './types';

export type FinancialDomain = 'vendor_payouts' | 'reconciliation' | 'transactions';

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

  // Scoring systems
  let payoutScore = 0;
  let reconScore = 0;
  let txScore = 0;

  // 1. Filename clues
  if (lowerFileName.includes('payout') || lowerFileName.includes('disbursement') || lowerFileName.includes('supplier')) {
    payoutScore += 4;
  }
  if (lowerFileName.includes('recon') || lowerFileName.includes('match') || lowerFileName.includes('settlement')) {
    reconScore += 4;
  }
  if (lowerFileName.includes('tx') || lowerFileName.includes('transaction') || lowerFileName.includes('ledger') || lowerFileName.includes('expense')) {
    txScore += 4;
  }

  // 2. Header analysis
  const payoutKeywords = ['payout', 'disbursement', 'utr', 'beneficiary', 'payee', 'supplier', 'vendor', 'payout_id', 'payout_method', 'batch_id'];
  const reconKeywords = ['recon', 'reconciled', 'match_status', 'reconciliation_status', 'bank_ref', 'variance', 'discrepancy', 'unreconciled', 'settled_at'];
  const txKeywords = ['category', 'department', 'ledger', 'cost_center', 'account', 'tx_type', 'debit', 'credit', 'invoice', 'expense_type'];

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
  const vendorH = findBestHeader(['vendor', 'payee', 'supplier', 'beneficiary_name', 'merchant', 'beneficiary', 'party_name', 'name']);
  if (vendorH) detectedColumns.push({ canonical: 'vendor', sourceHeader: vendorH });

  // Amount
  const amountH = findBestHeader(['amount', 'paid_amount', 'net_amount', 'payout_amount', 'total_amount', 'debit', 'total', 'value', 'txn_amount', 'cost']);
  if (amountH) detectedColumns.push({ canonical: 'amount', sourceHeader: amountH });

  // Date
  const dateH = findBestHeader(['transaction_date', 'payout_date', 'payment_date', 'date', 'value_date', 'created_at', 'timestamp']);
  if (dateH) detectedColumns.push({ canonical: 'transaction_date', sourceHeader: dateH });

  // Category
  const catH = findBestHeader(['category', 'department', 'cost_center', 'type', 'expense_type', 'ledger_category']);
  if (catH) detectedColumns.push({ canonical: 'category', sourceHeader: catH });

  // Status
  const statusH = findBestHeader(['status', 'reconciliation_status', 'recon_status', 'match_status', 'payout_status', 'state']);
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
    if (!vendor) vendor = schema.domain === 'vendor_payouts' ? 'Vendor Payee' : 'Corporate Entity';

    // 2. Amount resolution
    let amount = 0;
    const rawAmt = amountHeader ? row[amountHeader] : undefined;
    if (rawAmt !== undefined && rawAmt !== null) {
      if (typeof rawAmt === 'number') {
        amount = rawAmt;
      } else {
        const str = String(rawAmt).replace(/[₹$,]/g, '').trim();
        const parsed = parseFloat(str);
        amount = isNaN(parsed) ? 0 : parsed;
      }
    } else {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('amount') || lk.includes('paid') || lk.includes('total') || lk.includes('cost') || lk.includes('price')) {
          const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[₹$,]/g, ''));
          if (!isNaN(num)) {
            amount = num;
            break;
          }
        }
      }
    }

    // 3. Date resolution
    let transaction_date = dateHeader ? String(row[dateHeader] || '').trim() : '';
    if (!transaction_date) {
      for (const [k, v] of Object.entries(row)) {
        const lk = k.toLowerCase();
        if (lk.includes('date') || lk.includes('time') || lk.includes('day')) {
          transaction_date = String(v || '').trim();
          break;
        }
      }
    }
    if (!transaction_date) {
      transaction_date = new Date().toISOString().split('T')[0];
    } else if (transaction_date.includes('/') || transaction_date.includes('-')) {
      // Normalize simple dates if possible
      const parts = transaction_date.split(/[-/]/);
      if (parts.length === 3 && parts[0].length === 4) {
        const yyyy = parts[0];
        const mm = parts[1].padStart(2, '0');
        const dd = parts[2].padStart(2, '0');
        transaction_date = `${yyyy}-${mm}-${dd}`;
      }
    }

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
