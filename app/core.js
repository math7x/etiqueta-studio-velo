/* Geometry and JRXML generation, shared by the editor and regression tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LabelCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const K=72/25.4, pt=mm=>Math.round(Number(mm)*K), mm=pt=>Math.round(pt/K*1000)/1000;
const fields={produtoNome:'Nome do produto',codigoProduto:'Código do produto',codBarras:'Número das barras',precoVenda:'Preço de venda',unidadeVenda:'Unidade',produtoDescricao:'Referência do produto',coluna:'Coluna',linha:'Linha',produtoMarca:'Marca'};
const query='CALL prc_geraEtiquetaImprimir($P{produtoUnicoId},$P{produtoGradeUnicoId},$P{totalEtiquetas}, $P{elevaEmpresaId}, $P{veloId})';
const clone=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const round=n=>Math.round(n*1000)/1000;
function defaultSheet(){return {mode:'a4',pageWidth:210,pageHeight:297,labelWidth:63.5,labelHeight:25.4,cols:3,rows:10,hgap:2.5,vgap:0,left:7.25,right:7.25,top:21.5,bottom:21.5,offsetX:0,offsetY:0};}
function resizeGrid(m,key,count){
 if(!['cols','rows'].includes(key)||!Number.isInteger(count)||count<1||count>(key==='cols'?10:60))throw Error('Quantidade fora dos limites.');
 const next=clone(m),s=next.sheet,old=geometry(s);s[key]=count;
 const horizontal=key==='cols',available=horizontal?s.pageWidth-s.left-s.right-(count-1)*s.hgap:s.pageHeight-s.top-s.bottom-(count-1)*s.vgap;
 const dimension=Math.floor((available/count+1e-8)*1000)/1000;
 if(dimension<5)throw Error('Não há espaço para essa quantidade. Reduza os intervalos ou as margens.');
 s[horizontal?'labelWidth':'labelHeight']=dimension;const g=geometry(s),sx=g.cw/old.cw,sy=g.lh/old.lh;
 for(const e of next.elements){
  const right=Math.min(g.cw,Math.round((e.x+e.w)*sx)),bottom=Math.min(g.lh,Math.round((e.y+e.h)*sy));
  e.x=Math.max(0,Math.min(g.cw-1,Math.round(e.x*sx)));e.y=Math.max(0,Math.min(g.lh-1,Math.round(e.y*sy)));
  e.w=Math.max(1,right-e.x);e.h=Math.max(1,bottom-e.y);
  e.size=Math.max(3,Math.min(72,Math.round(e.size*(horizontal?sx:sy))));
 }
 validate(next);return next;
}
function geometry(s){
 // Keep objects inside the shortest quantized row; legacy integer heights survive mm migration.
 const pw=pt(s.pageWidth),ph=pt(s.pageHeight),cw=pt(s.labelWidth),lh=Math.floor(s.labelHeight*K+0.01),pitchX=pt(s.labelWidth+s.hgap),left=pt(s.left+s.offsetX),top=pt(s.top+s.offsetY);
 const tops=Array.from({length:s.rows},(_,r)=>pt(s.top+s.offsetY+r*(s.labelHeight+s.vgap))-top);
 const heights=tops.map((y,r)=>r<s.rows-1?tops[r+1]-y:lh);
 const usedHeight=tops[tops.length-1]+lh,usedWidth=(s.cols-1)*pitchX+cw;
 return {pw,ph,cw,lh,pitchX,left,top,tops,heights,usedWidth,usedHeight,right:pw-left-usedWidth,bottom:ph-top-usedHeight,capacity:s.cols*s.rows};
}
function issues(m,objects=true){
 const s=m.sheet,w=[];if(!s)return ['Projeto sem configuração de folha.'];
 for(const k of ['pageWidth','pageHeight','labelWidth','labelHeight','cols','rows','hgap','vgap','left','right','top','bottom','offsetX','offsetY'])if(!Number.isFinite(s[k]))return ['Medida inválida: '+k];
 if(s.pageWidth<10||s.pageWidth>600||s.pageHeight<10||s.pageHeight>600||s.labelWidth<5||s.labelHeight<5)w.push('Tamanho do papel ou etiqueta fora dos limites.');
 if(!Number.isInteger(s.cols)||s.cols<1||s.cols>10||!Number.isInteger(s.rows)||s.rows<1||s.rows>60)w.push('Use 1 a 10 colunas e 1 a 60 linhas.');
 if(['hgap','vgap','left','right','top','bottom'].some(k=>s[k]<0))w.push('Margens e intervalos não podem ser negativos.');
 if(Math.abs(s.offsetX)>30||Math.abs(s.offsetY)>30)w.push('O deslocamento máximo é de 3 cm.');
 if(s.cols*s.labelWidth+(s.cols-1)*s.hgap+s.left+s.right>s.pageWidth+0.001)w.push('As colunas ultrapassam a largura disponível. Reduza largura, intervalo ou margens.');
 if(s.rows*s.labelHeight+(s.rows-1)*s.vgap+s.top+s.bottom>s.pageHeight+0.001)w.push('As linhas ultrapassam a altura disponível. Reduza altura, intervalo ou margens.');
 if(w.length)return w;
 const g=geometry(s);if(g.left<0||g.top<0||g.right<0||g.bottom<0)w.push('O deslocamento faz etiquetas saírem da página.');
 if(g.heights.some(h=>h<g.lh))w.push('O intervalo vertical é pequeno demais após o arredondamento. Aumente-o em 0,01 cm.');
 if(objects)for(const e of m.elements||[])if(e.x<0||e.y<0||e.x+e.w>g.cw||e.y+e.h>g.lh)w.push(e.label+': objeto fora da etiqueta. Ajuste sua posição ou tamanho.');
 return w;
}
function validate(m){
 if(!m||m.version!==2||!Array.isArray(m.elements)||m.elements.length>60)throw Error('Projeto inválido ou com mais de 60 objetos.');
 if(!/^[a-zA-Z_][a-zA-Z0-9_-]{0,59}$/.test(m.name))throw Error('Nome inválido. Use letras sem acento, números, hífen e sublinhado.');
 const errors=issues(m);if(errors.length)throw Error(errors.join('\n'));
 const ids=new Set();for(const e of m.elements){
  if(typeof e.id!=='string'||ids.has(e.id)||typeof e.label!=='string'||e.label.length>100)throw Error('Identificação de objeto inválida.');ids.add(e.id);
  if(!['field','static','barcode','line','rectangle'].includes(e.kind))throw Error('Objeto não suportado.');
  if(e.kind==='field'&&!fields[e.field])throw Error('Campo desconhecido.');
  for(const k of ['x','y','w','h'])if(!Number.isInteger(e[k])||e[k]<0||e[k]>1700)throw Error('Posição de objeto inválida.');
  if(!e.w||!e.h||!['SansSerif','Arial','Serif','Monospaced'].includes(e.font)||!Number.isInteger(e.size)||e.size<3||e.size>72)throw Error('Tamanho ou fonte inválida.');
  if(!['Left','Center','Right'].includes(e.align)||!['Top','Middle','Bottom'].includes(e.vertical)||!Number.isInteger(e.module)||e.module<1||e.module>3||typeof e.text!=='string'||e.text.length>300)throw Error('Propriedade de objeto inválida.');
 }
 return geometry(m.sheet);
}
function migrate(old){
 if(old.version===2){validate(old);return clone(old);}
 if(old.version!==1)throw Error('Versão de projeto desconhecida.');
 const m={version:2,name:old.name,sheet:{mode:'legacy',pageWidth:mm(old.pw),pageHeight:mm(old.ph),labelWidth:mm(old.cw),labelHeight:mm(old.ph-old.tm-old.bm),cols:old.cols,rows:1,hgap:mm(old.gap),vgap:0,left:mm(old.lm),right:mm(old.rm),top:mm(old.tm),bottom:mm(old.bm),offsetX:0,offsetY:0},elements:clone(old.elements)};
 // Rounded legacy values can differ by a thousandth of a millimetre.
 m.sheet.right=Math.max(0,round(m.sheet.pageWidth-m.sheet.left-m.sheet.cols*m.sheet.labelWidth-(m.sheet.cols-1)*m.sheet.hgap));
 m.sheet.bottom=Math.max(0,round(m.sheet.pageHeight-m.sheet.top-m.sheet.labelHeight));
 for(const e of m.elements){e.locked=!!e.locked;e.grow=false;}
 validate(m);return m;
}
function createA4(){
 const base={font:'SansSerif',size:7,bold:true,align:'Center',vertical:'Middle',grow:false,text:'',module:1,locked:false};
 const el=(id,label,kind,field,x,y,w,h,extra={})=>Object.assign({},base,{id,label,kind,field,x,y,w,h},extra);
 return {version:2,name:'etiqueta_A4_3_colunas',sheet:defaultSheet(),elements:[el('produto','Nome do produto','field','produtoNome',9,2,162,17),el('numero','Número das barras','field','codBarras',12,21,156,7,{size:5}),el('barras','Código de barras','barcode','',32,29,116,23),el('preco','Preço de venda','field','precoVenda',9,53,162,18,{size:13})]};
}
function elementXml(e){
 const re=`<reportElement x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/>`;
 if(e.kind==='barcode')return `<componentElement><reportElement x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" isRemoveLineWhenBlank="true"><printWhenExpression><![CDATA[$F{codBarras} != null && $F{codBarras}.matches("[0-9]{13}")]]></printWhenExpression></reportElement><jr:barbecue xmlns:jr="http://jasperreports.sourceforge.net/jasperreports/components" xsi:schemaLocation="http://jasperreports.sourceforge.net/jasperreports/components http://jasperreports.sourceforge.net/xsd/components.xsd" type="EAN13" drawText="false" checksumRequired="false" barWidth="${e.module}" barHeight="${e.h}"><jr:codeExpression><![CDATA[$F{codBarras}.substring(0,12)]]></jr:codeExpression></jr:barbecue></componentElement>`;
 if(e.kind==='line'||e.kind==='rectangle')return `<${e.kind}>${re}<graphicElement><pen lineWidth="0.5"/></graphicElement></${e.kind}>`;
 // Jasper 3.7.2 wraps text naturally; keep single spacing and the box/band height fixed.
 const te=`<textElement textAlignment="${e.align}" verticalAlignment="${e.vertical}" lineSpacing="Single" markup="none"><font fontName="${e.font}" size="${e.size}" isBold="${!!e.bold}"/></textElement>`;
 if(e.kind==='static')return `<staticText>${re}${te}<text>${esc(e.text)}</text></staticText>`;
 return `<textField isStretchWithOverflow="false" isBlankWhenNull="true"${e.field==='precoVenda'?' pattern="¤ #,##0.00"':''}>${re}${te}<textFieldExpression class="${e.field==='precoVenda'?'java.math.BigDecimal':'java.lang.String'}"><![CDATA[$F{${e.field}}]]></textFieldExpression></textField>`;
}
function buildXml(m){
 const g=validate(m),s=m.sheet;let props='';const property=(k,v)=>`<property name="ireport.etiquetaStudio.${k}" value="${esc(v)}"/>`;
 props+=property('layout',JSON.stringify(s))+property('rows',s.rows)+property('labelHeight',g.lh)+property('rowTops',g.tops.join(','));
 // Retain authoring metadata for exact project recovery from exported JRXML.
 props+=property('objects',JSON.stringify(m.elements.map(e=>({label:e.label,locked:!!e.locked}))));
 const groups=new Map();g.heights.forEach((h,i)=>{if(!groups.has(h))groups.set(h,[]);groups.get(h).push(i);});
 const contents=m.elements.map(elementXml).join('\n');
 const rowExpr=`(($V{REPORT_COUNT}.intValue()-1)/${s.cols})%${s.rows}`;
 let bands='';for(const [height,rows] of groups){
  const when=groups.size===1?'':`<printWhenExpression><![CDATA[${rows.map(r=>`(${rowExpr} == ${r})`).join(' || ')}]]></printWhenExpression>`;
  bands+=`<band height="${height}" splitType="Prevent">${when}${contents}</band>`;
 }
 const params='<parameter name="produtoUnicoId" class="java.lang.String"/><parameter name="totalEtiquetas" class="java.lang.Integer"/><parameter name="veloId" class="java.lang.Integer"><defaultValueExpression><![CDATA[1]]></defaultValueExpression></parameter><parameter name="produtoGradeUnicoId" class="java.lang.String"/><parameter name="elevaEmpresaId" class="java.lang.String"><defaultValueExpression><![CDATA["1"]]></defaultValueExpression></parameter>';
 return `<?xml version="1.0" encoding="UTF-8"?>\n<jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://jasperreports.sourceforge.net/jasperreports http://jasperreports.sourceforge.net/xsd/jasperreport.xsd" name="${m.name}" language="java" columnCount="${s.cols}" printOrder="Horizontal" pageWidth="${g.pw}" pageHeight="${g.ph}" columnWidth="${g.cw}" columnSpacing="${g.pitchX-g.cw}" leftMargin="${g.left}" rightMargin="${g.right}" topMargin="${g.top}" bottomMargin="${g.bottom}">${props}${params}<queryString><![CDATA[${query}]]></queryString>${Object.keys(fields).map(f=>`<field name="${f}" class="${f==='precoVenda'?'java.math.BigDecimal':'java.lang.String'}"/>`).join('')}<detail>${bands}</detail></jasperReport>`;
}
return {pt,mm,fields,query,clone,esc,defaultSheet,geometry,issues,validate,migrate,createA4,buildXml,resizeGrid};
});
