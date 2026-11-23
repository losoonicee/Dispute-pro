/* Dispute Studio Intake 14: document-first report extraction.
   Never invent a field, never create a dispute allegation from scan results.
   Uses the existing private AI connection only after explicit consent. */
'use strict';
const Intake={mode:'one',busy:false,ready:false,status:'',lastError:'',pasted:'',sourceEdits:{},chosenCase:'new',documentName:'',saved:false};
const INTAKE_FIELDS=[
 ['creditor','Account / creditor name',/^(?:account\s*name|creditor\s*name|company\s*name|creditor|bank\s*name|lender|reported\s*by|furnisher)\b/i],
 ['collector','Collection agency',/^(?:collection\s*(?:agency|company|name)|debt\s*collector|collector\s*name|collection\s*account)\b/i],
 ['originalCreditor','Original creditor',/^(?:original\s*(?:creditor|lender|bank))\b/i],
 ['account','Account number as printed',/^(?:account\s*(?:number|no\.?|#|id|reference)|acct\s*(?:no\.?|number|#)|account\s*#)\b/i],
 ['balance','Current balance',/^(?:current\s*balance|balance|amount\s*owed|total\s*balance|outstanding\s*balance)\b/i],
 ['pastDue','Past due',/^(?:amount\s*past\s*due|past\s*due(?:\s*amount)?|overdue\s*amount)\b/i],
 ['creditLimit','Credit limit',/^(?:credit\s*limit|credit\s*line|high\s*credit|highest\s*balance)\b/i],
 ['status','Account status',/^(?:account\s*status|payment\s*status|current\s*status|status)\b/i],
 ['accountType','Account type',/^(?:account\s*type|type\s*of\s*account|industry\s*type|loan\s*type)\b/i],
 ['opened','Date opened',/^(?:date\s*opened|date\s*account\s*opened|opened\s*on|opened)\b/i],
 ['closed','Date closed',/^(?:date\s*closed|closed\s*on|closed)\b/i],
 ['lastReported','Last reported / updated',/^(?:date\s*(?:last\s*)?reported|last\s*reported|reported\s*on|date\s*updated|last\s*updated|date\s*of\s*last\s*activity)\b/i],
 ['firstDelinquency','First delinquency',/^(?:date\s*of\s*first\s*delinquency|first\s*delinquency|date\s*of\s*first\s*default|first\s*missed\s*payment)\b/i],
 ['lastPayment','Last payment',/^(?:last\s*payment\s*date|date\s*of\s*last\s*payment|last\s*payment)\b/i],
 ['monthlyPayment','Monthly payment',/^(?:monthly\s*payment|scheduled\s*payment|minimum\s*payment)\b/i],
 ['paymentHistory','Payment history',/^(?:payment\s*history|payment\s*rating|payment\s*pattern|history\s*of\s*payments)\b/i],
 ['responsibility','Responsibility',/^(?:responsibility|ownership|account\s*ownership)\b/i],
 ['remarks','Remarks / comments',/^(?:remarks|comment|comments|account\s*comments|special\s*comment)\b/i],
 ['reportDate','Report date',/^(?:report\s*date|date\s*of\s*report|report\s*generated|generated\s*on|prepared\s*on)\b/i],
 ['contact','Creditor contact',/^(?:creditor\s*address|mailing\s*address|contact\s*information|phone\s*number|contact\s*phone)\b/i]
];
const intakeEsc=(x)=>rrEsc(x);
function intakeLineValue(line,pattern,next){
 const m=line.match(pattern);if(!m)return null;
 const rest=line.slice(m[0].length).replace(/^[\s:#：–—-]+/,'').trim();
 if(rest&&rest.length<380)return rest;
 if(next && next.length<380 && !/^(?:account\s*(?:number|name|status)|balance|date|payment\s*history|credit\s*limit|status|original\s*creditor|collection\s*agency|past\s*due)\s*[:#：–—-]/i.test(next))return next;
 return '';
}
function intakeParseFields(text){
 const lines=rrLines(text),values={};
 for(let i=0;i<lines.length;i++)for(const [key,,re] of INTAKE_FIELDS){const v=intakeLineValue(lines[i],re,lines[i+1]);if(v!==null&&v!==''){
  if(!values[key])values[key]=[];
  if(!values[key].includes(v))values[key].push(v);
 }}
 // Keep miscellaneous label/value observations without guessing their meaning.
 const additional=[];
 for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^([A-Za-z][\w\s()/.-]{2,52})\s*[:：]\s*(.{1,280})$/);
  if(!m)continue;
  const label=m[1].trim(),value=m[2].trim();
  if(INTAKE_FIELDS.some(([,,re])=>re.test(label)))continue;
  if(!additional.some(x=>x.label===label&&x.value===value))additional.push({label,value});
 }
 return {values,additional};
}
function intakeBlock(name){
 const txt=reportReader.reportText||'',marker='===== '+name+' =====\n',i=txt.lastIndexOf(marker);
 if(i<0)return '';const from=i+marker.length;let stop=txt.length;
 for(const t of ['\n===== ','\n=== ']){const j=txt.indexOf(t,from);if(j!==-1&&j<stop)stop=j}
 return txt.slice(from,stop).trim();
}
function intakeSources(){
 const s=reportReader,seen=new Map();
 for(const x of s.extracted){if(!x?.name)continue;
  const page=s.ocrPages.find(p=>p.name===x.name),text=page?.text?.trim()||intakeBlock(x.name),bureau=s.bureauBySource?.[x.name]&&s.bureauBySource[x.name]!=='auto'?s.bureauBySource[x.name]:rrBureau(text,x.name,null);
  seen.set(x.name,{name:x.name,text,method:page?.engine||x.method||'Document',bureau,entries:x.entries||[],error:x.warning||'',scanned:!!page});
 }
 for(const p of s.ocrPages){if(seen.has(p.name)){const src=seen.get(p.name);src.text=p.text||src.text;src.scanned=true;continue;}
  const text=p.text||'',bureau=s.bureauBySource?.[p.name]&&s.bureauBySource[p.name]!=='auto'?s.bureauBySource[p.name]:rrBureau(text,p.name,null);
  seen.set(p.name,{name:p.name,text,method:p.engine||'Local OCR',bureau,entries:s.extracted.find(x=>x.name===p.name)?.entries||[],error:'',scanned:true});
 }
 // PDF with image-only pages is represented by its rendered page OCR, not a second empty report.
 return [...seen.values()].filter(s=>s.text.trim()||!([...seen.values()].some(p=>p.name.startsWith(s.name+' · page '))));
}
function intakeDerived(){
 const sources=intakeSources(),byBureau={},allNames=new Set(),allAccounts=new Set();
 for(const src of sources){
  const parsed=intakeParseFields(src.text),b=src.bureau||'Not identified',rows=byBureau[b]??={bureau:b,sourceNames:[],fields:{},other:[],transcripts:[]};
  rows.sourceNames.push(src.name);rows.transcripts.push({name:src.name,text:src.text,method:src.method});
  for(const [key,vals] of Object.entries(parsed.values)){rows.fields[key]??=[];for(const val of vals)if(!rows.fields[key].includes(val))rows.fields[key].push(val)}
  for(const pair of parsed.additional)if(!rows.other.some(x=>x.label===pair.label&&x.value===pair.value))rows.other.push({...pair,source:src.name});
  for(const entry of src.entries||[]){
   if(entry.company&&rrCreditorOK(entry.company)){allNames.add(rrCreditorKey(entry.company));if(!rows.fields.creditor?.length)rows.fields.creditor=[entry.company]}
   if(entry.account)allAccounts.add(rrLast4(entry.account));
   for(const [key,from] of Object.entries({balance:'balance',pastDue:'pastDue',creditLimit:'limit',status:'status',accountType:'accountType',opened:'opened',lastReported:'lastReported',firstDelinquency:'firstMissed',paymentHistory:'paymentHistory',originalCreditor:'originalCreditor'})){
    const val=entry[from];if(val!==undefined&&val!==null&&String(val).trim()&&!rows.fields[key]?.length)rows.fields[key]=[String(val)];
   }
  }
  for(const v of (rows.fields.creditor||[]))if(rrCreditorOK(v))allNames.add(rrCreditorKey(v));
  for(const v of rows.fields.account||[])if(rrLast4(v))allAccounts.add(rrLast4(v));
 }
 // Optional AI can fill blank fields, but each AI-only value is visibly marked for verification.
 const aiMap={company:'creditor',accountLast4:'account',balance:'balance',creditLimit:'creditLimit',pastDue:'pastDue',status:'status',accountType:'accountType',originalCreditor:'originalCreditor',dateOpened:'opened',firstDelinquency:'firstDelinquency',lastReported:'lastReported',paymentHistory:'paymentHistory'};
 for(const a of reportReader.ai.result?.accounts||[]){const bureau=BUREAUS.includes(a.bureau)?a.bureau:'Not identified',row=byBureau[bureau]??={bureau,sourceNames:[],fields:{},other:[],transcripts:[]};row.aiOnly??=[];
  for(const [src,dst] of Object.entries(aiMap)){const val=String(a[src]||'').trim();if(!val||row.fields[dst]?.length)continue;row.fields[dst]=[val];row.aiOnly.push(dst)}
  if(a.company&&rrCreditorOK(a.company))allNames.add(rrCreditorKey(a.company));if(rrLast4(a.accountLast4))allAccounts.add(rrLast4(a.accountLast4));
 }
 const uniqueAccounts=[...allAccounts].filter(Boolean),names=[...allNames].filter(Boolean),potentialMismatch=uniqueAccounts.length>1||names.length>1;
 const creditor=[...Object.values(byBureau)].flatMap(b=>b.fields.creditor||[])[0]||[...Object.values(byBureau)].flatMap(b=>b.fields.collector||[])[0]||'';
 const last4=uniqueAccounts.length===1?uniqueAccounts[0]:'';
 return {sources,byBureau,creditor,last4,potentialMismatch,uniqueAccounts,names,hasText:sources.some(x=>!!x.text.trim())||!!reportReader.ai.result?.accounts?.length};
}
function intakeFieldRows(group){
 const f=group.fields||{},fields=INTAKE_FIELDS.filter(([k])=>f[k]?.length),other=group.other||[];
 return `<div class="intake-fields">${fields.map(([key,label])=>`<div class="intake-field"><span>${intakeEsc(label)}</span><strong>${f[key].map(v=>intakeEsc(v)).join('<span class="intake-alt"> / </span>')}</strong>${(group.aiOnly||[]).includes(key)?'<small>Read by AI · confirm on original page</small>':''}${f[key].length>1?'<small>Different readings — verify the original</small>':''}</div>`).join('')}${other.length?`<details class="intake-raw-extra"><summary>More printed fields (${other.length})</summary>${other.map(v=>`<div class="intake-field"><span>${intakeEsc(v.label)}</span><strong>${intakeEsc(v.value)}</strong></div>`).join('')}</details>`:''}</div>`;
}
function intakePage(){
 const d=intakeDerived(),s=reportReader,a=s.ai,busy=Intake.busy||s.busy||a.busy,n=d.sources.length,read=d.sources.filter(p=>p.text.trim()).length;
 return `<section class="page-head"><div><span class="eyebrow">CREDIT REPORT INTAKE · V14</span><h1>Read my credit report</h1><p>Upload the pages. Capture exactly what is printed. Save one clean document.</p></div></section>
 <section class="card intake-upload"><div class="eyebrow">STEP 1 · UPLOAD</div><h2>Credit report screenshots or PDF</h2><p class="small muted">Put pages from the same account together, even if they are from different bureaus. We keep each bureau's printed information separate.</p>
 <input type="file" id="reportUpload" multiple hidden accept=".pdf,application/pdf,image/*,.txt,text/plain"><button class="btn mint intake-main" data-action="reader-pick" ${busy?'disabled':''}>＋ Choose screenshots or PDF</button>
 <div class="row-between intake-subrow"><span class="small muted">${n} page${n===1?'':'s'} added · ${read} with extracted text</span><button class="btn ghost sm" data-action="reader-clear" ${busy?'disabled':''}>Clear scan</button></div>
 <details class="intake-paste"><summary>Or paste text copied from iPhone Live Text</summary><textarea id="intakePaste" rows="5" placeholder="Paste text from your credit report">${intakeEsc(Intake.pasted)}</textarea><button class="btn secondary" data-action="reader-intake-paste">Add report text</button></details>
 ${Intake.busy?`<div class="callout mint" role="status">${intakeEsc(Intake.status||'Reading report pages…')}</div>`:Intake.status?`<p class="small muted" role="status">${intakeEsc(Intake.status)}</p>`:''}${Intake.lastError?`<p class="small" style="color:#ffb4a8" role="alert">${intakeEsc(Intake.lastError)}</p>`:''}
 </section>
 ${d.sources.length?`<section class="card"><div class="eyebrow">STEP 2 · EXTRACTED DOCUMENT</div><div class="row-between"><h2>What the report says</h2><span class="pill">${read}/${n} read</span></div>
 ${d.potentialMismatch?`<div class="callout warning"><strong>Check the account identity.</strong> These pages contain ${d.uniqueAccounts.length>1?'different account-number endings':'different creditor readings'}. Nothing has been assumed or merged into a case. You can correct the OCR below.</div>`:''}
 ${d.hasText?`<div class="intake-document-head"><strong>${intakeEsc(d.creditor||'Creditor not yet identified')}</strong><span>${d.last4?'Account ending '+intakeEsc(d.last4):'Account reference unconfirmed'}</span></div>
 ${Object.values(d.byBureau).map(g=>`<section class="intake-bureau"><div class="row-between"><h3>${intakeEsc(g.bureau)}</h3><small>${g.sourceNames.length} page(s)</small></div>${intakeFieldRows(g)||''}</section>`).join('')}
 <p class="small muted">Only detected text is shown. Missing fields are not invented. Review against the original image before relying on a value.</p>`:'<div class="callout warning">No readable text was extracted yet. Try the free scan again or paste text from iPhone Photos → Live Text.</div>'}
 <h3>Every uploaded page</h3>${d.sources.map((src,i)=>`<details class="intake-source"><summary><strong>${intakeEsc(src.name)}</strong><span class="small muted">${intakeEsc(src.bureau)} · ${src.text.trim()?src.text.length+' characters':'unreadable'}</span></summary>
 <div class="field"><label>Bureau shown on this page</label><select data-intake-bureau="${intakeEsc(src.name)}"><option value="Not identified" ${src.bureau==='Not identified'?'selected':''}>Not identified</option>${BUREAUS.map(b=>`<option value="${b}" ${src.bureau===b?'selected':''}>${b}</option>`).join('')}</select></div>
 <label class="small muted" for="intake-text-${i}">Full extracted text — edit corrections here</label><textarea id="intake-text-${i}" data-intake-text="${intakeEsc(src.name)}" rows="10" spellcheck="false">${intakeEsc(src.text)}</textarea><div class="row-wrap"><button class="btn secondary sm" data-action="reader-intake-apply" data-value="${intakeEsc(src.name)}">Update fields</button>${s.ai.images.some(x=>x.name===src.name)?`<button class="btn ghost sm" data-action="reader-show-source" data-value="${intakeEsc(src.name)}">View screenshot</button>`:''}</div>
 </details>`).join('')}
 </section>
 <section class="card"><div class="eyebrow">STEP 3 · SAVE</div><h2>Save the extracted report</h2><p class="small muted">Save a clean local document containing the fields and page-by-page transcription. Your report is not submitted to any credit bureau.</p>
 <button class="btn mint intake-main" data-action="reader-intake-export">⇩ Save report document</button>
 <div class="row-wrap" style="margin-top:10px"><button class="btn secondary" data-action="reader-intake-copy">Copy all extracted text</button><button class="btn secondary" data-action="reader-intake-print">Print / Save as PDF</button></div>
 <details style="margin-top:16px"><summary>Also save account fields to an existing case</summary><p class="small muted">Optional. This does not create a dispute or assert that anything is inaccurate.</p><div class="field"><label>Destination</label><select id="intakeCase"><option value="new">Create a new client case</option>${activeClient()?`<option value="current">${intakeEsc(clientLabel(activeClient()))} — existing case</option>`:''}</select></div><label class="toggle-line"><input type="checkbox" id="intakeCaseConfirm"><span>I checked the account identity and visible details before saving them to a case.</span></label><button class="btn secondary" data-action="reader-intake-case">Save account to case</button></details>
 </section>`:''}
 <details class="card intake-ai"><summary><strong>Optional: enhance field reading with connected AI</strong></summary><p class="small muted">Free OCR runs on this iPhone. AI is optional and sends your selected report to your private backend only with explicit approval. Your existing server connection is unchanged. API credits may be required.</p>
 <div class="field"><label>Private AI access code</label><input id="readerAiCode" type="password" value="${intakeEsc(a.accessCode||'')}" autocomplete="off"></div><label class="toggle-line"><input id="readerAiConsent" type="checkbox" ${a.consent?'checked':''}><span>I approve sending this report to my AI service</span></label><div class="row-wrap"><button class="btn secondary" data-action="reader-intake-ai" ${busy?'disabled':''}>Read with AI</button><button class="btn ghost sm" data-action="reader-ai-test-connection">Check connection</button></div>
 ${a.error?`<p class="small" style="color:#ffb4a8">${intakeEsc(a.error)}</p>`:''}${a.status?`<p class="small muted">${intakeEsc(a.status)}</p>`:''}
 ${a.result?.accounts?.length?`<details><summary>AI extracted fields (${a.result.accounts.length}) — verify</summary>${a.result.accounts.map(x=>`<div class="intake-bureau"><strong>${intakeEsc(x.company)} · ${intakeEsc(x.bureau)}</strong><p class="small">Account ending ${intakeEsc(x.accountLast4)} · balance ${intakeEsc(x.balance)} · status ${intakeEsc(x.status)} · opened ${intakeEsc(x.dateOpened)}</p></div>`).join('')}</details>`:''}</details>
 <details class="card"><summary>Learning notes &amp; advanced dispute tools</summary>${FK.panel()}</details>`;
}
function intakeDocument(){
 const d=intakeDerived(),sections=[];
 sections.push('CREDIT REPORT INTAKE — EXTRACTED TRANSCRIPT','Generated: '+new Date().toLocaleString(),'Pages: '+d.sources.length,'Account: '+(d.creditor||'Not confirmed'),'Account reference: '+(d.last4?'ending '+d.last4:'Not confirmed'),'');
 if(d.potentialMismatch)sections.push('REVIEW REQUIRED: More than one creditor reference or account-number ending appears.','');
 for(const [bureau,group] of Object.entries(d.byBureau)){
  sections.push('=== '+bureau+' ===');
  for(const [key,label] of INTAKE_FIELDS)if(group.fields[key]?.length)sections.push(label+': '+group.fields[key].join(' | ')+((group.aiOnly||[]).includes(key)?' [AI reading: unverified]':''));
  for(const other of group.other)sections.push(other.label+': '+other.value);
  sections.push('');
 }
 sections.push('=== COMPLETE SOURCE TRANSCRIPT ===');
 for(const src of d.sources)sections.push('\n----- '+src.name+' ('+src.bureau+') -----\n'+(src.text||'[No readable text]'));
 sections.push('\nIMPORTANT: Automated transcription is unverified. Missing or incorrect OCR text must be checked against the original screenshots or PDF. No allegation of a credit reporting error is implied.');
 return sections.join('\n');
}
function intakeSaveFile(content,type,ext){
 const name='credit-report-intake-'+new Date().toISOString().slice(0,10)+'.'+ext;
 const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Report document prepared. Save it to Files on your iPhone.');
}
function intakeWriteHtml(){
 const text=intakeDocument();return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Credit Report Intake</title><style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,Arial,sans-serif;max-width:800px;margin:32px auto;padding:16px;color:#142136}h1{font-size:22px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6fb;padding:20px;border:1px solid #dce4ee;border-radius:10px}@media print{body{margin:0}pre{background:white;border:0}}</style></head><body><h1>Credit Report Intake</h1><p>Extracted fields and source transcript. Verify against the original document.</p><pre>'+intakeEsc(text)+'</pre></body></html>';
}
async function intakeUpload(files){
 if(Intake.busy||reportReader.busy)return;
 const fs=[...files||[]];if(!fs.length)return;
 Intake.busy=true;Intake.lastError='';Intake.status='Loading '+fs.length+' page(s)…';render();
 try{
  await rrProcess(fs);
  Intake.status='Reading screenshot text on this device…';render();
  if(reportReader.ai.images.length){reportReader.aiCovered=[];await rrOCRRetry(false)}
  Intake.ready=true;
  const src=intakeDerived().sources,found=src.filter(x=>x.text.trim()).length;
  Intake.status=`Read ${found} of ${src.length} page(s). Open a page to review or correct its transcription.`;
  if(found<src.length)Intake.lastError='Some pages were not readable. Open the page and use iPhone Photos → Live Text to copy the missing text.';
 }catch(e){Intake.lastError=String(e.message||e);Intake.status='Report intake needs correction';}
 finally{Intake.busy=false;render()}
}
function intakeApplyText(name){
 const el=[...document.querySelectorAll('[data-intake-text]')].find(x=>x.dataset.intakeText===name);if(!el)return;
 const text=el.value;
 const page=reportReader.ocrPages.find(x=>x.name===name);
 if(page){page.text=text;rrOCRApplyNoRender(page)}
 else {
  const rec=reportReader.extracted.find(x=>x.name===name);if(rec){const bureau=reportReader.bureauBySource?.[name]||rec.bureau;
   const parsed=rrParseAccounts(text,name,bureau);rec.entries=parsed.entries;rec.bureau=parsed.bureau;rec.method='Corrected document text';
   const marker='===== '+name+' =====\n',str=reportReader.reportText,i=str.lastIndexOf(marker);
   if(i>=0){const start=i+marker.length;let stop=str.length;for(const m of ['\n===== ','\n=== ']){const j=str.indexOf(m,start);if(j>=0)stop=Math.min(stop,j)}reportReader.reportText=str.slice(0,start)+text+'\n'+str.slice(stop)}
   else reportReader.reportText+='\n'+marker+text+'\n';rrReconcile();}
 }
 Intake.status='Updated fields from corrected transcript: '+name;render();
}
function intakeSaveCase(){
 const d=intakeDerived();if(!d.hasText){toast('Read a report first');return}
 if(!document.getElementById('intakeCaseConfirm')?.checked){toast('Confirm that you checked the source details first');return}
 if(d.potentialMismatch){toast('Multiple account references detected. Correct the source text before saving as one case.');return}
 const dest=document.getElementById('intakeCase')?.value||'new';let c=dest==='current'?activeClient():null;
 if(!c){c=newClient('');state.clients.push(c);state.activeId=c.id}
 if(reportReader.profile.name&&!c.name)c.name=reportReader.profile.name;
 const item=newItem(),by=Object.entries(d.byBureau).filter(([b])=>BUREAUS.includes(b));
 const collector=by.map(([,g])=>g.fields.collector?.[0]).find(Boolean)||'';
 item.collector=collector||d.creditor||'';item.account=d.last4||'';item.originalCreditor=by.map(([,g])=>g.fields.originalCreditor?.[0]).find(Boolean)||(collector&&d.creditor!==collector?d.creditor:'');
 item.bureaus=by.map(([b])=>b);item.bureauReports={};
 for(const [b,g] of by){const f=g.fields;item.bureauReports[b]={bureau:b,company:f.creditor?.[0]||d.creditor||'',account:item.account,balance:rrNum(f.balance?.[0]||''),creditLimit:rrNum(f.creditLimit?.[0]||''),pastDue:rrNum(f.pastDue?.[0]||''),status:f.status?.[0]||'',accountType:f.accountType?.[0]||'',opened:rrDate(f.opened?.[0]||''),firstDelinquency:rrDate(f.firstDelinquency?.[0]||''),lastReported:rrDate(f.lastReported?.[0]||''),paymentHistory:f.paymentHistory?.[0]||'',sourcePages:g.sourceNames};}
 const first=by[0]?.[1]?.fields||Object.values(d.byBureau)[0]?.fields||{};
 item.balance=rrNum(first.balance?.[0]||'');item.status=first.status?.[0]||'';item.reportDate=rrDate(first.reportDate?.[0]||'');item.firstMissed=rrDate(first.firstDelinquency?.[0]||'');
 item.notes='Credit report intake only. Source files: '+d.sources.map(x=>x.name).join(', ')+'. OCR and field extraction must be checked against originals. No dispute error asserted.';
 const existing=c.items?.find(i=>i.account&&i.account===item.account&&rrSameCreditor(i.collector||i.originalCreditor,item.collector))||null;
 if(existing){Object.assign(existing,{...item,id:existing.id,notes:(existing.notes||'')+'\n'+item.notes});c.activeItemId=existing.id;}
 else {const blank=c.items?.find(i=>!i.collector&&!i.account&&!i.balance&&!i.notes);if(blank){Object.assign(blank,{...item,id:blank.id});c.activeItemId=blank.id;}else{c.items.push(item);c.activeItemId=item.id;}}
 persist();toast('Extracted account fields saved to case. No dispute was created.');state.tab='cases';render();
}
const intakeOldClick=readerClick,intakeOldChange=readerChange,intakeOldInput=readerInput;
readerPage=intakePage;
readerClick=async function(action,val,el){
 if(action==='reader-pick'){document.getElementById('reportUpload')?.click();return}
 if(action==='reader-intake-paste'){
  const text=document.getElementById('intakePaste')?.value?.trim()||Intake.pasted.trim();if(!text){toast('Paste text first');return}
  const n=reportReader.extracted.length+1,name='Pasted report '+n,p=rrParseAccounts(text,name,'Not identified');reportReader.extracted.push({name,bureau:p.bureau,entries:p.entries,method:'Pasted report text'});reportReader.reportText+='\n===== '+name+' =====\n'+text+'\n';rrReconcile();Intake.pasted='';Intake.status='Pasted report text added to the intake document';render();return;
 }
 if(action==='reader-intake-apply'){intakeApplyText(val);return}
 if(action==='reader-intake-export'){if(!intakeDerived().hasText){toast('Read a report first');return}intakeSaveFile(intakeWriteHtml(),'text/html;charset=utf-8','html');return}
 if(action==='reader-intake-print'){if(!intakeDerived().hasText){toast('Read a report first');return}const area=document.getElementById('printArea');if(area){area.innerHTML=intakeWriteHtml();const w=window.open('','_blank');if(w){w.document.write(intakeWriteHtml());w.document.close();w.focus();w.print()}else intakeSaveFile(intakeWriteHtml(),'text/html','html')}return}
 if(action==='reader-intake-copy'){if(!intakeDerived().hasText){toast('Read a report first');return}return copyText(intakeDocument())}
 if(action==='reader-intake-case'){intakeSaveCase();return}
 if(action==='reader-intake-ai'){if(!reportReader.ai.consent){toast('Approve sending the report before using AI');return}
  if(!reportReader.ai.accessCode.trim()){toast('Enter your private access code first');return}
  reportReader.ai.includeImages=true;reportReader.ai.payload=rrAiRedact(reportReader.reportText.trim().slice(0,40000))||'[Read the uploaded pages and extract only their visible data.]';await rrAiRun('analyze');Intake.status='Optional AI field-reading finished; verify extracted results against the source transcript.';render();return}
 if(action==='reader-clear'){if(!confirm('Clear this intake session? Download the document first if you need it.'))return;await intakeOldClick(action,val,el);Intake.ready=false;Intake.status='';Intake.lastError='';return}
 return intakeOldClick(action,val,el);
};
readerInput=function(el){if(el.id==='intakePaste'){Intake.pasted=el.value;return true}return intakeOldInput(el)};
readerChange=function(el){if(el.id==='reportUpload'){const files=[...el.files||[]];el.value='';void intakeUpload(files);return true}
 if(el.dataset.intakeBureau!==undefined){const name=el.dataset.intakeBureau,value=el.value;
  reportReader.bureauBySource[name]=value;
  const p=reportReader.ocrPages.find(x=>x.name===name);if(p)rrOCRApplyNoRender(p);else {const x=reportReader.extracted.find(x=>x.name===name);if(x){x.bureau=value;x.entries.forEach(e=>e.bureau=value);rrReconcile()}}
  Intake.status='Bureau label corrected for '+name;render();return true}
 return intakeOldChange(el)
};
