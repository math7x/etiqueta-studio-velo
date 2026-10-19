const assert=require('node:assert/strict');
const C=require('../app/core.js');
const model=C.createA4();
assert.equal(C.validate(model).capacity,30);
assert.deepEqual(C.migrate(C.clone(model)),model);
const xml=C.buildXml(model);
assert.match(xml,/pageWidth="595" pageHeight="842"/);
assert.match(xml,/printOrder="Horizontal"/);
assert.match(xml,/isStretchWithOverflow="false"/);
assert.match(xml,/lineSpacing="Single"/);
assert.ok(xml.includes(C.query));
for(const [key,value] of [['cols',11],['rows',0],['labelWidth',80],['left',-1]]){
 const bad=C.clone(model);bad.sheet[key]=value;assert.throws(()=>C.validate(bad),key);
}
const resized=C.resizeGrid(model,'cols',6),g=C.geometry(resized.sheet);
assert.equal(g.capacity,60);
assert.ok(g.left+g.usedWidth<=g.pw);
for(const e of resized.elements){assert.ok(e.x+e.w<=g.cw);assert.ok(e.y+e.h<=g.lh);}
assert.equal(C.validate(C.resizeGrid(resized,'rows',13)).capacity,78);
assert.equal(model.sheet.cols,3);
const reference=C.clone(model.elements[0]);reference.id='reference';reference.field='produtoDescricao';reference.label='Referência do produto';
model.elements.push(reference);assert.match(C.buildXml(model),/\$F\{produtoDescricao\}/);
console.log('PASSOU: geometria A4, contrato Velo, altura fixa, quebra de linha, limites, redimensionamento, migração JSON e referência.');
