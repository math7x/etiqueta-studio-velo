'use strict';
const C=LabelCore,$=id=>document.getElementById(id),{fields,pt,mm,clone}=C;
const cm=millimetres=>Math.round(millimetres*10000)/100000,cmPoints=p=>cm(mm(p));
const cmText=n=>String(cm(n)).replace('.',',');
let model=C.createA4(),original,selected=null,undo=[],redo=[],view='label',zoom=1,drag=null,busy=false,dirty=false,previewURL,previewPage=0,previewPages=1,previewForm;
const chosen=()=>model.elements.find(e=>e.id===selected),geo=()=>C.geometry(model.sheet),uuid=()=>Math.random().toString(36).slice(2,12);
function toast(text,error=false){$('toast').textContent=text;$('toast').className=error?'error':'';$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',error?10000:4500);}
function ask(text){return new Promise(resolve=>{const d=$('confirmDialog');$('confirmText').textContent=text;let done=false;const finish=v=>{if(done)return;done=true;d.close();resolve(v);};$('confirmYes').onclick=()=>finish(true);$('confirmNo').onclick=()=>finish(false);d.oncancel=e=>{e.preventDefault();finish(false);};d.showModal();});}
function mark(){dirty=true;$('status').textContent='Alterações no projeto · salve para continuar depois';}
function checkpoint(){undo.push(clone(model));if(undo.length>80)undo.shift();redo=[];mark();}
function undoAction(){if(!undo.length)return;redo.push(clone(model));model=undo.pop();selected=null;mark();render();}
function redoAction(){if(!redo.length)return;undo.push(clone(model));model=redo.pop();selected=null;mark();render();}
function parseModel(xml){
 if(xml.length>400000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Arquivo XML não permitido.');
 const d=new DOMParser().parseFromString(xml,'application/xml');if(d.querySelector('parsererror'))throw Error('XML inválido.');
 const r=d.documentElement;if(r.localName!=='jasperReport')throw Error('Abra um JRXML ou projeto deste editor. Arquivos Zebra .lbl/.nlbl não são JRXML.');
 const allowed=new Set(['jasperReport','property','parameter','defaultValueExpression','queryString','field','background','detail','band','staticText','textField','text','textElement','font','textFieldExpression','componentElement','reportElement','printWhenExpression','barbecue','codeExpression','line','graphicElement','pen','rectangle']);
 for(const n of d.getElementsByTagName('*'))if(!allowed.has(n.localName))throw Error('Recurso não suportado: '+n.localName+'. O arquivo não foi alterado.');
 const direct=(n,tag)=>Array.from(n.children).find(e=>e.localName===tag), get=(n,a,def)=>n?.hasAttribute(a)?n.getAttribute(a):def;
 if(direct(r,'queryString')?.textContent.replace(/\s/g,'')!==C.query.replace(/\s/g,''))throw Error('A consulta do modelo não corresponde à integração do seu sistema.');
 if(direct(r,'background')?.textContent.trim()||direct(r,'background')?.querySelector('reportElement'))throw Error('Modelos com objetos de fundo ainda não são suportados.');
 const detail=direct(r,'detail'),bands=detail?Array.from(detail.children):[];if(!bands.length)throw Error('Modelo sem conteúdo de etiqueta.');
 const props=Object.fromEntries(Array.from(r.children).filter(e=>e.localName==='property').map(e=>[e.getAttribute('name'),e.getAttribute('value')]));
 let s;if(props['ireport.etiquetaStudio.layout'])s=JSON.parse(props['ireport.etiquetaStudio.layout']);
 else {if(bands.length!==1)throw Error('JRXML com vários blocos precisa ter os metadados deste editor.');const h=+bands[0].getAttribute('height'),pw=+r.getAttribute('pageWidth'),ph=+r.getAttribute('pageHeight'),top=+get(r,'topMargin',0),bottom=+get(r,'bottomMargin',0);s={mode:pw===595&&ph===842?'a4':'legacy',pageWidth:mm(pw),pageHeight:mm(ph),labelWidth:mm(+r.getAttribute('columnWidth')),labelHeight:mm(h),cols:+get(r,'columnCount',1),rows:Math.max(1,Math.floor((ph-top-bottom)/h)),hgap:mm(+get(r,'columnSpacing',0)),vgap:0,left:mm(+get(r,'leftMargin',0)),right:mm(+get(r,'rightMargin',0)),top:mm(top),bottom:mm(bottom),offsetX:0,offsetY:0};if(s.mode==='a4'){s.pageWidth=210;s.pageHeight=297;}else{s.right=Math.max(0,Math.round((s.pageWidth-s.left-s.cols*s.labelWidth-(s.cols-1)*s.hgap)*1000)/1000);s.bottom=Math.max(0,Math.round((s.pageHeight-s.top-s.rows*s.labelHeight)*1000)/1000);}}
 const m={version:2,name:r.getAttribute('name')||'etiqueta',sheet:s,elements:[]};
 const meta=props['ireport.etiquetaStudio.objects']?JSON.parse(props['ireport.etiquetaStudio.objects']):[];
 for(const n of bands[0].children){
  if(n.localName==='printWhenExpression')continue;
  const re=direct(n,'reportElement');if(!re)throw Error('Objeto sem posição.');
  const kind={componentElement:'barcode',staticText:'static',textField:'field',line:'line',rectangle:'rectangle'}[n.localName];if(!kind)throw Error('Objeto não suportado.');
  const te=direct(n,'textElement'),font=te?.getElementsByTagName('font')[0];let field='';
  if(kind==='field'){const match=/^\$F\{([a-zA-Z]+)\}$/.exec(direct(n,'textFieldExpression')?.textContent.trim()||'');if(!match||!fields[match[1]])throw Error('Expressão não suportada.');field=match[1];}
  const bar=Array.from(n.getElementsByTagName('*')).find(e=>e.localName==='barbecue');if(kind==='barcode'&&(!bar||bar.getAttribute('type')!=='EAN13'))throw Error('Esta versão suporta EAN-13 Barbecue.');
  const label=kind==='field'?fields[field]:{barcode:'Código de barras',static:'Texto livre',line:'Linha',rectangle:'Retângulo'}[kind],author=meta[m.elements.length];
  m.elements.push({id:uuid(),kind,field,label:author?.label||label,locked:!!author?.locked,x:+re.getAttribute('x'),y:+re.getAttribute('y'),w:+re.getAttribute('width'),h:+re.getAttribute('height'),font:get(font,'fontName','SansSerif'),size:+get(font,'size',10),bold:get(font,'isBold','false')==='true',align:get(te,'textAlignment','Left'),vertical:get(te,'verticalAlignment','Top'),grow:false,text:direct(n,'text')?.textContent||'',module:+get(bar,'barWidth',1)});
 }
 C.validate(m);return m;
}
function fieldDisplay(e){return e.kind==='static'?e.text:`$F{${e.field}}`;}
function objectNode(e,scale,editable,index=0){
 const n=document.createElement('div');n.className='element'+(editable&&selected===e.id?' selected':'')+(e.locked?' locked':'');n.dataset.id=e.id;
 Object.assign(n.style,{left:e.x*scale+'px',top:e.y*scale+'px',width:e.w*scale+'px',height:e.h*scale+'px',fontFamily:e.font==='SansSerif'?'Arial':e.font,fontSize:e.size*scale+'px',fontWeight:e.bold?'700':'400',textAlign:e.align.toLowerCase(),justifyContent:{Top:'flex-start',Middle:'center',Bottom:'flex-end'}[e.vertical]});
 const content=document.createElement('div');content.className='content';
 if(e.kind==='barcode')content.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="159" height="39" fill="#edf3f2" stroke="#bdd2cc"/><path d="M55 7v18m4-18v18m7-18v18m3-18v18m6-18v18m7-18v18m3-18v18m5-18v18m7-18v18m5-18v18" stroke="#47776c" stroke-width="2"/><text x="80" y="35" text-anchor="middle" font-family="Arial" font-size="7" fill="#47776c">EAN-13 · campo do Velo</text></svg>';
 else if(e.kind==='line')content.style.borderTop=Math.max(.4,scale*.5)+'px solid #222';else if(e.kind==='rectangle')content.style.border=Math.max(.4,scale*.5)+'px solid #222';else{const text=document.createElement('div');text.textContent=fieldDisplay(e);text.style.lineHeight='1.164';content.style.justifyContent={Top:'safe flex-start',Middle:'safe center',Bottom:'safe flex-end'}[e.vertical];content.append(text);}
 n.append(content);if(editable){if(e.id===selected&&!e.locked)for(const dir of ['nw','ne','sw','se']){const h=document.createElement('span');h.className='handle '+dir;h.dataset.dir=dir;n.append(h);}n.onpointerdown=ev=>startDrag(ev,e.id);}return n;
}
function renderCanvas(){
 const g=geo(),whole=view==='sheet',w=whole?g.pw:g.cw,h=whole?g.ph:g.lh,scroll=$('canvasScroll');
 $('canvasTitle').textContent=whole?(model.sheet.mode==='a4'?'Folha A4 · 21 × 29,7 cm':`Papel ${cmText(model.sheet.pageWidth)} × ${cmText(model.sheet.pageHeight)} cm`):`Etiqueta ${cmText(model.sheet.labelWidth)} × ${cmText(model.sheet.labelHeight)} cm`;
 $('viewHint').textContent=whole?'Clique em uma etiqueta para editar o desenho compartilhado.':'Arraste os objetos e use as alças para redimensionar. O desenho vale para toda a folha.';
 zoom=$('zoom').value==='fit'?Math.max(.15,Math.min((scroll.clientWidth-76)/w,Math.max(130,scroll.clientHeight-74)/h,whole?1.2:6)):Number($('zoom').value);
 $('canvas').hidden=whole;$('sheet').hidden=!whole;$('canvasFrame').style.width=w*zoom+'px';$('canvasFrame').style.height=h*zoom+'px';
 const target=whole?$('sheet'):$('canvas');target.innerHTML='';target.style.width=w*zoom+'px';target.style.height=h*zoom+'px';
 target.style.setProperty('--grid',72/25.4*zoom+'px');target.classList.toggle('grid',!whole&&$('gridToggle').checked);
 if(whole){const count=Math.max(1,Math.min(1200,+$('sampleCount').value||g.capacity));for(let row=0;row<model.sheet.rows;row++)for(let col=0;col<model.sheet.cols;col++){const index=row*model.sheet.cols+col,cell=document.createElement('button');cell.className='sheetCell'+(index>=count?' unused':'');cell.title=`Posição ${index+1} · editar o desenho comum`;cell.setAttribute('aria-label',`Editar modelo da etiqueta ${index+1}`);Object.assign(cell.style,{left:(g.left+col*g.pitchX)*zoom+'px',top:(g.top+g.tops[row])*zoom+'px',width:g.cw*zoom+'px',height:g.lh*zoom+'px'});if(index<count)for(const e of model.elements)cell.append(objectNode(e,zoom,false,index));const num=document.createElement('span');num.className='cellNumber';num.textContent=index+1;cell.append(num);cell.onclick=()=>{view='label';$('zoom').value='fit';render();};target.append(cell);}}
 else for(const e of model.elements)target.append(objectNode(e,zoom,true));
 const rx=$('rulerX'),ry=$('rulerY');rx.innerHTML='';ry.innerHTML='';const step=whole?(zoom<.6?50:20):5;
 for(let i=0;i<=Math.floor(mm(w));i+=step){const n=document.createElement('i');n.className='tickX';n.style.left=i*72/25.4*zoom+'px';n.innerHTML=`<span>${cmText(i)}</span>`;rx.append(n);}for(let i=0;i<=Math.floor(mm(h));i+=step){const n=document.createElement('i');n.className='tickY';n.style.top=i*72/25.4*zoom+'px';n.innerHTML=`<span>${cmText(i)}</span>`;ry.append(n);}
 $('canvasTitle').textContent=whole?(model.sheet.mode==='a4'?'Folha A4 · 21 × 29,7 cm':`Papel ${cmText(model.sheet.pageWidth)} × ${cmText(model.sheet.pageHeight)} cm`):`Etiqueta ${cmText(model.sheet.labelWidth)} × ${cmText(model.sheet.labelHeight)} cm`;
 $('viewHint').textContent=whole?'Clique em uma etiqueta para editar o desenho compartilhado.':'Arraste os objetos e use as alças para redimensionar. O desenho vale para toda a folha.';
 $('sheetViewBtn').classList.toggle('active',whole);$('labelViewBtn').classList.toggle('active',!whole);$('pointInfo').textContent=`${Math.round(zoom*100)}% · ${cmText(mm(g.cw))} × ${cmText(mm(g.lh))} cm por etiqueta`;
 $('viewZoomValue').textContent=Math.round(zoom*100)+'%';$('viewZoomRange').value=Math.round(zoom*100);
 $('areaInfo').textContent=`${g.capacity} posições · ${model.sheet.cols} colunas × ${model.sheet.rows} linhas`;
}
function renderLayers(){const layer=$('layers');layer.innerHTML='';for(const e of model.elements){const b=document.createElement('button');b.className='layer'+(e.id===selected?' selected':'');const icon=document.createElement('strong');icon.textContent=e.kind==='barcode'?'▥':e.kind==='line'?'―':e.kind==='rectangle'?'▭':'T';const label=document.createElement('div');label.textContent=e.label;const lock=document.createElement('span');lock.textContent=e.locked?'▣':'';b.append(icon,label,lock);b.onclick=()=>{view='label';selected=e.id;renderSelection();};layer.append(b);}$('layerCount').textContent=model.elements.length;}
function renderInspector(){const e=chosen();$('inspector').hidden=!e;$('emptyInspector').hidden=!!e;$('selectionTitle').textContent=e?e.label:'Desenho compartilhado';if(!e)return;
 for(const [id,k] of [['elLabel','label'],['elText','text'],['elFont','font'],['elSize','size'],['elAlign','align'],['elVertical','vertical'],['barModule','module'],['elField','field']])$(id).value=e[k];
 for(const [id,k] of [['elX','x'],['elY','y'],['elW','w'],['elH','h']]){$(id).value=cmPoints(e[k]);$(id).disabled=e.locked;}
 $('elSize').value=cmPoints(e.size);$('barModule').value=cmPoints(e.module);
 $('elBold').checked=e.bold;$('elLocked').checked=e.locked;$('fieldWrap').hidden=e.kind!=='field';$('textWrap').hidden=e.kind!=='static';$('textOptions').hidden=!['field','static'].includes(e.kind);$('barcodeOptions').hidden=e.kind!=='barcode';for(const b of document.querySelectorAll('[data-align]'))b.disabled=e.locked;
 syncSizeControls();
}
function syncSizeControls(activeId){
 const e=chosen();if(!e)return;const g=geo();
 for(const [slider,numeric,key,max,locked] of [['elSizeRange','elSize','size',72,false],['elWRange','elW','w',Math.max(1,g.cw-e.x),e.locked],['elHRange','elH','h',Math.max(1,g.lh-e.y),e.locked]]){
  $(slider).max=max;$(slider).value=e[key];$(slider).disabled=locked;
  $(slider).setAttribute('aria-valuetext',cmText(mm(e[key]))+' cm');
  if(activeId!==numeric)$(numeric).value=cmPoints(e[key]);
 }
 $('fontSizeReadout').textContent=cmText(mm(e.size))+' cm';
 $('textLineInfo').textContent='Nesta caixa: aproximadamente '+Math.max(0,Math.floor(e.h/(e.size*1.164)))+' linha(s) com esta fonte. Confira o nome real na prévia do Velo.';
}
function renderWarnings(){
 const problems=C.issues(model),warnings=[];for(const e of model.elements){if(e.kind==='barcode'&&mm(e.w)<30)warnings.push('Código de barras estreito: confira margens brancas e leitura na impressão.');}
 if(view==='label')for(const el of $('canvas').querySelectorAll('.element')){const e=model.elements.find(e=>e.id===el.dataset.id),text=el.querySelector('.content > div');const overflow=!!text&&(text.scrollHeight>e.h*zoom+1||text.scrollWidth>e.w*zoom+1);el.classList.toggle('textOverflow',overflow);if(overflow)warnings.push(e.label+': falta espaço dentro da caixa. Aumente a altura ou reduza a fonte. A quebra de linha já está ativa.');}
 for(const [id,list] of [['layoutErrors',problems],['warnings',warnings]]){$(id).innerHTML='';for(const text of [...new Set(list)]){const n=document.createElement('div');n.className='warning';n.textContent=text;$(id).append(n);}}
 if(!warnings.length)$('warnings').innerHTML='<div class="ok">✓ Confira o resultado na prévia real.</div>';
 for(const id of ['exportBtn','previewBtn','xmlBtn','calibrationBtn'])$(id).disabled=busy||problems.length>0;
}
function renderSelection(){renderCanvas();renderLayers();renderInspector();renderWarnings();$('undoBtn').disabled=!undo.length;$('redoBtn').disabled=!redo.length;}
const sheetInputs={pageW:'pageWidth',pageH:'pageHeight',labelW:'labelWidth',labelH:'labelHeight',columns:'cols',rows:'rows',hgap:'hgap',vgap:'vgap',lm:'left',rm:'right',tm:'top',bm:'bottom',offsetX:'offsetX',offsetY:'offsetY'};
function render(){for(const [id,k] of Object.entries(sheetInputs))$(id).value=['cols','rows'].includes(k)?model.sheet[k]:cm(model.sheet[k]);$('paperMode').value=model.sheet.mode==='a4'?'a4':'custom';$('customPaper').hidden=model.sheet.mode==='a4';$('reportName').value=model.name;$('docTitle').textContent=model.name;const g=geo();$('paperInfo').textContent=`${g.capacity} etiquetas por folha\nGrade: ${cmText(mm(g.usedWidth))} × ${cmText(mm(g.usedHeight))} cm`;$('exampleNote').hidden=$('preset').value!=='a4';renderSelection();}
function clamp(e){const g=geo();e.w=Math.max(1,Math.min(e.w,g.cw));e.h=Math.max(1,Math.min(e.h,g.lh));e.x=Math.max(0,Math.min(e.x,g.cw-e.w));e.y=Math.max(0,Math.min(e.y,g.lh-e.h));}
function startDrag(ev,id){if(ev.button!==0)return;ev.preventDefault();selected=id;const e=chosen();if(e.locked){renderSelection();return;}drag={id,dir:ev.target.dataset.dir||'',sx:ev.clientX,sy:ev.clientY,base:clone(e),saved:false};renderSelection();window.addEventListener('pointermove',moveDrag);window.addEventListener('pointerup',endDrag,{once:true});}
function moveDrag(ev){if(!drag)return;const dx=Math.round((ev.clientX-drag.sx)/zoom),dy=Math.round((ev.clientY-drag.sy)/zoom);if(!drag.saved&&(dx||dy)){checkpoint();drag.saved=true;}if(!drag.saved)return;const e=chosen(),b=drag.base;if(!drag.dir){e.x=b.x+dx;e.y=b.y+dy;if($('snapToggle').checked){e.x=Math.round(e.x/2)*2;e.y=Math.round(e.y/2)*2;}}else{const left=drag.dir.includes('w'),top=drag.dir.includes('n');e.x=left?b.x+dx:b.x;e.y=top?b.y+dy:b.y;e.w=left?b.w-dx:b.w+dx;e.h=top?b.h-dy:b.h+dy;}clamp(e);renderCanvas();renderInspector();}
function endDrag(){window.removeEventListener('pointermove',moveDrag);drag=null;renderWarnings();$('undoBtn').disabled=!undo.length;}
function changeObject(fn,position=false){const e=chosen();if(!e)return;if(position&&e.locked)return;checkpoint();fn(e);if(position)clamp(e);renderSelection();}
function add(k){checkpoint();view='label';const g=geo(),kind=fields[k]?'field':k,e={id:uuid(),kind,field:kind==='field'?k:'',label:kind==='field'?fields[k]:{static:'Texto livre',barcode:'Código de barras',line:'Linha',rectangle:'Retângulo'}[kind],x:2,y:2,w:g.cw-4,h:Math.min(kind==='barcode'?23:kind==='line'?1:12,g.lh-2),font:'SansSerif',size:k==='precoVenda'?12:7,bold:true,align:'Center',vertical:'Middle',grow:false,text:'Seu texto aqui',module:1,locked:false};clamp(e);model.elements.push(e);selected=e.id;render();}
function remove(){if(!chosen())return;checkpoint();model.elements=model.elements.filter(e=>e.id!==selected);selected=null;render();}
function duplicate(){const e=chosen();if(!e)return;checkpoint();const n=clone(e);n.id=uuid();n.label+=' cópia';n.locked=false;n.x+=2;n.y+=2;clamp(n);model.elements.push(n);selected=n.id;view='label';render();}
const nativeSaves=new Map();let nativeSaveId=0;
if(window.chrome?.webview)window.chrome.webview.addEventListener('message',event=>{const m=event.data;if(m?.type==='save-result'&&nativeSaves.has(m.id)){const task=nativeSaves.get(m.id);nativeSaves.delete(m.id);m.error?task.reject(new Error(m.error)):task.resolve(m.saved);}});
async function download(name,data,type='text/plain;charset=utf-8'){
 const blob=data instanceof Blob?data:new Blob([data],{type});
 if(window.chrome?.webview){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const id=++nativeSaveId;return new Promise((resolve,reject)=>{nativeSaves.set(id,{resolve,reject});window.chrome.webview.postMessage({type:'save-file',id,name,base64:btoa(binary)});});}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return true;
}
function formData(){return {jrxml:C.buildXml(model),sampleCount:$('sampleCount').value};}
async function processOutput(mode,page=0){if(busy)return;try{const form=mode==='preview-page'?previewForm:formData();busy=true;renderWarnings();$('status').textContent='Gerando arquivo com JasperReports 3.7.2…';const actual=mode==='preview-page'?'preview':mode,res=await fetch('api/'+actual,{method:'POST',body:new URLSearchParams({...form,page})});if(!res.ok)throw Error(await res.text());const blob=await res.blob();if(actual==='preview'){previewForm=form;previewPage=page;previewPages=Number(res.headers.get('X-Preview-Pages'))||1;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);$('realPreview').src=previewURL;$('pageNumber').textContent=`Página ${page+1} de ${previewPages}`;$('prevPage').disabled=page===0;$('nextPage').disabled=page>=previewPages-1;if(!$('previewDialog').open)$('previewDialog').showModal();}
  else {const ext=actual==='export'?'-para-sistema.zip':actual==='calibration'?'-calibracao.pdf':'-previa.pdf';if(!await download(model.name+ext,blob)){$('status').textContent='Salvamento cancelado';return;}toast(actual==='export'?'Pacote gerado: JRXML, JASPER, prévia e calibração.':'Arquivo salvo. Para imprimir PDF, selecione tamanho real (100%).');}$('status').textContent='Arquivo gerado · confira a impressão em tamanho real (100%)';
 }catch(e){toast(e.message,true);$('status').textContent='Revise o aviso para gerar o arquivo.';}finally{busy=false;renderWarnings();}}
function bind(){
 // One undo entry per slider gesture or numeric edit; keep the caret while typing.
 const bindLiveSize=(id,key,points=false,position=false)=>{
  const control=$(id);let editingId=null;
  control.oninput=()=>{const e=chosen();if(!e||(position&&e.locked)||control.value.trim()==='')return;
   const raw=Number(control.value);if(!Number.isFinite(raw)||raw<0)return;
   let value=points?Math.round(raw):pt(raw*10);const g=geo();
   value=Math.max(key==='size'?3:1,Math.min(key==='size'?72:key==='w'?Math.max(1,g.cw-e.x):key==='h'?Math.max(1,g.lh-e.y):1700,value));
   if(e[key]===value)return;if(editingId!==e.id){checkpoint();editingId=e.id;}
   e[key]=value;if(position)clamp(e);syncSizeControls(id);renderCanvas();renderWarnings();$('undoBtn').disabled=!undo.length;$('redoBtn').disabled=!redo.length;
  };
  const finish=()=>{editingId=null;renderInspector();renderWarnings();};control.onchange=finish;control.onblur=finish;
 };
 bindLiveSize('elSize','size');bindLiveSize('elSizeRange','size',true);bindLiveSize('elW','w',false,true);bindLiveSize('elWRange','w',true,true);bindLiveSize('elH','h',false,true);bindLiveSize('elHRange','h',true,true);
 $('fontSmaller').onclick=()=>changeObject(e=>e.size=Math.max(3,e.size-1));$('fontLarger').onclick=()=>changeObject(e=>e.size=Math.min(72,e.size+1));
 const setViewZoom=value=>{const select=$('zoom');let n=Math.max(15,Math.min(600,Math.round(value)));const val=String(n/100);if(!Array.from(select.options).some(o=>o.value===val)){const opt=document.createElement('option');opt.value=val;opt.textContent=n+'%';opt.dataset.custom='true';for(const o of Array.from(select.options))if(o.dataset.custom)o.remove();select.append(opt);}select.value=val;renderCanvas();renderWarnings();};
 $('viewZoomIn').onclick=()=>setViewZoom(zoom*100+10);$('viewZoomOut').onclick=()=>setViewZoom(zoom*100-10);$('viewZoomRange').oninput=()=>setViewZoom(+$('viewZoomRange').value);$('viewZoomFit').onclick=()=>{$('zoom').value='fit';renderCanvas();$('canvasScroll').scrollTo(0,0);renderWarnings();};
 $('undoBtn').onclick=undoAction;$('redoBtn').onclick=redoAction;$('duplicateBtn').onclick=duplicate;$('deleteBtn').onclick=remove;
 for(const [id,v] of [['sheetViewBtn','sheet'],['labelViewBtn','label']])$(id).onclick=()=>{view=v;$('zoom').value='fit';renderSelection();};$('zoom').onchange=renderCanvas;$('gridToggle').onchange=renderCanvas;
 for(const b of document.querySelectorAll('[data-add]'))b.onclick=()=>add(b.dataset.add);$('extraField').onchange=()=>{if($('extraField').value)add($('extraField').value);$('extraField').value='';};$('canvas').onpointerdown=e=>{if(e.target===$('canvas')){selected=null;renderSelection();}};
 for(const [id,k] of [['elLabel','label'],['elText','text'],['elFont','font'],['elAlign','align'],['elVertical','vertical'],['elField','field']])$(id).onchange=()=>changeObject(e=>e[k]=$(id).value);
 $('barModule').onchange=()=>changeObject(e=>e.module=Math.max(1,Math.min(3,pt(Number($('barModule').value)*10)||1)));
 for(const [id,k] of [['elBold','bold'],['elLocked','locked']])$(id).onchange=()=>changeObject(e=>e[k]=$(id).checked);
 for(const [id,k] of [['elX','x'],['elY','y']])$(id).onchange=()=>changeObject(e=>e[k]=Math.max(0,pt(Number($(id).value)*10)||0),true);
 for(const b of document.querySelectorAll('[data-align]'))b.onclick=()=>changeObject(e=>{const g=geo(),a=b.dataset.align;if(['left','center','right'].includes(a))e.x=a==='left'?0:a==='right'?g.cw-e.w:Math.round((g.cw-e.w)/2);else e.y=a==='top'?0:a==='bottom'?g.lh-e.h:Math.round((g.lh-e.h)/2);},true);
 for(const [id,front] of [['frontBtn',true],['backBtn',false]])$(id).onclick=()=>{if(!chosen())return;checkpoint();const e=chosen();model.elements=model.elements.filter(x=>x!==e);front?model.elements.push(e):model.elements.unshift(e);renderSelection();};
 $('reportName').onchange=()=>{const n=$('reportName').value.trim();if(!/^[a-zA-Z_][a-zA-Z0-9_-]{0,59}$/.test(n)){toast('Use letras sem acento, números, hífen e sublinhado. Comece por uma letra.',true);$('reportName').value=model.name;return;}checkpoint();model.name=n;render();};
 for(const [id,k] of Object.entries(sheetInputs))$(id).onchange=()=>{let v=Number($(id).value);if(!["cols","rows"].includes(k))v*=10;if(!Number.isFinite(v)||(['cols','rows'].includes(k)&&(v<1||v>(k==='cols'?10:60)))||(!['offsetX','offsetY'].includes(k)&&v<0)||(['labelWidth','labelHeight'].includes(k)&&v<5)||(['pageWidth','pageHeight','labelWidth','labelHeight'].includes(k)&&v>600)||(['offsetX','offsetY'].includes(k)&&Math.abs(v)>30)){toast('Medida fora dos limites.',true);render();return;}if(['cols','rows'].includes(k)){v=Math.round(v);if(v===model.sheet[k]){render();return;}try{const next=C.resizeGrid(model,k,v);checkpoint();model=next;$('zoom').value='fit';$('preset').value='custom';render();toast('Grade ajustada à folha. Etiquetas e desenho redimensionados.');}catch(e){toast(e.message,true);render();}return;}checkpoint();model.sheet[k]=v;$('preset').value='custom';render();};
 $('paperMode').onchange=()=>{checkpoint();model.sheet.mode=$('paperMode').value;if(model.sheet.mode==='a4'){model.sheet.pageWidth=210;model.sheet.pageHeight=297;}$('preset').value='custom';render();};
 $('preset').onchange=async()=>{const p=$('preset').value;if(p==='custom')return;if(dirty&&!await ask('Substituir o desenho pelo modelo de partida? Você pode desfazer.')){$('preset').value='custom';return;}checkpoint();model=p==='a4'?C.createA4():clone(original);selected=null;view='label';$('sampleCount').value=geo().capacity;render();};
 $('sampleCount').oninput=()=>{renderCanvas();renderWarnings();};
 $('saveBtn').onclick=async()=>{try{C.validate(model);if(!await download(model.name+'.etiqueta.json',JSON.stringify(model,null,2),'application/json'))return;dirty=false;$('status').textContent='Projeto salvo · guarde o arquivo para reabrir depois';toast('Projeto salvo com desenho e medidas da folha.');}catch(e){toast(e.message,true);}};
 $('xmlBtn').onclick=async()=>{try{if(!await download(model.name+'.jrxml',C.buildXml(model),'application/xml'))return;toast('JRXML gerado. Use “Exportar para o Velo” para obter o pacote completo.');}catch(e){toast(e.message,true);}};
 $('exportBtn').onclick=()=>processOutput('export');$('previewBtn').onclick=()=>processOutput('preview');$('calibrationBtn').onclick=()=>processOutput('calibration');$('pdfBtn').onclick=()=>processOutput('pdf');$('prevPage').onclick=()=>processOutput('preview-page',previewPage-1);$('nextPage').onclick=()=>processOutput('preview-page',previewPage+1);$('dismissPreview').onclick=()=>$('previewDialog').close();$('helpBtn').onclick=()=>$('helpDialog').showModal();$('dismissHelp').onclick=()=>$('helpDialog').close();
 $('openBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=async()=>{const f=$('fileInput').files[0];if(!f)return;try{if(f.size>500000)throw Error('Arquivo muito grande.');const text=await f.text(),next=text.trimStart().startsWith('{')?C.migrate(JSON.parse(text)):parseModel(text);if(dirty&&!await ask('Abrir o arquivo e substituir o desenho? Você pode desfazer.'))return;checkpoint();model=next;selected=null;view='label';$('preset').value='custom';$('sampleCount').value=geo().capacity;render();toast('Projeto aberto. Confira a prévia real antes de usar no sistema.');}catch(e){toast(e.message,true);}finally{$('fileInput').value='';}};
 $('closeBtn').onclick=async()=>{if(!await ask(dirty?'Há alterações não salvas. Encerrar mesmo assim?':'Encerrar o Etiqueta Studio?'))return;try{const r=await fetch('api/close',{method:'POST'});if(!r.ok)throw Error('Falha ao encerrar.');dirty=false;document.body.innerHTML='<div style="padding:80px;font:20px Segoe UI;text-align:center">Etiqueta Studio encerrado.<p style="font-size:14px">Você pode fechar esta aba.</p></div>';}catch(e){toast(e.message,true);}};
 document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;const ctrl=e.ctrlKey||e.metaKey;if(ctrl&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoAction():undoAction();}else if(ctrl&&e.key.toLowerCase()==='y'){e.preventDefault();redoAction();}else if(ctrl&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&chosen()&&view==='label'){e.preventDefault();changeObject(x=>{const s=e.shiftKey?5:1;x.x+=e.key==='ArrowLeft'?-s:e.key==='ArrowRight'?s:0;x.y+=e.key==='ArrowUp'?-s:e.key==='ArrowDown'?s:0;},true);}});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});window.addEventListener('resize',()=>renderCanvas());
}
async function init(){try{const r=await fetch('base.jrxml');if(!r.ok)throw Error('Modelo original indisponível.');original=parseModel(await r.text());for(const [key,label] of Object.entries(fields)){for(const id of ['elField','extraField']){const o=document.createElement('option');o.value=key;o.textContent=label;$(id).append(o);}}bind();render();$('status').textContent='Modelo A4 de exemplo · ajuste às medidas da sua folha';$('engineStatus').textContent=await(await fetch('api/status')).text();}catch(e){toast(e.message,true);$('status').textContent='Falha ao iniciar: '+e.message;}}
function simplifyLayout(){
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 const help=(parent,text)=>{const b=node('button','helpTip','?');b.type='button';b.dataset.help=text;b.setAttribute('aria-label','Mais informações');parent.append(b);return b;};
 const fold=(title,nodes,parent)=>{const d=node('details','quietDetails'),s=node('summary','',title);d.append(s,...nodes);parent.append(d);return d;};
 const left=document.querySelector('.leftpanel'),sections=Array.from(left.querySelectorAll(':scope > section'));
 const tabs=node('div','panelTabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Configuração e elementos');
 const paper=node('div','panelContent'),objects=node('div','panelContent');paper.id='paperPanel';objects.id='objectsPanel';paper.append(sections[0]);objects.append(...sections.slice(1));
 for(const [title,panel] of [['Elementos',objects],['Folha',paper]]){const b=node('button','',title);b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);b.id=panel.id+'Tab';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);tabs.append(b);b.onclick=()=>{for(const [p,tab] of [[objects,tabs.children[0]],[paper,tabs.children[1]]]){p.hidden=p!==panel;tab.setAttribute('aria-selected',String(p===panel));}};}
 left.prepend(tabs);left.append(objects,paper);tabs.children[0].click();
 document.querySelector('.localnote').hidden=true;
 for(const e of document.querySelectorAll('.eyebrow,.compat,.hint,#exampleNote,#viewHint,#engineStatus,.badge'))e.hidden=true;
 sections[0].querySelector('h2').textContent='Configurar folha';sections[1].querySelector('h2').textContent='Adicionar';
 const groups=sections[0].querySelectorAll('.configGroup');
 const first=groups[0];first.querySelector('.groupTitle').remove();
 const name=$('reportName').parentElement;fold('Nome do arquivo',[name],sections[0]);
 first.querySelector('label').firstChild.textContent='Modelo';
 const size=groups[1];size.querySelector('.groupTitle').textContent='Etiquetas · cm';
 help(size.querySelector('.groupTitle'),'Todas as medidas estão em centímetros. Ao mudar a quantidade de colunas ou linhas, as etiquetas e o desenho são redimensionados para caber na folha.');
 groups[2].open=false;help(groups[2].querySelector('summary'),'Distância entre a borda do papel e a área das etiquetas. Meça sua folha e informe cada lado em centímetros.');
 help(groups[3].querySelector('summary'),'Move todas as etiquetas juntas para acertar a impressão. X positivo move à direita; Y positivo move para baixo. Imprima a calibração em tamanho real, 100%.');
 groups[3].querySelector('p').hidden=true;
 help(first.querySelector('label'),'O modelo A4 é um exemplo de três colunas. Ajuste às medidas da sua folha. A opção 3,2 × 2,2 cm mantém a fileira original.');
 help(sections[1].querySelector('h2'),'Produto, preço, referência e barras recebem os dados do Velo. Texto fixo imprime exatamente o que você digitar. O desenho é repetido em todas as etiquetas.');
 help(sections[2].querySelector('h2'),'Selecione um elemento para editar. Arraste na etiqueta, use as alças para redimensionar ou as setas do teclado para mover.');
 $('exportBtn').textContent='Exportar para o Velo';$('previewBtn').textContent='Prévia';$('saveBtn').textContent='Salvar';$('helpBtn').textContent='?';$('helpBtn').setAttribute('aria-label','Abrir ajuda geral');
 help($('exportBtn').parentElement,'Gera um pacote com JRXML, JASPER, PDF de teste e calibração. Extraia o arquivo .jasper e importe no Velo. O sistema preencherá os produtos reais.');
 $('zoom').hidden=true;
 const files=fold('Outras opções',[$('xmlBtn'),$('gridToggle').parentElement,$('snapToggle').parentElement],sections[0]);help(files.querySelector('summary'),'JRXML exporta apenas o desenho editável. Grade mostra os pontos de referência; encaixe facilita o posicionamento ao arrastar.');
 const heading=document.querySelector('.workspaceHeading');heading.querySelector('h1').before(node('span','workspaceKicker','ÁREA DE EDIÇÃO'));
 const zoomBar=document.querySelector('.viewZoom');zoomBar.firstElementChild.textContent='Zoom';$('viewZoomFit').textContent='Encaixar';
 const panel=document.querySelector('.veloPanel');panel.querySelector('div').hidden=true;panel.className='previewSettings';
 $('sampleCount').parentElement.firstChild.textContent='Etiquetas no teste';help(panel,'Quantidade de produtos fictícios usada somente na prévia e no PDF. Na impressão, o Velo fornece os produtos e as quantidades.');
 const inspector=$('inspector'),advanced=node('div','advancedFields');
 const objectName=$('elLabel').parentElement,lock=$('elLocked').parentElement,field=$('fieldWrap');advanced.append(objectName,field,lock);
 const subheads=Array.from(inspector.querySelectorAll(':scope > .subheading'));
 const pos=$('elX').closest('.formrow'),dims=$('elW').closest('.formrow');advanced.append(pos);
 const align=inspector.querySelector('.aligngrid'),order=inspector.querySelector('.buttonrow');advanced.append(subheads[1],align,subheads[2],order);subheads[0].remove();
 inspector.prepend($('textWrap'),$('textOptions'),$('barcodeOptions'),dims);
 fold('Posição e organização',[advanced],inspector);
 $('emptyInspector').textContent='Selecione um elemento na etiqueta ou na lista ao lado.';
 const selectionHeading=node('div','selectionHeading');$('selectionTitle').before(selectionHeading);selectionHeading.append($('selectionTitle'));help(selectionHeading,'As alterações aparecem na hora. O Velo substitui os campos $F{...} pelos dados de cada produto na impressão.');
 const text=$('textOptions');text.querySelector('.subheading').remove();
 const wrap=text.querySelector('.wrapNotice');wrap.hidden=true;
 const line=node('div','textBehavior','Quebra de linha automática');help(line,'O texto ocupa várias linhas dentro da caixa. Se faltar espaço, aumente a altura ou reduza a fonte. A fonte não diminui automaticamente e a etiqueta mantém o tamanho configurado.');text.append(line);
 text.querySelector('.liveSizeHint').hidden=true;
 for(const [id,title] of [['elW','Largura · cm'],['elH','Altura · cm']])$(id).parentElement.firstChild.textContent=title;
 help(dims.querySelector('label'),'Largura e altura da caixa do elemento, em centímetros. Aumentar a altura permite mais linhas de texto.');
 help($('elSize').parentElement,'Tamanho da fonte em centímetros. Ajuste pelo número ou pela barra. Letras maiores precisam de mais espaço na caixa.');
 $('barcodeOptions').querySelector('p').hidden=true;help($('barModule').parentElement,'Espessura das barras EAN-13 em centímetros. Confira a leitura com seu leitor depois de imprimir em 100%.');
 const warnings=$('warnings').parentElement;warnings.classList.add('validationSection');
 // A single floating tooltip avoids clipping inside either scrolling sidebar.
 const tooltip=node('div','contextTooltip');tooltip.id='contextHelp';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;document.body.append(tooltip);let active=null;
 const hide=()=>{if(active)active.removeAttribute('aria-describedby');active=null;tooltip.hidden=true;};
 const show=b=>{hide();active=b;b.setAttribute('aria-describedby',tooltip.id);tooltip.textContent=b.dataset.help;tooltip.hidden=false;const r=b.getBoundingClientRect(),w=tooltip.offsetWidth,h=tooltip.offsetHeight;tooltip.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left+r.width/2-w/2))+'px';tooltip.style.top=(r.bottom+h+20<innerHeight?r.bottom+10:Math.max(12,r.top-h-10))+'px';};
 for(const b of document.querySelectorAll('.helpTip')){b.onmouseenter=()=>show(b);b.onmouseleave=hide;b.onfocus=()=>show(b);b.onblur=hide;b.onclick=e=>{e.preventDefault();e.stopPropagation();if(active===b)hide();else show(b);};}
 document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
}
simplifyLayout();init();
