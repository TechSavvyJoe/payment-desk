import { FINANCE_BALANCE_LABEL } from './financeModel.js';
import { formatCurrency, formatNumber } from './formatters.js';

const money = value => formatCurrency(value, { cents: true });
export const proposalPdfFilename = snapshot => `Estimate-${snapshot.reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;

// Exact content manifest for inspection, not a claim of tagged PDF accessibility.
export function proposalPdfLines(snapshot) {
  if (!snapshot.summary.canExport) throw new Error('Complete the estimate before generating a PDF.');
  const s = snapshot.summary;
  const lines = [
    snapshot.brand.isCustom ? snapshot.brand.dealershipName : snapshot.brand.name,
    snapshot.title, `Reference: ${snapshot.reference}`,
    `Created: ${snapshot.createdLabel} Eastern time (${snapshot.createdAt})`,
    `App version: ${snapshot.version}`,
    ...(snapshot.vehicleReference ? [`Vehicle / stock: ${snapshot.vehicleReference}`] : []),
    '', `${s.headline}: ${money(s.headlineAmount)}${s.isFinanced ? '/mo' : ''}`,
    ...(s.isFinanced ? [`${s.termMonths} months | Assumed annual interest rate: ${formatNumber(s.apr)}%`,
      `${FINANCE_BALANCE_LABEL}: ${money(s.amountFinanced)}`, `Due at signing: ${money(s.dueAtSigning)}`] : []),
  ];
  for (const group of snapshot.groups) {
    lines.push('', group.title, ...group.rows.map(row => `${row.label}: ${money(row.amount)}`), `${group.total.label}: ${money(group.total.amount)}`);
  }
  if (snapshot.comparisonRows.length) {
    lines.push('', 'Payment comparisons — same deal and cash due; assumed rates');
    for (const row of snapshot.comparisonRows) lines.push(`${row.selected ? 'Selected: ' : ''}${row.termMonths} months | Assumed annual interest rate: ${formatNumber(row.apr)}% | ${money(row.monthlyPayment)}/mo`);
  }
  lines.push('', 'Assumptions', ...snapshot.assumptions, '', snapshot.qualification);
  return lines;
}

export async function generateProposalPdf(snapshot, { signal } = {}) {
  const lines = proposalPdfLines(snapshot);
  const check = () => signal?.throwIfAborted();
  check();
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  check();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${snapshot.brand.name} — ${snapshot.title}`);
  pdf.setSubject(lines.join('\n'));
  pdf.setCreationDate(new Date(snapshot.createdAt));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.17, 0.22), blue = rgb(0.12, 0.25, 0.35), pale = rgb(0.94, 0.96, 0.97);
  let page, y, canvas, context;
  const newPage = () => {
    page = pdf.addPage([612, 792]); y = 738;
    page.drawRectangle({ x: 42, y: 752, width: 528, height: 3, color: blue });
  };
  const browserContext = () => {
    if (!context) {
      if (typeof document === 'undefined') throw new Error('Unicode PDF text requires browser text rendering.');
      canvas = document.createElement('canvas'); context = canvas.getContext('2d');
      if (!context) throw new Error('PDF text rendering is unavailable.');
    }
    return context;
  };
  // Standard text remains selectable. Unsupported Unicode runs use local browser
  // glyph rendering at 3x resolution; these runs are images, not selectable text.
  const textStyle = (text, size, strong) => {
    const face = strong ? bold : font;
    let vector = true;
    try { face.encodeText(text); } catch { vector = false; }
    const measure = value => {
      if (vector) return face.widthOfTextAtSize(value, size);
      const ctx = browserContext(); ctx.font = `${strong ? 'bold ' : ''}${size * 3}px sans-serif`;
      return ctx.measureText(value).width / 3;
    };
    return { face, vector, measure };
  };
  const wrap = (text, width, measure) => {
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
    const wrapped = []; let line = '';
    for (const segment of segments) {
      if (line && measure(line + segment) > width) {
        const space = line.lastIndexOf(' ');
        if (space > 0) { wrapped.push(line.slice(0, space)); line = line.slice(space + 1); }
        else { wrapped.push(line); line = ''; }
      }
      line += segment;
    }
    if (line) wrapped.push(line);
    return wrapped;
  };
  const draw = async (text, x, top, size = 10.5, strong = false) => {
    check();
    const { face, vector, measure } = textStyle(text, size, strong);
    if (vector) page.drawText(text, { x, y: top - size, size, font: face, color: ink });
    else {
      const ctx = browserContext();
      canvas.width = Math.ceil(measure(text) * 3 + 12); canvas.height = Math.ceil(size * 5);
      ctx.font = `${strong ? 'bold ' : ''}${size * 3}px sans-serif`;
      ctx.fillStyle = '#1f2b38'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, 6, size * 3);
      const image = await pdf.embedPng(canvas.toDataURL('image/png'));
      check();
      page.drawImage(image, { x: x - 2, y: top - canvas.height / 3, width: canvas.width / 3, height: canvas.height / 3 });
    }
  };
  const paragraph = async (text, { size = 10.5, strong = false, inset = 0, hero = false } = {}) => {
    const wrapped = wrap(text, 528 - inset * 2, textStyle(text, size, strong).measure);
    const height = wrapped.length * size * 1.6 + (hero ? 20 : 0);
    if (y - height < 58) newPage();
    if (hero) { page.drawRectangle({ x: 42, y: y - height, width: 528, height, color: pale }); y -= 10; }
    for (const line of wrapped) {
      if (y < 58 + size * 1.6) newPage();
      await draw(line, 42 + inset, y, size, strong); y -= size * 1.6;
    }
    if (hero) y -= 10;
  };
  newPage();
  if (snapshot.brand.logo) {
    const image = await pdf.embedPng(snapshot.brand.logo);
    check();
    const scale = Math.min(160 / image.width, 48 / image.height);
    page.drawImage(image, { x: 42, y: y - image.height * scale, width: image.width * scale, height: image.height * scale });
    y -= image.height * scale + 12;
  }
  const headings = new Set([...snapshot.groups.map(group => group.title), 'Assumptions', 'Payment comparisons — same deal and cash due; assumed rates']);
  const totals = new Set(snapshot.groups.map(group => `${group.total.label}: ${money(group.total.amount)}`));
  const headline = `${snapshot.summary.headline}: ${money(snapshot.summary.headlineAmount)}${snapshot.summary.isFinanced ? '/mo' : ''}`;
  let inLedger = false, inAssumptions = false;
  for (const [index, text] of lines.entries()) {
    check();
    if (!text) { y -= 10; continue; }
    if (index === 0) { await paragraph(text, { size: 14, strong: true }); continue; }
    if (text === snapshot.title) { await paragraph(text, { size: 21, strong: true }); y -= 6; continue; }
    if (text.startsWith('Reference:') || text.startsWith('Created:') || text.startsWith('App version:')) { await paragraph(text, { size: 8.5 }); continue; }
    if (text.startsWith('Vehicle / stock:')) { y -= 8; await paragraph(text, { size: 12, strong: true }); continue; }
    if (text === headline) { await paragraph(text, { size: 22, strong: true, inset: 12, hero: true }); continue; }
    if (headings.has(text)) {
      inLedger = snapshot.groups.some(group => group.title === text);
      inAssumptions = text === 'Assumptions';
      if (y < 130) newPage();
      page.drawRectangle({ x: 42, y: y - 24, width: 528, height: 24, color: pale });
      await draw(text, 48, y - 5, 11.5, true); y -= 32; continue;
    }
    const separator = text.lastIndexOf(': ');
    const value = text.slice(separator + 2);
    if (inLedger && separator > 0 && /^−?\$[\d,.]+$/.test(value)) {
      const label = text.slice(0, separator), total = totals.has(text);
      const size = total ? 11.5 : 10.5;
      const wrapped = wrap(label, 405, textStyle(label, size, total).measure);
      const height = wrapped.length * size * 1.6 + (total ? 10 : 3);
      if (y - height < 58) newPage();
      if (total) { page.drawLine({ start: { x: 42, y: y + 2 }, end: { x: 570, y: y + 2 }, thickness: 0.6, color: blue }); y -= 5; }
      await draw(value, 570 - textStyle(value, size, true).measure(value), y, size, true);
      for (const line of wrapped) { await draw(line, 48, y, size, total); y -= size * 1.6; }
      y -= total ? 5 : 3;
    } else await paragraph(text, { size: inAssumptions ? 10 : inLedger ? 10.5 : 11, strong: !inAssumptions && !inLedger && (text.startsWith(FINANCE_BALANCE_LABEL) || text.startsWith('Due at signing:')) });
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${snapshot.reference}  |  Page ${i + 1} of ${pages.length}`, { x: 42, y: 30, size: 8, font, color: rgb(0.3, 0.3, 0.3) }));
  check();
  const bytes = await pdf.save();
  check();
  return new File([bytes], proposalPdfFilename(snapshot), { type: 'application/pdf' });
}

export function canShareProposalPdf(file) {
  try { return Boolean(file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })); }
  catch { return false; }
}
