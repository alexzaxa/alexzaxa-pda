// Minimal, dependency-free inline-SVG bar chart shared by admin.html and dashboard.html -
// consistent with the site's no-build-step approach (XLSX/supabase-js are the only external
// imports anywhere on the site, both via esm.sh CDN, no bundler, no charting library).
export function renderBarChart(container, rows, { day, value, formatValue }) {
    if (!rows.length) {
        container.innerHTML = `<p class="msg" style="color:var(--text-dim)">No data for this range.</p>`;
        return;
    }
    const max = Math.max(...rows.map((r) => value(r)), 1);
    const w = 760, h = 160;
    const barWidth = Math.max(w / rows.length - 4, 2);
    const bars = rows.map((r, i) => {
        const v = value(r);
        const barH = Math.max(Math.round((v / max) * (h - 20)), 1);
        const x = (i * w) / rows.length;
        const y = h - barH;
        return `<rect x="${x.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${barH}" rx="2" fill="var(--accent)" fill-opacity="0.85"><title>${day(r)}: ${formatValue(v)}</title></rect>`;
    }).join("");
    container.innerHTML = `
        <div class="card" style="padding:1rem 1.2rem">
            <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:160px;display:block" preserveAspectRatio="none">${bars}</svg>
            <div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:0.78rem;margin-top:0.5rem">
                <span>${day(rows[0])}</span><span>${day(rows[rows.length - 1])}</span>
            </div>
        </div>
    `;
}
