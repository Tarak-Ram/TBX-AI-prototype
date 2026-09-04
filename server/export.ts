import * as XLSX from 'xlsx';
import { EvidenceData } from './types';

const xlsxLib = (XLSX as any).default || XLSX;

export function exportEvidenceToCsv(evidence: EvidenceData): string {
  const headers = ['Vendor Name', 'Amount (INR)', 'Transaction Date', 'Category', 'Status'];
  const rows = evidence.supporting_records.map((r) => [
    `"${(r.vendor || '').replace(/"/g, '""')}"`,
    r.amount !== undefined ? r.amount : '',
    `"${r.transaction_date || ''}"`,
    `"${(r.category || '').replace(/"/g, '""')}"`,
    `"${(r.status || '').replace(/"/g, '""')}"`,
  ]);

  const csvLines = [
    `# Audit Evidence Export: ${evidence.query_id}`,
    `# Formula: ${evidence.calculation?.formula || 'N/A'}`,
    `# Total Amount: ${evidence.result?.amount || 0}`,
    `# Row Count: ${evidence.row_count}`,
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ];

  return csvLines.join('\n');
}

export function exportEvidenceToExcel(evidence: EvidenceData): Buffer {
  const records = evidence.supporting_records.map((r) => ({
    'Vendor Name': r.vendor || '',
    'Amount (INR)': r.amount ?? 0,
    'Transaction Date': r.transaction_date || '',
    Category: r.category || '',
    Status: r.status || '',
  }));

  const summaryData = [
    { Property: 'Query ID', Value: evidence.query_id },
    { Property: 'Formula / Calculation', Value: evidence.calculation?.formula || '' },
    { Property: 'Total Calculated (INR)', Value: evidence.result?.amount || 0 },
    { Property: 'Record Count', Value: evidence.row_count },
    { Property: 'Period', Value: evidence.period || 'All time' },
    { Property: 'Export Timestamp', Value: new Date().toISOString() },
  ];

  const wb = XLSX.utils.book_new();

  const summarySheet = xlsxLib.utils.json_to_sheet(summaryData);
  xlsxLib.utils.book_append_sheet(wb, summarySheet, 'Audit Summary');

  const recordsSheet = xlsxLib.utils.json_to_sheet(records);
  xlsxLib.utils.book_append_sheet(wb, recordsSheet, 'Supporting Records');

  const buf = xlsxLib.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buf as Buffer;
}
