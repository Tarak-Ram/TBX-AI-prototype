export interface FinancialRecord {
  id?: string;
  vendor: string;
  amount: number;
  transaction_date: string;
  category: string;
  status: string;
  [key: string]: any;
}

export interface FinancialIntent {
  domain: 'transactions' | 'vendor_payouts' | 'reconciliation';
  operation: 'sum' | 'count' | 'max' | 'min' | 'avg' | 'list' | 'ranking' | 'group_by' | 'comparison' | 'list_categories' | 'list_vendors';
  metric: 'amount' | 'transaction_count';
  vendor: string | null;
  category: string | null;
  status: string | null;
  date_label: string | null;
  group_by: string | null;
  comparison_period: string | null;
  comparison_vendor: string | null;
  limit: number | null;
  ranking_target?: 'transactions' | 'vendors' | 'categories' | null;
  only_amount?: boolean;
  show_table?: boolean;
}

export interface SupportingRecord {
  vendor?: string;
  amount?: number;
  transaction_date?: string;
  category?: string;
  status?: string;
  [key: string]: any;
}

export interface CalculationMeta {
  operation?: string;
  field?: string;
  formula?: string;
}

export interface ResultMeta {
  amount?: number;
  record_count?: number;
  top_entity?: string;
  top_amount?: number;
  months?: number;
  [key: string]: any;
}

export interface EvidenceData {
  query_id: string;
  dataset_version: number;
  period?: string;
  filters: Record<string, any>;
  row_count: number;
  calculation: CalculationMeta;
  result: ResultMeta;
  supporting_records: SupportingRecord[];
  total_records_in_dataset: number;
}

export interface BreakdownItem {
  entity: string;
  amount: number;
  count: number;
  category?: string;
  vendor?: string;
  total_amount?: number;
  record_count?: number;
  status?: string;
}

export interface ResponsePayload {
  answer: string;
  calculation?: string;
  period?: string | null;
  records: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  query_id?: string;
  evidence?: EvidenceData | null;
  breakdown: BreakdownItem[];
  needs_clarification: boolean;
  clarification_options: string[];
  is_unsupported: boolean;
  is_not_found: boolean;
  only_amount?: boolean;
  show_table?: boolean;
}
