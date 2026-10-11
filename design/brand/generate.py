"""Original SVG geometry; local IBM Plex Sans outlines; no browser required."""
from pathlib import Path
import sys, math, io
sys.path.insert(0, '/tmp/payment-desk-vector-tools')
import cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
NAVY, BLUE, PAPER = '#102B4E', '#066FEF', '#F4F7FB'
font = TTFont(REPO / 'node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff')
glyphs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm

def text(label, x, y, size, color=NAVY, tracking=0):
    out=[]; cursor=0
    for ch in label:
        name=cmap[ord(ch)]; pen=SVGPathPen(glyphs); glyphs[name].draw(pen)
        out.append(f'<path d="{pen.getCommands()}" transform="translate({x+cursor:.3f} {y}) scale({size/upm} {-size/upm})" fill="{color}"/>')
        cursor += font['hmtx'][name][0]*size/upm + tracking
    return ''.join(out)

# 32-unit grid, 4-unit strokes / counters. No borrowed letter outlines in symbols.
marks = {
'01-shared-stem': ('Shared stem', 'A single spine joins payment and desk.',
 lambda c,a: f'<path fill="{c}" fill-rule="evenodd" d="M4 4H15C21 4 24 7 24 12S21 20 15 20H8V28H4ZM8 8V16H15C18.4 16 20 14.6 20 12S18.4 8 15 8Z"/><path fill="{a}" d="M12 22H16C20.8 22 24 18.8 24 14V12H28V14C28 21.2 23.2 26 16 26H12Z"/>'),
'02-open-ledger': ('Open ledger', 'Two aligned entries resolve into one total.',
 lambda c,a: f'<path fill="{c}" d="M4 4H28V8H8V24H28V28H4Z"/><path fill="{c}" d="M12 12H28V16H12Z"/><path fill="{a}" d="M12 20H28V24H12Z"/>'),
'03-desk-d': ('Desk D', 'A desk edge and open D share one contour.',
 lambda c,a: f'<path fill="{c}" d="M4 4H16C23.8 4 28 8.2 28 16S23.8 28 16 28H12V24H16C21.2 24 24 21.2 24 16S21.2 8 16 8H8V28H4Z"/><path fill="{a}" d="M12 14H20V18H12Z"/>')
}

def icon(key, color=NAVY, accent=BLUE, x=0,y=0,size=32):
    return f'<g transform="translate({x} {y}) scale({size/32})">{marks[key][2](color,accent)}</g>'
