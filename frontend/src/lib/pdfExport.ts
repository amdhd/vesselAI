/**
 * Opens a styled print window so the user can Save as PDF via the browser dialog.
 * No external dependencies required.
 */
export function printAsPdf(title: string, content: string): void {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.6;
      color: #111;
      padding: 32px 40px;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 {
      font-size: 16px;
      font-weight: bold;
      border-bottom: 2px solid #111;
      padding-bottom: 8px;
      margin-bottom: 16px;
      letter-spacing: 0.05em;
    }
    .meta {
      font-size: 10px;
      color: #555;
      margin-bottom: 24px;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: 11px;
      line-height: 1.7;
    }
    @media print {
      body { padding: 16px 20px; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; VesselMind AI</p>
  <pre>${escapeHtml(content)}</pre>
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (win) {
    win.document.write(html)
    win.document.close()
  }
}

/** Export tabular data as a downloadable CSV file. */
export function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
