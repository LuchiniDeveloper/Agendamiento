import type { ReportDefinition, ReportRow } from './report-types';

function sanitizeFilename(s: string): string {
  return s.replace(/[^\w\-]+/g, '_').slice(0, 80);
}

/** Builds Excel with column headers = labels (same as table headers). */
export async function exportReportToExcel(def: ReportDefinition, rows: ReportRow[]): Promise<void> {
  const XLSX = await import('xlsx');
  const sheetName = def.title.slice(0, 31);
  const data = rows.map((r) => {
    const row: Record<string, string | number | null> = {};
    for (const c of def.columns) {
      const v = r[c.key];
      row[c.label] = v === null || v === undefined ? '' : v;
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const name = `${sanitizeFilename(def.id)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}
