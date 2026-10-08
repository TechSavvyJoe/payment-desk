import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream, StandardFonts } from 'pdf-lib';
import { calculateDeal } from '../src/lib/calculations.js';
import { createProposalSnapshot } from '../src/lib/proposal.js';
import { resolveBrand } from '../src/lib/brandSettings.js';
import { generateProposalPdf, proposalPdfLines, proposalPdfFilename } from '../src/lib/proposalPdf.js';
const create = (patch = {}, options = {}) => {
  const dealInput = { salePrice: 30000, cashDown: 0, apr: 6.5, termMonths: 72, dealDate: '2026-09-24', dealType: 'finance', plateMode: 'transfer', optionalItems: [], ...patch };
  return createProposalSnapshot({ dealInput, result: calculateDeal(dealInput), createdAt: '2026-09-24T19:00:00Z', version: 'pdf-test', ...options });
};

for (const [name, patch] of [['finance', {}], ['cash', { dealType: 'cash' }], ['50 products', { optionalItems: Array.from({ length: 50 }, (_, i) => ({ id: String(i), category: 'other', name: `Protection ${i + 1}`, amount: 12.34, taxable: true, taxTreatmentConfirmed: true })) }]]) {
  test(`real ${name} PDF preserves every group, totals and content`, async () => {
    const snapshot = create(patch, { brand: resolveBrand({ name: 'Lakeside Motors' }) });
    const file = await generateProposalPdf(snapshot);
    assert.equal(file.type, 'application/pdf');
    assert.equal(file.name, proposalPdfFilename(snapshot));
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getSubject(), proposalPdfLines(snapshot).join('\n'));
    assert.doesNotMatch(pdf.getSubject(), /total interest|interest paid|total (?:of |loan )?payments/i);
    assert.equal(pdf.getCreationDate().toISOString(), snapshot.createdAt);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const contents = pdf.getPages().flatMap(page => page.node.lookup(PDFName.of('Contents')).asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref)).decode()))).join('\n');
    for (const line of proposalPdfLines(snapshot).filter(line => line && font.widthOfTextAtSize(line, 12) < 528)) {
      if (contents.includes(font.encodeText(line).toString())) continue;
      const separator = line.lastIndexOf(': ');
      const parts = separator > 0 && /^−?\$[\d,.]+$/.test(line.slice(separator + 2))
        ? [line.slice(0, separator), line.slice(separator + 2)] : [line];
      for (const part of parts) assert.ok(contents.includes(font.encodeText(part).toString()), `visible text: ${part}`);
    }
    if (name === '50 products') assert.ok(pdf.getPageCount() >= 3);
  });
}
test('incomplete, erroneous, and aborted snapshots refuse PDF creation', async () => {
  for (const snapshot of [create({ salePrice: 0 }), create({}, { hasInputErrors: true }), create({ plateMode: 'new', newPlateAmount: null })]) await assert.rejects(generateProposalPdf(snapshot), /Complete the estimate/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateProposalPdf(create(), { signal: controller.signal }), { name: 'AbortError' });
});
test('snapshot content and safe filenames preserve Unicode without truncation', () => {
  const snapshot = create({ vehicleDescription: 'José 東京 🚗' }, { brand: resolveBrand({ name: 'Étoile 東京' }) });
  assert.ok(proposalPdfLines(snapshot).includes('Vehicle / stock: José 東京 🚗'));
  assert.equal(proposalPdfLines(snapshot)[0], 'Étoile 東京');
  assert.equal(proposalPdfFilename({ reference: '../../unsafe:reference' }), 'Estimate-______unsafe_reference.pdf');
});

test('unsupported coverage marked incomplete by the parent guard cannot generate PDF', async () => {
  const valid = calculateDeal({ salePrice: 30000, apr: 6.5, termMonths: 72, dealDate: '2026-09-24' });
  const snapshot = create({}, { hasInputErrors: true, result: { ...valid, isComplete: false, incompleteReasons: ['Only Michigan resident purchases are supported.'] } });
  await assert.rejects(generateProposalPdf(snapshot), /Complete the estimate/);
});
