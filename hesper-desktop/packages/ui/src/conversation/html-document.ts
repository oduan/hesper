const HTML_SANDBOX_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline';"

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function createSandboxedHtmlDocument(content: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(HTML_SANDBOX_CSP)}">`,
    '<style>html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;}body{padding:12px;word-break:break-word;}img{max-width:100%;height:auto;}</style>',
    '</head>',
    '<body>',
    content,
    '</body>',
    '</html>'
  ].join('')
}
