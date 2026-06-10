const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element not found')
}

root.innerHTML = `
  <main style="min-height:100vh;display:grid;place-items:center;margin:0;background:#0f172a;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;">
    <section style="text-align:center;">
      <h1 style="margin:0 0 12px;">hesper desktop shell</h1>
      <p style="margin:0;opacity:0.8;">Task 8 Electron shell / preload / IPC ready.</p>
    </section>
  </main>
`
