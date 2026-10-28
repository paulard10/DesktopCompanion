import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSize, normalizeSelection, pixelCrop, sameSelectionDisplay, selectionViewportMatches, validSelection } from './screenSelection.ts';

const display = { id: 42, bounds: { x: -1920, y: 125, width: 1920, height: 1080 }, scaleFactor: 1 };
test('rectangle normalization handles every drag direction without global origin arithmetic', () => {
  for (const [a,b] of [[{x:20,y:30},{x:60,y:80}], [{x:60,y:80},{x:20,y:30}], [{x:20,y:80},{x:60,y:30}]])
    assert.deepEqual(normalizeSelection(a!,b!), {x:20,y:30,width:40,height:50});
});
test('minimum selection and finite, exact rectangle schema enforced', () => {
  assert.equal(validSelection({x:0,y:0,width:16,height:16}, display), true);
  for (const rect of [{x:0,y:0,width:15.9,height:16},{x:0,y:0,width:16,height:NaN},
    {x:0,y:0,width:Infinity,height:16},{x:0,y:0,width:16,height:16,displayId:7},null,'x'])
    assert.equal(validSelection(rect,display),false);
});
test('all four display edges reject out-of-bounds/cross-display coordinates', () => {
  for (const rect of [{x:-1,y:0,width:16,height:16},{x:0,y:-1,width:16,height:16},
    {x:1910,y:0,width:16,height:16},{x:0,y:1070,width:16,height:16}])
    assert.equal(validSelection(rect,display),false);
});
for (const scaleFactor of [1,1.25,1.5,1.75]) test(`negative-origin crop maps correctly at ${scaleFactor*100}% DPI`, () => {
  const d={...display,scaleFactor};
  assert.deepEqual(captureSize(d),{width:Math.round(1920*scaleFactor),height:Math.round(1080*scaleFactor)});
  assert.deepEqual(pixelCrop({x:20,y:40,width:100,height:60},d,captureSize(d)),
    {x:20*scaleFactor,y:40*scaleFactor,width:100*scaleFactor,height:60*scaleFactor});
});
test('fractional pixel boundaries include selected edge pixels, without stretching', () => {
  const d={...display,scaleFactor:1.25};
  assert.deepEqual(pixelCrop({x:1,y:1,width:17,height:17},d,captureSize(d)),{x:1,y:1,width:22,height:22});
});
test('wrong or default thumbnail dimensions fail rather than silently upscale', () => {
  for (const size of [{width:150,height:84},{width:1919,height:1080},{width:0,height:0}])
    assert.throws(()=>pixelCrop({x:0,y:0,width:20,height:20},display,size));
});
test('native display and crop budgets reject large decoded images', () => {
  assert.throws(()=>captureSize({...display,scaleFactor:3}));
  const d={...display,bounds:{x:0,y:0,width:3840,height:2160}};
  assert.throws(()=>pixelCrop({x:0,y:0,width:3840,height:2160},d,captureSize(d)));
  assert.throws(()=>captureSize({...display,scaleFactor:NaN}));
});
test('display identity, origin, resolution and scale changes invalidate the session', () => {
  assert.equal(sameSelectionDisplay(display,structuredClone(display)),true);
  for (const d of [{...display,id:43},{...display,scaleFactor:1.25},
    {...display,bounds:{...display.bounds,x:0}},{...display,bounds:{...display.bounds,width:1919}}])
    assert.equal(sameSelectionDisplay(display,d),false);
});

for(const scaleFactor of [1,1.25,1.5]) test(`exact full-display viewport correspondence at ${scaleFactor*100}% DPI`,()=>{
  const d={...display,scaleFactor};
  assert.equal(selectionViewportMatches({width:1920,height:1080,dpr:scaleFactor},d),true);
  assert.equal(selectionViewportMatches({width:1920,height:1032,dpr:scaleFactor},d),false,'workArea height is not full display');
});
test('there is no DPI tolerance for uncertain viewport size, scale or schema',()=>{
  for(const v of [{width:1919,height:1080,dpr:1},{width:1920.1,height:1080,dpr:1},
    {width:1920,height:1080,dpr:1.0001},{width:1920,height:1080,dpr:1,extra:true},null])
    assert.equal(selectionViewportMatches(v,display),false);
});
test('full display mapping does not acquire a workArea origin offset for top/side taskbars',()=>{
  const d={...display,bounds:{x:-1920,y:80,width:1920,height:1080},scaleFactor:1.25};
  // The user draws in the full-display surface; global=(-1900,120), local=(20,40).
  const global={x:-1900,y:120};
  const local={x:global.x-d.bounds.x,y:global.y-d.bounds.y,width:100,height:60};
  assert.deepEqual(pixelCrop(local,d,captureSize(d)),{x:25,y:50,width:125,height:75});
});