def svg(body,w,h,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img"><title>{title}</title>{body}</svg>'
def save(name,body,w,h,title, png=True):
    data=svg(body,w,h,title); (ROOT/f'{name}.svg').write_text(data)
    if png: cairosvg.svg2png(bytestring=data.encode(),write_to=str(ROOT/f'{name}.png'),scale=3)
    return data
for key,(label,_,_) in marks.items():
    for variant,c,a in [('color',NAVY,BLUE),('mono','#000000','#000000'),('reversed','#FFFFFF','#FFFFFF')]:
        save(f'{key}-{variant}',icon(key,c,a),32,32,f'Payment Desk — {label}, {variant}')
    for size in (16,24,32):
        cairosvg.svg2png(url=str(ROOT/f'{key}-color.svg'),write_to=str(ROOT/f'{key}-{size}px.png'),output_width=size,output_height=size)
# Winner uses exact 4-unit line weight, deliberately large 16-unit vertical counter.
WIN='02-open-ledger'
for name,c,a in [('recommended-primary',NAVY,BLUE),('recommended-reversed','#FFFFFF','#FFFFFF'),('recommended-mono','#000000','#000000')]:
    save(name, icon(WIN,c,a,0,4,48)+text('Payment Desk',64,39,32,c,-.25),292,56,f'Payment Desk — {name}')
save('recommended-stacked',icon(WIN,size=64,x=102,y=0)+text('Payment Desk',9,103,32,NAVY,-.25),268,116,'Payment Desk — stacked lockup')
save('recommended-icon',icon(WIN),32,32,'Payment Desk — recommended icon')
save('recommended-app-tile',f'<rect width="64" height="64" rx="14" fill="{NAVY}"/>'+icon(WIN,'#FFFFFF','#FFFFFF',12,12,40),64,64,'Payment Desk — app tile concept')
# Comparison sheet, every label outlined, all icons are real vector content.
b = f'<rect width="1200" height="1100" fill="{PAPER}"/>'
b += text('Payment Desk',48,66,38)+text('THREE ORIGINAL MARK DIRECTIONS / CONCEPT REVIEW',48,98,12,tracking=1)
b += text('Trustworthy Michigan payment estimates. Neutral identity for any dealership.',48,129,17)
for i,(key,(label,desc,_)) in enumerate(marks.items()):
    x=48+i*376
    b+=f'<rect x="{x}" y="164" width="352" height="442" rx="12" fill="#FFFFFF" stroke="#D7E0EC"/>'
    b+=text(f'0{i+1} / {label}',x+22,200,20)
    b+=icon(key,x=x+106,y=228,size=140)
    b+=text('Payment Desk',x+55,399,27,tracking=-.2)
    # Short descriptions split intentionally to fit columns.
    lines=[['One spine links the initials.','Compact; more abstract at 16 px.'],['A worksheet, reduced to its essentials.','Best clarity and category relevance.'],['A desk edge inside an open D.','Distinctive; less immediate meaning.']][i]
    for j,line in enumerate(lines): b+=text(line,x+22,434+j*22,14)
    b+=text('16 / 24 / 32 PX — ACTUAL SIZE',x+22,508,10,tracking=.5)
    for j,s in enumerate((16,24,32)): b+=icon(key,x=x+22+j*58,y=526,size=s)
    b+=icon(key,'#000000','#000000',x+208,522,36)
    b+=f'<rect x="{x+266}" y="516" width="64" height="64" rx="8" fill="{NAVY}"/>'+icon(key,'#FFFFFF','#FFFFFF',x+280,530,36)
    if key==WIN: b+=text('RECOMMENDED',x+22,592,11,BLUE,tracking=1)
b+=f'<rect x="48" y="638" width="1104" height="207" rx="12" fill="{NAVY}"/>'
b+=text('02 / OPEN LEDGER',72,675,12,'#FFFFFF',1)
b+=icon(WIN,'#FFFFFF','#FFFFFF',72,699,64)+text('Payment Desk',160,748,42,'#FFFFFF',-.35)
b+=text('Open counters. Four-unit strokes. No gradient needed.',72,798,16,'#FFFFFF')
b+=text('DEALERSHIP CUSTOMIZATION',685,677,11,'#FFFFFF',1)
b+=text('Your Dealership',685,724,28,'#FFFFFF')
b+=text('PAYMENT DESK',685,751,12,'#FFFFFF',1.4)
b+=text('Dealer identity stays primary in branded estimates.',685,799,14,'#FFFFFF')
b+=text('PALETTE',48,888,12,tracking=1)
for x,c,label in [(48,NAVY,'NAVY / #102B4E'),(289,BLUE,'BLUE / #066FEF'),(530,PAPER,'PAPER / #F4F7FB')]:
    b+=f'<rect x="{x}" y="908" width="34" height="34" rx="5" fill="{c}" stroke="#D7E0EC"/>'+text(label,x+46,929,12)
b+=text('IBM Plex Sans SemiBold / SIL Open Font License. Outlined with tightened spacing.',48,981,15)
b+=text('Clear space: one 4-unit stroke. Icon minimum: 16 px. Horizontal lockup minimum: 146 px.',48,1010,15)
b+=text('Concept only. No app integration, tax-provider claim, lender claim, or national coverage claim.',48,1045,13)
data=save('comparison-sheet',b,1200,1100,'Payment Desk — three original vector mark directions')
cairosvg.svg2pdf(bytestring=data.encode(),write_to=str(ROOT/'comparison-sheet.pdf'))
# Nearest-neighbor magnification preserves rendered pixel structure for inspection.
sheet=Image.new('RGB',(1000,460),'#F4F7FB'); d=ImageDraw.Draw(sheet)
for i,key in enumerate(marks):
    d.text((20+i*330,12),marks[key][0],fill=NAVY)
    for j,s in enumerate((16,24,32)):
        im=Image.open(ROOT/f'{key}-{s}px.png'); bg=Image.new('RGBA',im.size,'white'); bg.alpha_composite(im)
        big=bg.convert('RGB').resize((s*4,s*4),Image.Resampling.NEAREST)
        sheet.paste(big,(20+i*330,44+j*132)); d.text((170+i*330,52+j*132),f'{s}px at 4x',fill=NAVY)
sheet.save(ROOT/'pixel-inspection.png')
print('Generated original vector directions, winner lockups, transparent PNGs, comparison SVG/PNG/PDF and pixel proof.')
