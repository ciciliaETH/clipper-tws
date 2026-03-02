import * as XLSX from 'xlsx';

interface VideoData {
  platform?: string;
  username?: string;
  owner_name?: string;
  title?: string;
  caption?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  taken_at?: string;
  link?: string;
}

interface ExportOptions {
  filename: string;
  title?: string;
}

export function exportVideosToExcel(videos: VideoData[], options: ExportOptions) {
  const rows = videos.map((v, i) => ({
    'No': i + 1,
    'Platform': (v.platform || '').charAt(0).toUpperCase() + (v.platform || '').slice(1),
    'Username': v.username || '',
    'Nama': v.owner_name || '-',
    'Caption': (v.title || v.caption || '').slice(0, 300),
    'Views': Number(v.views || 0),
    'Likes': Number(v.likes || 0),
    'Comments': Number(v.comments || 0),
    'Shares': Number(v.shares || 0),
    'Tanggal Posting': v.taken_at ? v.taken_at.slice(0, 10) : '-',
    'Link': v.link || '',
  }));

  // Add totals row
  rows.push({
    'No': '' as any,
    'Platform': '',
    'Username': '',
    'Nama': '',
    'Caption': 'TOTAL',
    'Views': rows.reduce((s, r) => s + r.Views, 0),
    'Likes': rows.reduce((s, r) => s + r.Likes, 0),
    'Comments': rows.reduce((s, r) => s + r.Comments, 0),
    'Shares': rows.reduce((s, r) => s + r.Shares, 0),
    'Tanggal Posting': '',
    'Link': '',
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto column widths
  const colWidths = [
    { wch: 5 },   // No
    { wch: 12 },  // Platform
    { wch: 20 },  // Username
    { wch: 20 },  // Nama
    { wch: 50 },  // Caption
    { wch: 12 },  // Views
    { wch: 12 },  // Likes
    { wch: 12 },  // Comments
    { wch: 12 },  // Shares
    { wch: 14 },  // Tanggal Posting
    { wch: 40 },  // Link
  ];
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Videos');

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${options.filename} - ${date}.xlsx`);
}
