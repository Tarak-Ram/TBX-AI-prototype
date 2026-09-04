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

export interface ResponsePayload {
  answer: string;
  calculation?: string;
  period?: string | null;
  records: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  query_id?: string;
  evidence?: EvidenceData | null;
  breakdown: Array<Record<string, any>>;
  needs_clarification: boolean;
  clarification_options: string[];
  is_unsupported: boolean;
  is_not_found: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  payload?: ResponsePayload;
}

export interface HealthInfo {
  status: string;
  app_name: string;
  version: string;
  active_dataset: string;
  active_version: number;
  active_records: number;
  duckdb_connected: boolean;
  gemini_connected?: boolean;
  gemini_model?: string;
}

export interface DatasetVersionInfo {
  dataset_id: string;
  dataset_version: number;
  created_at: string;
  row_count: number;
  source_file: string;
  status: string;
  mapped_fields: Record<string, string>;
  table_name: string;
  compatibility_score: number;
}

export interface DatasetMetaInfo {
  dataset_id: string;
  name: string;
  active_version: number;
  versions: Record<string, DatasetVersionInfo>;
}
