from pathlib import Path
from xml.etree import ElementTree as ET
from PIL import Image
root = Path(__file__).resolve().parent
svgs = list(root.glob('*.svg'))
assert len(svgs) == 16, len(svgs)
for path in svgs:
    tree = ET.parse(path)
    assert tree.getroot().tag == '{http://www.w3.org/2000/svg}svg'
    assert tree.find('{http://www.w3.org/2000/svg}title') is not None
    for node in tree.iter():
        assert node.tag.split('}')[-1] not in ('script','image','text','foreignObject')
        assert not any(k.split('}')[-1] in ('href','onload') for k in node.attrib)
    with Image.open(path.with_suffix('.png')) as im:
        if path.stem not in ('comparison-sheet','recommended-app-tile'):
            assert im.mode == 'RGBA', (path, im.mode)
            assert im.getextrema()[-1][0] == 0
        else:
            assert im.mode in ('RGB', 'RGBA')
for key in ('01-shared-stem','02-open-ledger','03-desk-d'):
    for size in (16,24,32):
        with Image.open(root/f'{key}-{size}px.png') as im:
            assert im.size == (size,size)
assert (root/'comparison-sheet.pdf').read_bytes().startswith(b'%PDF')
print(f'PASS: {len(svgs)} self-contained SVGs; matching PNGs and transparent mark exports; 9 actual-size proofs; vector PDF.')
