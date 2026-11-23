/* Dispute Studio Report Reader v11: on-device, rules-based text extraction and review.
   Local extraction plus optional consent-based AI API. PDF.js is bundled; standard OCR loads on demand with a bundled offline fallback. */
'use strict';
const REPORT_PDF_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const REPORT_PDF_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const REPORT_OCR_URL='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
// No-payment OCR runs on the device. Paid AI vision remains optional and unchanged.
const reportReader={files:[],extracted:[],accounts:[],profile:{},reportText:'',paste:'',status:'',busy:false,cancel:false,selected:new Set(),review:{},showText:false,speaking:false,speechQueue:[],voiceRate:0.92,ocrWorker:null,ocrSources:[],ocrPages:[],ocrCompleted:new Set(),ocrMode:"",manual:{company:"",account:"",balance:"",status:"",bureau:"Not identified"},importResult:'',error:'',ai:{endpoint:'https://dispute-studio-ai-backend.vercel.app/api/analyze-report',accessCode:'',consent:false,includeImages:true,images:[],payload:'',busy:false,result:null,error:'',question:'',answer:'',status:'',mode:'',lastRequestAt:0,connectionStatus:'',scanAfterUpload:false,lastSource:'none',lastHTTPStatus:0}};
const rrEsc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const rrShort=(x,n=140)=>String(x||'').trim().slice(0,n);
const rrSanitize=x=>String(x||'').replace(/\b\d{3}[-. ]?\d{2}[-. ]?\d{4}\b/g,'[SSN hidden]').replace(/\b(?:\d[ -]?){13,19}\b/g,'[long number hidden]');
const rrNum=s=>{if(!s)return '';const m=String(s).match(/-?\$?\s*([\d,]+(?:\.\d{1,2})?)/);return m?m[1].replace(/,/g,''):''};
const rrMoney=s=>s!==''&&Number.isFinite(Number(s))?'$'+Number(s).toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:0}):'Not shown';
const rrLast4=s=>{const v=String(s||'').trim();const digits=v.replace(/\D/g,'');return digits.length>=4?digits.slice(-4):''};
const rrDate=s=>{if(!s)return '';const v=String(s).trim(),m=v.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);if(m){const month=+m[1],day=+m[2];if(month>=1&&month<=12&&day>=1&&day<=31)return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}const iso=v.match(/\b(20\d\d|19\d\d)-(\d\d)-(\d\d)\b/);if(iso)return iso[0];const textual=v.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i);if(textual){const d=new Date(textual[0]);if(!isNaN(d))return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}return ''};
function rrLines(text){return String(text||'').replace(/\r/g,'\n').replace(/\u00a0/g,' ').replace(/[\u2028\u2029]/g,'\n').replace(/\t/g,'  ').split(/\n/).map(x=>x.trim()).filter(Boolean)}
function rrField(lines,keys){const re=new RegExp('^(?:'+keys.join('|')+')(?:\\s*[:#：–-]\\s*|\\s+)(.*)$','i');for(let i=0;i<lines.length;i++){const m=lines[i].match(re);if(!m)continue;let v=m[1]?.trim()||'';if(!v&&i+1<lines.length&&!/^(?:Account\s*(?:Number|Name|Status)|Balance|Credit\s*Limit|Date|Status|Payment\s*Status|Report\s*Date)\b/i.test(lines[i+1]))v=lines[i+1].trim();if(v&&v.length<240)return v;}return ''}
function rrCompany(v){return rrShort(v.replace(/^(?:reported by|account name|creditor|company name)\s*:?\s*/i,'').replace(/\s*\|.*$/,''),80)}
function rrBureau(text,filename,override){if(override&&override!=='auto')return override;const x=(filename+' '+text.slice(0,1600)).toLowerCase();return /transunion/.test(x)?'TransUnion':/equifax/.test(x)?'Equifax':/experian/.test(x)?'Experian':'Not identified'}
function rrProfile(lines){const name=rrField(lines,['Consumer\\s*Name','Full\\s*Name','Report\\s*For','Prepared\\s*For','Personal\\s*Name']);const a=rrField(lines,['Current\\s*(?:Mailing\\s*)?Address','Mailing\\s*Address','Residential\\s*Address']);const p={};if(name&&/^[A-Za-z][A-Za-z\-' ]{3,75}$/.test(name)&&name.trim().split(/\s+/).length>=2)p.name=name.trim();if(a&&a.length<130)p.address=a.trim();const c=rrField(lines,['City']),st=rrField(lines,['State']),zip=rrField(lines,['ZIP(?:\\s*Code)?']);if(c&&c.length<65)p.city=c;if(st&&/^[A-Za-z]{2,20}$/.test(st))p.state=st;if(zip&&/^\d{5}/.test(zip))p.zip=zip.slice(0,5);const full=(a||'').match(/^(.+?\b(?:Street|St\.?|Ave\.?|Avenue|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?)\b(?:\s+(?:Apt|Apartment|Unit|Ste|Suite)\s*#?\w+)?)\s*,?\s+([A-Za-z][A-Za-z\s.'-]+?)\s*,?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);if(full){p.address=full[1].trim();p.city=full[2].trim();p.state=full[3];p.zip=full[4].slice(0,5)}return p}
function rrAccountAnchors(lines){const anchors=[];const head=/^(?:Account\s*Name|Creditor\s*Name|Company\s*Name|Collection\s*Agency|Collection\s*Company|Reported\s*By|Furnisher|Creditor)(?:\s*[:#：–-]\s*|\s+)(.+)$/i;const accountNameOnly=/^(?:Account\s*Name|Creditor\s*Name|Company\s*Name|Collection\s*Agency|Collection\s*Company|Reported\s*By|Furnisher|Creditor)$/i;for(let i=0;i<lines.length;i++){let name='';const m=lines[i].match(head);if(m)name=m[1]?.trim()||'';else if(accountNameOnly.test(lines[i])&&i+1<lines.length)name=lines[i+1];if(name&&!/^(?:Account|Balance|Payment|Date|Credit|Report|Status|Not available|None|N\/A)$/i.test(name)&&name.length>2&&name.length<90)anchors.push({index:i,name:rrCompany(name)});}if(!anchors.length){for(let i=0;i<lines.length;i++){const hasAccount=/^Account\s*(?:Number|#|No\.|ID)\s*[:#]?/i.test(lines[i]);if(!hasAccount)continue;const before=lines.slice(Math.max(0,i-7),i).reverse().find(s=>/^[A-Za-z][A-Za-z0-9 .,&'/-]{3,70}$/.test(s)&&!/^(?:Account|Balance|Credit|Report|Payment|Date|Status|Original|Address|Consumer)/i.test(s));if(before)anchors.push({index:Math.max(0,i-4),name:rrCompany(before)})}}
 if(!anchors.length){for(let i=0;i<lines.length;i++){const line=lines[i];if(!/^[A-Z][A-Z0-9 &.,'-]{3,58}$/.test(line)||/^(?:EXPERIAN|TRANSUNION|EQUIFAX|CREDIT REPORT|PAYMENT HISTORY|PERSONAL INFORMATION|ACCOUNT INFORMATION|ACCOUNT SUMMARY|CONTACT INFORMATION|BALANCE|CURRENT BALANCE|ACCOUNT STATUS|CREDIT LIMIT|STATUS)$/i.test(line))continue;const block=lines.slice(i+1,i+13).join(' ');if(/\b(?:Balance|Account Status|Payment Status|Credit Limit|Account Number|Past Due)\b/i.test(block)&&(/\b(?:Balance|Account Status|Account Number)\b/i.test(block)))anchors.push({index:i,name:rrCompany(line)})}}return anchors.filter((x,i)=>i===0||x.index!==anchors[i-1].index)}
function rrParseAccounts(text,sourceName,forcedBureau){const lines=rrLines(text);const bureau=rrBureau(text,sourceName,forcedBureau);const anchors=rrAccountAnchors(lines);const reportDate=rrDate(rrField(lines.slice(0,110),['Report\\s*Date','Date\\s*of\\s*Report','Report\\s*Generated','Generated\\s*On','Prepared\\s*On']));const entries=[];for(let n=0;n<anchors.length;n++){const a=anchors[n],end=anchors[n+1]?.index??lines.length;const seg=lines.slice(a.index,Math.min(end,a.index+70));const account=rrLast4(rrField(seg,['Account\\s*(?:Number|No\\.?|#|ID|Reference)','Acct\\s*(?:No\\.?|Number|#)']));const balance=rrNum(rrField(seg,['(?:Current\\s*)?Balance','Amount\\s*Owed','Total\\s*Balance','Outstanding\\s*Balance']));const limit=rrNum(rrField(seg,['Credit\\s*Limit','Credit\\s*Line','Limit']));const originalCreditor=rrField(seg,['Original\\s*Creditor','Original\\s*Lender']);const status=rrField(seg,['Account\\s*Status','Payment\\s*Status','Status','Current\\s*Status']);const accountType=rrField(seg,['Account\\s*Type','Type\\s*of\\s*Account','Industry\\s*Type']);const pastDue=rrNum(rrField(seg,['Past\\s*Due(?:\\s*Amount)?','Amount\\s*Past\\s*Due']));const opened=rrDate(rrField(seg,['Date\\s*Opened','Opened','Date\\s*Account\\s*Opened']));const firstMissed=rrDate(rrField(seg,['Date\\s*of\\s*First\\s*Delinquency','First\\s*Delinquency','Date\\s*of\\s*First\\s*Default','First\\s*Missed\\s*Payment']));const lastReported=rrDate(rrField(seg,['Date\\s*(?:Last\\s*)?Reported','Last\\s*Reported','Reported\\s*On','Date\\s*Updated','Last\\s*Updated']));const paymentHistory=rrField(seg,['Payment\\s*History','Payment\\s*Rating']);const complete=[a.name,status,accountType,paymentHistory,seg.slice(0,16).join(' ')].join(' ').toLowerCase();let type='Other';if(/collection|debt buyer|recovery/.test(complete))type='Collection';else if(/charge.?off|charged.?off/.test(complete))type='Charge-off';else if(/repossess/.test(complete))type='Repossession';else if(/late|delinquen|30 days|60 days|90 days/.test(complete))type='Late payments';const score=[!!a.name,!!account,!!status,!!balance,!!limit].filter(Boolean).length;if(score<2)continue;const id='r'+entries.length+'-'+Math.random().toString(36).slice(2,7);entries.push({id,company:a.name,originalCreditor,account,balance,limit,status,accountType,pastDue,opened,firstMissed,lastReported,reportDate,paymentHistory,type,bureau,source:sourceName,confidence:score>=4?'Good':score>=2?'Partial':'Low',raw:seg.slice(0,32).join('\n')});}return rrMergeDeskResult({bureau,reportDate,profile:rrProfile(lines.slice(0,140)),entries,lines:lines.length,hasText:text.trim().length>0},text,sourceName);}
// Additional field reader contributed by the user's offline Dispute Desk 2 source.
// Keep bureau-specific facts separate. Never invent status/amounts or claim an error was proven.
function rrMergeDeskResult(parsed,text,sourceName){
 if(!window.DD2Read||!window.DD||!text.trim())return parsed;
 let out;try{out=window.DD2Read.read(text,window.DD,{now:new Date()})}catch(_){return parsed}
 for(const item of out.entries||[]){
  const r=item.r||{};
  const four=rrLast4(r.accountRef||''),company=rrShort(r.furnisher||'',85);
  if(!company||!(/[A-Za-z]{3}/.test(company)))continue;
  const bureau=Array.isArray(r.bureaus)&&r.bureaus.length===1?BUREAUS.find(b=>b.toLowerCase()===r.bureaus[0].toLowerCase())||parsed.bureau:parsed.bureau;
  const data={company,account:four,balance:r.reportedBalance!=null?String(r.reportedBalance):'',status:rrShort(r.statusText||'',125),originalCreditor:rrShort(r.originalCreditor||'',100),opened:r.openedDate||'',firstMissed:r.dofd||'',lastReported:r.reportedDate||'',reportDate:r.reportDate||'',type:({chargeoff:'Charge-off',collection:'Collection',repo:'Repossession',late:'Late payments',medical:'Medical collection',inquiry:'Inquiry'})[r.itemType]||'Other',bureau};
  const concrete=!!(four||data.balance!==''||data.status||data.opened||data.firstMissed||data.lastReported);
  if(!concrete)continue;
  const ckey=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let same=parsed.entries.find(a=>a.bureau===bureau&&((four&&a.account===four)||(ckey(a.company)===ckey(company)&&(!a.account||!four||a.account===four))));
  if(same){
   for(const k of ['account','balance','status','opened','firstMissed','lastReported','reportDate','originalCreditor'])if((same[k]===''||same[k]==null)&&data[k])same[k]=data[k];
   if(same.type==='Other'&&data.type!=='Other')same.type=data.type;
   if(same.confidence==='Low'&&concrete)same.confidence='Partial';
  }else{
   const id='dd2-'+Math.random().toString(36).slice(2,11);
   parsed.entries.push({id,...data,limit:'',accountType:'',paymentHistory:'',pastDue:'',source:sourceName,confidence:'Partial',raw:(item.r?.readBack||item.sub||'').slice(0,700)});
  }
 }
 return parsed;
}

// Version 12: one logical credit account across screenshots and reporting bureaus.
// Every observation retains its source page and bureau; incomplete OCR fragments
// never become independent accounts solely because a parser guessed a heading.
function rrCreditorKey(v){return String(v||'').toLowerCase().replace(/\bcap\s+one\b/g,'capital one').replace(/\b(?:national association|na|incorporated|inc|llc|corporation|corp|services|service|financial|bank|banking)\b/g,'').replace(/[^a-z0-9]/g,'').trim()}
function rrCreditorOK(v){const n=String(v||'').trim();return /[a-z]{3}/i.test(n)&&n.length<=95&&!/^(?:account(?:\s+(?:information|number|name|type|status|details|summary))?|credit\s+(?:report|limit|score)|balance|current\s+balance|payment\s+(?:history|status|information)|personal\s+information|date\s+(?:opened|updated|reported)|opened|last\s+reported|report\s+date|original\s+creditor|amount\s+owed|past\s+due|dispute|status|accounts?|not\s+available|unknown|n\/?a|transunion|experian|equifax|monthly\s+payments?|collection\s+account|contact\s+information)$/i.test(n)&&!/^\d+[\s\d$.,-]*$/.test(n)}
function rrSameCreditor(a,b){const x=rrCreditorKey(a),y=rrCreditorKey(b);if(!x||!y)return false;if(x===y)return true;if(Math.min(x.length,y.length)>=5&&(x.includes(y)||y.includes(x)))return true;return false}
function rrAccountFields(a){return ['balance','limit','status','opened','firstMissed','lastReported','accountType','pastDue','paymentHistory'].filter(k=>a[k]!==''&&a[k]!=null&&String(a[k]).trim()!=='').length}
function rrAcceptObservation(a){if(!a||!rrCreditorOK(a.company))return false;const four=rrLast4(a.account);if(four)return true;return rrAccountFields(a)>=3&&/\b(?:account name|creditor name|company name|reported by|account number)\b/i.test(a.raw||'')}
function rrReconcile(){
 const r=reportReader,previous=r.accounts||[],priorSelected=r.selected||new Set(),priorReview=r.review||{};
 const sources=[];for(const source of r.extracted||[])for(const e of source.entries||[])sources.push({...e,source:e.source||source.name});
 for(const e of r.manualEntries||[])sources.push(e);
 for(const e of r.aiEntries||[])sources.push(e);
 const accepted=[],weak=[];
 for(const e of sources){if(!rrAcceptObservation(e)){weak.push(e);continue}accepted.push({...e,account:rrLast4(e.account)});}
 // The entries with a readable account reference are the grouping anchors.
 accepted.sort((a,b)=>Number(!!b.account)-Number(!!a.account));
 const groups=[];const deferred=[];
 for(const a of accepted){
  let g;
  if(a.account){
   g=groups.find(z=>z.account===a.account&&rrSameCreditor(z.company,a.company));
  }else{
   const matches=groups.filter(z=>rrSameCreditor(z.company,a.company));
   if(matches.length===1)g=matches[0];else if(matches.length>1){deferred.push(a);continue}
  }
  if(!g){g={company:a.company,account:a.account,observations:[]};groups.push(g)}
  // Preserve distinct screenshots even if both recognition engines found this entry.
  if(!g.observations.some(x=>x.source===a.source&&x.bureau===a.bureau&&x.account===a.account&&x.balance===a.balance&&x.status===a.status))g.observations.push(a);
 }
 const used=new Set();let num=0;
 const next=groups.map(g=>{
  const prior=previous.find(x=>!used.has(x.id)&&x.account===g.account&&rrSameCreditor(x.company,g.company));
  if(prior)used.add(prior.id);
  const id=prior?.id||('acct-'+(rrCreditorKey(g.company)||'unknown').slice(0,24)+'-'+(g.account||'unverified')+'-'+(++num));
  const main=g.observations.slice().sort((a,b)=>Number(!!b.account)-Number(!!a.account)||rrAccountFields(b)-rrAccountFields(a))[0];
  const all=new Set(),bureaus={},conflicts=[];
  const identity={id,company:main.company,account:g.account||'',balance:'',status:'',limit:'',originalCreditor:'',accountType:'',pastDue:'',opened:'',firstMissed:'',lastReported:'',reportDate:'',paymentHistory:'',type:main.type||'Other',confidence:main.confidence||'Partial',source:main.source,raw:main.raw||'',bureau:'Not identified',observations:g.observations,bureauReports:bureaus,conflicts,sourcePages:[]};
  for(const a of g.observations){
   const bureau=BUREAUS.includes(a.bureau)?a.bureau:'Not identified';
   const source=a.source||a.ocrPage||'Unknown screenshot';
   if(source)all.add(source);for(const sp of a.sourcePages||[])if(sp)all.add(sp);
   const b=bureaus[bureau]||{bureau,company:a.company,account:g.account||'',balance:'',status:'',limit:'',creditLimit:'',pastDue:'',accountType:'',opened:'',firstMissed:'',firstDelinquency:'',lastReported:'',reportDate:'',paymentHistory:'',sourcePages:[],conflicts:[]};
   if(!b.sourcePages.includes(source))b.sourcePages.push(source);
   for(const k of ['balance','status','limit','pastDue','accountType','opened','firstMissed','lastReported','reportDate','paymentHistory']){
    const v=a[k];if(v==null||v==='')continue;
    if(b[k]!==''&&b[k]!==v){const detail={bureau,field:k,values:[b[k],v],sources:[...b.sourcePages]};if(!conflicts.some(c=>c.bureau===bureau&&c.field===k&&c.values.includes(v))){conflicts.push(detail);b.conflicts.push(detail)}}
    if(b[k]==='')b[k]=v;
   }
   b.creditLimit=b.limit;b.firstDelinquency=b.firstMissed;
   if(!bureaus[bureau])bureaus[bureau]=b;
   if(identity.type==='Other'&&a.type&&a.type!=='Other')identity.type=a.type;
   if(!identity.originalCreditor&&a.originalCreditor)identity.originalCreditor=a.originalCreditor;
  }
  const primary=Object.values(bureaus).sort((a,b)=>Number(b.bureau!=='Not identified')-Number(a.bureau!=='Not identified'))[0];
  for(const k of ['balance','status','limit','pastDue','accountType','opened','firstMissed','lastReported','reportDate','paymentHistory'])identity[k]=primary?.[k]||'';
  identity.bureau=Object.keys(bureaus).filter(b=>b!=='Not identified').length===1?Object.keys(bureaus).filter(b=>b!=='Not identified')[0]:'Multiple bureaus';
  if(Object.keys(bureaus).length===1&&bureaus['Not identified'])identity.bureau='Not identified';
  identity.sourcePages=[...all];
  if(prior?.corrected){for(const k of ['company','account','balance','limit','status','originalCreditor','firstMissed','lastReported','type'])identity[k]=prior[k];identity.corrected=true;}
  if(prior?.aiReview)identity.aiReview=prior.aiReview;
  return identity;
 });
 r.accounts=next;r.uncertainCount=weak.length+deferred.length;
 r.selected=new Set(next.filter(a=>!previous.some(p=>p.id===a.id)||priorSelected.has(a.id)).map(a=>a.id));
 r.review={};for(const a of next)r.review[a.id]=priorReview[a.id]||{issue:'',note:'',verified:false,issueBureaus:{}};
 return next;
}
function rrBureauCount(){return reportReader.accounts.reduce((n,a)=>n+Object.keys(a.bureauReports||{}).filter(b=>b!=='Not identified').length,0)}
function rrPlan(a){
 const steps=['Confirm the creditor, account ending and reporting bureau against the original screenshots.','Compare balance, status and relevant dates with statements, payment records or correspondence.'];
 const rows=Object.entries(a.bureauReports||{}).filter(([b])=>b!=='Not identified');
 if(rows.length>1)steps.push('Compare the bureau-specific figures and reported-as-of dates. A difference alone does not establish an error.');
 if(a.conflicts?.length)steps.push('Resolve OCR or source conflicts shown below before relying on any disputed field.');
 if(a.type==='Collection')steps.push('Identify the current collector and original creditor; check collection notices and consider a timely debt-validation request when applicable.');
 if(a.type==='Charge-off')steps.push('Verify first-delinquency timing, charge-off status, ownership and the reported balance with the creditor’s records.');
 if(a.type==='Late payments')steps.push('Match each late-payment month to its payment confirmation, due date, and statement.');
 if(a.type==='Repossession')steps.push('Check repossession and sale statements, proceeds, fees and any remaining balance.');
 steps.push('If a specific field is wrong, choose the affected bureau, describe the correct fact and attach supporting evidence.');
 steps.push('Transfer the verified account once, then open Letter Studio to review the automatically filled bureau-specific draft.');
 return steps;
}

function rrHeuristic(a,all){const hints=[];const st=(a.status+' '+a.accountType+' '+a.paymentHistory).toLowerCase();const reports=Object.entries(a.bureauReports||{}).filter(([b])=>b!=='Not identified').map(([b,v])=>({...v,bureau:b}));const bal=[...new Set(reports.map(r=>r.balance).filter(x=>x!==''))];const sts=[...new Set(reports.map(r=>r.status).filter(Boolean))];if(bal.length>1)hints.push({kind:'Compare',title:'Bureau balances are different',body:reports.map(x=>x.bureau+': '+rrMoney(x.balance)+' (reported '+(x.lastReported||'date unknown')+')').join('; ')+'. Check reporting dates, statements and actual balance before deciding if either entry is wrong.',issue:'balance'});if(sts.length>1)hints.push({kind:'Compare',title:'Bureau statuses are different',body:reports.map(x=>x.bureau+': '+(x.status||'Not shown')).join('; ')+'. Compare the reports and source records to decide whether a correction is needed.',issue:'other'});if(a.type==='Collection'){hints.push({kind:'Review',title:'Check the collection details',body:'Compare the amount, creditor name, ownership and first-delinquency date with your records. A collection entry is not automatically an error.',issue:'balance'});hints.push({kind:'Option',title:'Debt validation request',body:'If you received a collector’s validation notice, review its dispute-by date. A validation request and a credit-bureau dispute are different processes.',issue:''})}else if(a.type==='Charge-off')hints.push({kind:'Review',title:'Check the charge-off reporting',body:'A charge-off means the lender wrote the debt off in its accounting. It does not by itself prove the balance is wrong or the debt is canceled.',issue:'balance'});if(/late|delinquen|30|60|90|120|past due/.test(st)||Number(a.pastDue)>0)hints.push({kind:'Review',title:'Verify payment history',body:'Check every late month against payment receipts and statements. A late mark should only be disputed if a specific date or status is inaccurate.',issue:'late'});if(/paid|settled|closed/.test(st)&&Number(a.balance)>0)hints.push({kind:'Check',title:'Balance and status need a closer look',body:'The status mentions paid, settled or closed but a balance is shown. Some closed accounts legitimately retain a balance. Verify the exact status and amount.',issue:'paid'});const balance=Number(a.balance),limit=Number(a.limit);if(a.limit&&limit>0&&a.balance&&balance>=0)hints.push({kind:'Education',title:'Credit utilization: '+Math.round(balance/limit*100)+'%',body:'This is the balance divided by the limit. High utilization can affect scoring but is not itself a reporting error or grounds for deletion.',issue:''});if(a.firstMissed)hints.push({kind:'Check',title:'First delinquency date',body:'Check the first missed-payment date against original statements. A sale to a collector does not create a new first delinquency date.',issue:'date'});const matches=all.filter(x=>x.id!==a.id&&x.company.toLowerCase().replace(/[^a-z0-9]/g,'')===a.company.toLowerCase().replace(/[^a-z0-9]/g,'')&&(!a.account||!x.account||a.account===x.account));if(matches.some(x=>x.bureau!==a.bureau&&x.balance!==a.balance&&x.balance!==''&&a.balance!==''))hints.push({kind:'Compare',title:'Balances differ across reports',body:'A matching creditor has a different balance on another bureau’s report. Reporting dates can differ. Compare the dates and your records before identifying an error.',issue:'balance'});if(matches.some(x=>x.bureau===a.bureau))hints.push({kind:'Compare',title:'Two similar entries appear',body:'Check whether these are separate legal accounts, or an original creditor and collector reporting the same debt. Similar entries do not automatically mean unlawful duplicates.',issue:'duplicate'});if(!hints.length)hints.push({kind:'Check',title:'Compare the report to your records',body:'Verify the owner, account reference, balance, status and dates. If all are accurate, there may be nothing to dispute.',issue:''});return hints;}
function rrExplain(a){const shown=Object.entries(a.bureauReports||{}).filter(([b])=>b!=='Not identified');let intro=`${a.company} appears across ${a.sourcePages?.length||1} screenshot(s) as one account${shown.length?' reported by '+shown.map(([b])=>b).join(' and '):' with an unidentified reporting bureau'}. `;intro+=a.account?`The visible account reference ends in ${a.account}. `:'The account reference was not reliably extracted. ';if(shown.length)intro+='Per-bureau balances and statuses: '+shown.map(([b,r])=>b+': '+rrMoney(r.balance)+', '+(r.status||'status not shown')).join('; ')+'. ';else if(a.balance!=='')intro+=`The reported balance is ${rrMoney(a.balance)}. `;if(a.status&&shown.length<2)intro+=`The reported status is “${a.status}”. `;if(a.type==='Collection')intro+='A collection generally means a collector or debt buyer reports a debt. That is not proof the debt is valid or invalid. ';else if(a.type==='Charge-off')intro+='A charge-off is an accounting classification, not automatic debt forgiveness. ';else if(a.type==='Late payments')intro+='Late marks describe past payment timing, and must be compared with your actual payment records. ';if(a.limit)intro+=`The reported credit limit is ${rrMoney(a.limit)}. `;intro+='These are details extracted from the document, not verified findings. Check against the original report and supporting records.';return intro;}
function rrSummary(){const as=reportReader.accounts;const bs=[...new Set(as.flatMap(a=>Object.keys(a.bureauReports||{})))].filter(b=>b!=='Not identified');if(!as.length)return 'No confidently identified account yet. OCR may have found fragments, but they have NOT been counted as accounts. Correct the text or use iPhone Live Text, then rescan.';return `Identified ${as.length} distinct account${as.length===1?'':'s'} from ${reportReader.extracted.length} file${reportReader.extracted.length===1?'':'s'}, containing ${rrBureauCount()} bureau-specific record${rrBureauCount()===1?'':'s'}. ${bs.length?'Bureaus detected: '+bs.join(', ')+'. ':''}Each account is grouped across its screenshots. Review possible inaccuracies and supporting records before preparing letters; no error has been assumed.`}
function rrAiRedact(text){
 let s=rrSanitize(text).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email hidden]').replace(/\b(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g,'[phone hidden]')
 .replace(/\b(?:DOB|Date of Birth|Birthdate)\s*[:#-]?\s*(?:\d{1,2}[/-]){2}\d{2,4}\b/gi,'[date of birth hidden]');
 const p=reportReader.profile;
 for(const v of [p.name,p.address])if(v&&String(v).length>=5)s=s.split(String(v)).join('[client personal detail hidden]');
 return s;
}
function rrAiPrepare(){
 const r=reportReader.ai;
 const summary=reportReader.accounts.map(a=>`Creditor: ${a.company}\nBureau: ${a.bureau}\nAccount last four: ${a.account}\nStatus: ${a.status}\nBalance: ${a.balance}\nLimit: ${a.limit}\nType: ${a.type}\nFirst missed: ${a.firstMissed}\nNotes: ${reportReader.review[a.id]?.note||''}`).join('\n---ACCOUNT---\n');
 const raw=reportReader.reportText.trim();
 if(!raw&&!summary&&!r.images.length){toast('Read a file or paste report text first');return}
 r.payload=rrAiRedact((raw.trim().length>80?raw:(summary||'[Image-only credit report. Please inspect the screenshots and extract the account fields actually visible.]')).slice(0,43000)).slice(0,40000);
 r.result=null;r.answer='';r.error='';r.status='Review the text below, remove anything private, then explicitly approve sending it.';
 render();
}
function rrAiPanel(){
 const a=reportReader.ai,images=a.images.length,result=a.result,entries=reportReader.accounts.length;
 const thumbList=images?`<div class="ai-screenshot-list">${a.images.slice(0,8).map((im,i)=>`<div class="ai-screenshot"><img src="${im.data}" alt="Uploaded page ${i+1}" loading="lazy"><span>${rrEsc(im.name)}</span></div>`).join('')}${images>8?`<div class="ai-screenshot-more">+ ${images-8} more saved in this session</div>`:''}</div>`:'';
 return `<section class="card ai-panel ai-panel-v6" id="ai-assistant">
 <div class="row-between"><div><span class="eyebrow">AI REPORT READER · OPTIONAL</span><h2>Scan screenshots. Fill your case.</h2></div><div class="ai-icon" aria-hidden="true">✦</div></div>
 <p class="soft small">Upload your report screenshots or PDF above. When your API has credits, the AI can read visual pages, explain the reporting, and prepare the account fields. You verify the results before they're saved to a client's case or used in a letter.</p>
 <div class="ai-v6-steps"><span><b>1</b> Upload</span><span><b>2</b> Read with AI</span><span><b>3</b> Compare + autofill</span></div>
 <div class="ai-v6-queued"><strong>${images?`${images} screenshot${images===1?'':'s'} ready for AI vision`:`${entries?`${entries} distinct accounts grouped`:'Upload a PDF or screenshots to begin'}`}</strong><small>All uploaded screenshots can be analyzed in sequential, small batches—not just the first two.</small>${thumbList}</div>
 <details class="ai-v6-settings"><summary>⚙ AI connection settings</summary><div class="field"><label for="readerAiEndpoint">AI backend URL</label><input id="readerAiEndpoint" type="url" spellcheck="false" autocomplete="off" value="${rrEsc(a.endpoint)}" placeholder="https://...vercel.app/api/analyze-report"/></div><div class="field"><label for="readerAiCode">Private access code (not OpenAI API key)</label><input type="password" id="readerAiCode" autocomplete="off" value="${rrEsc(a.accessCode)}" placeholder="Enter AI_ACCESS_CODE"/></div><p class="small-print">Your OpenAI API key stays on the Vercel server. This access code stays in memory for this session. Enter it again after restarting the Home Screen app.</p></details>
 ${!a.accessCode?`<div class="callout warning" style="margin:12px 0">Enter your private <strong>AI access code</strong> under AI connection settings first. Do not enter or share your OpenAI API key.</div>`:''}
 ${a.payload?`<details class="ai-v6-data"><summary>Review and edit report text sent to AI</summary><div class="field"><label for="readerAiPayload">Text preview</label><textarea id="readerAiPayload" rows="5" spellcheck="false">${rrEsc(a.payload)}</textarea><div class="hint">Sensitive text is redacted where detected, but redaction is not perfect. Read before sending. Screenshot pixels cannot be automatically redacted.</div></div></details>`:''}
 ${images?`<label class="toggle-line"><input type="checkbox" id="readerAiImages" ${a.includeImages?'checked':''}/><span><strong>Use AI vision to read the screenshots (${images})</strong><span class="muted small">Recommended. Images might contain sensitive personal information; they will be sent to your AI provider only with your consent.</span></span></label>`:''}
 <label class="toggle-line ai-consent" style="margin:10px 0"><input type="checkbox" id="readerAiConsent" ${a.consent?'checked':''}/><span><strong>I have permission to process this report and approve sending the selected text/images to my private AI service</strong><span class="muted small">The AI backend forwards selected content to OpenAI. Do not scan someone else's credit report without authorization.</span></span></label>
 <div class="row-wrap"><button class="btn mint ai-v6-primary" data-action="reader-ai-analyze" ${a.busy?'disabled':''}>${a.busy?'◌ Reading your screenshots…':`✦ ${images?'Read ALL screenshots with AI':'Analyze report with AI'}`}</button><button class="btn secondary" data-action="reader-ocr-only" ${a.busy?'disabled':''}>Free screenshot OCR · no AI credits</button></div>
 <div class="reader-diagnostics"><strong>AI connection diagnostics</strong><p class="small soft">Check your code for free, or run one small fictional AI test to verify the model (API usage may be billed). No real client data is used in either test.</p><div class="row-wrap"><button class="btn secondary sm" data-action="reader-ai-test-connection" ${a.busy?'disabled':''}>✓ Check connection</button><button class="btn secondary sm" data-action="reader-ai-test-model" ${a.busy?'disabled':''}>✦ Test AI model (fictional)</button></div>${a.connectionStatus?`<p class="small soft" aria-live="polite">${rrEsc(a.connectionStatus)}</p>`:''}</div>
 ${a.status?`<p class="small muted" aria-live="polite" id="readerAiStatus">${rrEsc(a.status)}</p>`:''}
 ${a.error?`<div class="callout warning" role="alert"><strong>AI could not finish: </strong>${rrEsc(a.error)}<p class="small">Use Check connection above to identify a wrong code or missing backend. Use the fictional AI test to check OpenAI billing.</p></div>`:''}
 ${result?`<div class="ai-result"><span class="eyebrow">AI REVIEW · UNVERIFIED</span><h3>${(result.accounts||[]).length} account${result.accounts?.length===1?'':'s'} identified</h3><p>${rrEsc(result.summary||'')}</p>
 ${a.result?.profile?.name?`<p class="small soft"><strong>Report holder detected:</strong> ${rrEsc(a.result.profile.name)} — confirm this matches the client before importing.</p>`:''}
 ${(result.accounts||[]).map((x,i)=>`<div class="ai-account"><div class="row-between"><strong>${rrEsc(x.company||'Unidentified')}</strong><span class="pill">${rrEsc(x.bureau||'Bureau unknown')}</span></div><p class="small"><strong>${x.balance?rrEsc(rrMoney(rrNum(x.balance))):'Balance not shown'}</strong> · ${rrEsc(x.status||'Status not shown')} ${x.accountLast4?' · ••••'+rrEsc(x.accountLast4):''}</p><p>${rrEsc(x.explanation||'')}</p><p class="small"><strong>Review:</strong> ${rrEsc(x.suggestedPath||'')}</p>${x.verificationQuestions?.length?`<p class="small soft">Evidence to check: ${x.verificationQuestions.slice(0,4).map(rrEsc).join(' • ')}</p>`:''}</div>`).join('')}
 ${(result.cautions||[]).length?`<div class="callout warning">${result.cautions.map(rrEsc).join(' • ')}</div>`:''}
 <div class="row-wrap"><button class="btn secondary" data-action="reader-ai-read-review">▶ Read findings aloud</button><button class="btn mint ai-v6-primary" data-action="reader-ai-autofill">✓ Review & autofill my case</button></div><p class="small-print">The account details are already prepared in the Reader below. Saving requires your confirmation; AI suggestions alone do not establish an inaccuracy or automatically create dispute allegations.</p></div>`:''}
 <details class="ai-v6-ask"><summary>Ask AI to explain something specific</summary><div class="field"><label for="readerAiQuestion">Your question</label><textarea id="readerAiQuestion" rows="2" placeholder="What do these charge-off dates mean?">${rrEsc(a.question)}</textarea></div><button class="btn secondary" data-action="reader-ai-ask" ${a.busy?'disabled':''}>Ask about my report</button>${a.answer?`<div class="ai-answer"><p>${rrEsc(a.answer)}</p><button class="btn sm secondary" data-action="reader-ai-read-answer">▶ Listen</button></div>`:''}</details>
 <div class="row-wrap" style="margin-top:10px"><button class="btn ghost sm" data-action="reader-ai-prepare">Refresh private text preview</button><button class="btn ghost sm" data-action="reader-ai-clear">Clear AI findings</button></div>
 </section>`;
}
function rrQueueCanvas(canvas,name){
 const a=reportReader.ai;
 const maxEdge=2800,original=Math.max(canvas.width,canvas.height),ratio=Math.min(1,maxEdge/original);
 const out=document.createElement('canvas');out.width=Math.max(1,Math.round(canvas.width*ratio));out.height=Math.max(1,Math.round(canvas.height*ratio));
 const ctx=out.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,0,out.width,out.height);
 let data='';for(const quality of [.93,.86,.77,.68,.55]){data=out.toDataURL('image/jpeg',quality);if(data.length<1500000)break}
 if(data.length>=1580000){const shrink=document.createElement('canvas');shrink.width=Math.floor(out.width*.75);shrink.height=Math.floor(out.height*.75);shrink.getContext('2d').drawImage(out,0,0,shrink.width,shrink.height);data=shrink.toDataURL('image/jpeg',.65);shrink.width=shrink.height=0}
 out.width=out.height=0;
 if(data.length>1600000)throw Error('Screenshot cannot fit the secure image limit. Take a closer screenshot of the account section.');
 a.images.push({name,data});return data;
}
async function rrAiCaptureImage(file,name){
 if(!/image\//.test(file.type)&&!/\.(png|jpe?g|webp|heic)$/i.test(name))return;
 const url=URL.createObjectURL(file);try{
  const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Image could not be decoded. Export as PNG or JPEG.'));im.src=url});
  const cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;cv.getContext('2d',{alpha:false}).drawImage(img,0,0);rrQueueCanvas(cv,name);
  reportReader.ocrSources.push({name,blob:file});cv.width=cv.height=0;
 }finally{URL.revokeObjectURL(url)}
}
function rrAiIngestProfile(raw){
 if(!raw||typeof raw!=='object')return true;
 const p={};for(const key of ['name','address','city','state','zip'])p[key]=rrShort(raw[key]||'',key==='address'?120:85);
 const old=String(reportReader.profile.name||'').replace(/\W/g,'').toLowerCase(),incoming=p.name.replace(/\W/g,'').toLowerCase();
 if(old&&incoming&&old!==incoming){reportReader.ai.error='The AI found a different report holder than an earlier upload. Clear the session and scan each person separately.';return false}
 for(const k of ['name','address','city','state','zip'])if(p[k]&&!reportReader.profile[k])reportReader.profile[k]=p[k];return true;
}
function rrAccountKey(a){
 const company=String(a.company||'').toLowerCase().replace(/\b(?:na|n\/a|inc|llc|corp|bank|services|collections|collection|credit|financial)\b/g,'').replace(/[^a-z0-9]/g,'');
 const last=rrLast4(a.accountLast4||a.account||'');
 return last?company+'|'+last:company+'|unknown:'+String(a.id||a.scanBatch||'');
}
function rrAiMergeResults(results){
 const merged={summary:results.map(x=>x.summary||'').filter(Boolean).join(' '),answer:results.map(x=>x.answer||'').filter(Boolean).join(' '),accounts:[],cautions:[...new Set(results.flatMap(x=>x.cautions||[]))],profile:{}};
 const seenNames=new Set();
 for(const item of results){
  if(item.profile?.name)seenNames.add(String(item.profile.name).trim().toLowerCase().replace(/[^a-z]/g,''));
  for(const k of ['name','address','city','state','zip'])if(!merged.profile[k]&&item.profile?.[k])merged.profile[k]=item.profile[k];
  for(const entry of item.accounts||[]){
   const x={...entry},company=String(x.company||'').trim(),acc=rrLast4(x.accountLast4||''),bureau=String(x.bureau||'').toLowerCase();
   if(!company)continue;
   // Match same account only when the creditor and last four both agree; do not collapse distinct accounts.
   const existing=acc&&merged.accounts.find(z=>rrLast4(z.accountLast4||'')===acc&&String(z.bureau||'').toLowerCase()===bureau&&String(z.company||'').toLowerCase().replace(/[^a-z0-9]/g,'')===company.toLowerCase().replace(/[^a-z0-9]/g,''));
   if(existing){
    for(const [k,v] of Object.entries(x))if(!existing[k]&&v)existing[k]=v;
    existing.sourcePages=[...new Set([...(existing.sourcePages||[]),...(x.sourcePages||[])])];
    continue;
   }
   merged.accounts.push(x);
  }
 }
 merged.mixedHolders=seenNames.size>1;if(merged.mixedHolders)merged.cautions.unshift('Different report holder names were detected. These results cannot be imported together.');
 return merged;
}
function rrAiFriendlyError(status,msg){
 const m=String(msg||'');
 if(status===401)return 'The private access code is incorrect or was reset. Enter the latest AI_ACCESS_CODE in AI connection settings.';
 if(status===403)return 'This website is not permitted by the backend. Check ALLOWED_ORIGIN in Vercel.';
 if(status===404)return 'The API route is missing. A GitHub deployment may have overwritten the Vercel AI backend.';
 if(status===413)return 'The screenshots are too large. Try a closer crop of one account.';
 if(status===503)return 'Backend credentials are missing. Check the Vercel Production secrets.';
 if(status===502){if(/quota|billing|insufficient|balance|credit/i.test(m))return 'OpenAI API billing or available credits may be blocking this request. Check API billing; ChatGPT Plus does not include API credits.';if(/model|invalid/i.test(m))return 'The AI model or API key was rejected. Check the backend model and API key on Vercel.';return 'AI provider error: '+m.slice(0,200)}
 if(status>=500)return 'The AI backend reported an error: '+m.slice(0,200);
 return m.slice(0,250)||`HTTP ${status}`;
}
async function rrAiConnectivityTest(model=false){
 const a=reportReader.ai;
 if(a.busy)return;
 if(!a.endpoint.trim()||!a.accessCode.trim()){a.error='Enter your AI backend URL and private access code in AI connection settings before testing.';render();return}
 a.busy=true;a.error='';a.connectionStatus='Checking your private AI connection…';render();
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
 try{
  const payload=model?{mode:'analyze',consent:true,text:'FICTIONAL DEMO REPORT. Consumer Name: Alex Morgan. Bureau: Experian. Account Name: Fictional Example Bank. Account Number: XXXX4471. Balance: $615. Credit Limit: $2500. Account Status: Current. Date Opened: 05/12/2020.',images:[]}:{mode:'analyze',consent:true,text:'',images:[]};
  const response=await fetch(a.endpoint.trim(),{method:'POST',mode:'cors',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json','X-Access-Code':a.accessCode},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({error:'The API did not return JSON.'}));
  if(!model&&response.status===400&&/nothing to analyze|no report data/i.test(String(data.error))){a.connectionStatus='✓ Connection and access code work. Tap Test AI model with fictional sample to verify your OpenAI API billing and model.';return}
  if(!response.ok){a.connectionStatus='Connection failed · HTTP '+response.status;a.error=rrAiFriendlyError(response.status,data.error);return}
  if(model){const n=data.accounts?.length||0;a.connectionStatus=n?`✓ LIVE AI TEST PASSED. Fictional test: ${n} account extracted.`:'AI answered but found no accounts in the fictional example. Check the model or backend configuration.';if(!n)a.error='The AI returned no identifiable account from the test text.'}
  else a.connectionStatus='✓ The backend answered. Your private access code was accepted.';
 }catch(e){a.connectionStatus='Could not reach the backend';a.error=e.name==='AbortError'?'AI connection timed out. Retry when online.':'Browser request failed. Check internet, backend URL, and Vercel deployment. ('+String(e.message||e).slice(0,120)+')'}
 finally{clearTimeout(timeout);a.busy=false;render()}
}
async function rrAiRun(mode){
 const a=reportReader.ai;
 if(a.busy)return;
 if(!a.endpoint.trim()||!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(a.endpoint.trim())){a.error='Set the HTTPS backend address under AI connection settings.';render();return}
 if(!a.accessCode.trim()){a.error='Open AI connection settings and enter your private access code—not your OpenAI API key.';render();return}
 if(!a.consent){a.error='Check the consent box to authorize sending this report to your AI service.';render();return}
 const useImages=a.includeImages?a.images:[];
 if(!a.payload.trim()&&(reportReader.reportText||useImages.length))rrAiPrepare();
 if(!a.payload.trim()&&!useImages.length){a.error='Upload screenshots, a PDF, or paste report text first.';render();return}
 if(mode==='ask'&&!a.question.trim()){a.error='Type your question first.';render();return}
 const batches=[];
 if(useImages.length){for(let i=0;i<useImages.length;i+=2)batches.push(useImages.slice(i,i+2))}else batches.push([]);
 a.busy=true;a.error='';a.lastSource='requesting-ai';a.status=`Connecting to AI · ${batches.length} image batch${batches.length===1?'':'es'}…`;
 // Make a copy of the latest typed fields before rendering.
 a.payload=document.getElementById('readerAiPayload')?.value??a.payload;
 a.question=document.getElementById('readerAiQuestion')?.value??a.question;
 render();const responses=[];
 try{
  for(let i=0;i<batches.length;i++){
   if(reportReader.cancel)break;
   a.status=`AI reading batch ${i+1} of ${batches.length} (${Math.min(useImages.length,(i+1)*2)} of ${useImages.length||0} images)…`;
   const el=document.getElementById('readerAiStatus');if(el)el.textContent=a.status;
   const text=(i===0?a.payload.slice(0,40000):`Continue reading this same person's next screenshot(s). Credit report holder: ${reportReader.profile.name||'not established'}. Extract only information from the attached new image(s).`);
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),65000);
   let response;
   try{response=await fetch(a.endpoint.trim(),{method:'POST',mode:'cors',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json','X-Access-Code':a.accessCode},body:JSON.stringify({mode,text,question:mode==='ask'?a.question.trim().slice(0,900):'',images:batches[i].map(x=>x.data),consent:true})})}finally{clearTimeout(timeout)}
   const data=await response.json().catch(()=>({error:`Server returned HTTP ${response.status}. Try again later.`}));if(!response.ok){a.lastHTTPStatus=response.status;throw Error(`AI batch ${i+1} · HTTP ${response.status}: ${rrAiFriendlyError(response.status,data.error)}`)}
   for(const finding of data.accounts||[]){finding.sourcePages=batches[i].map(page=>page.name);finding.scanBatch=i+1;}
   responses.push(data);
  }
  if(!responses.length)throw Error('AI did not return a result. Verify the connection with the test buttons.');
  const merged=rrAiMergeResults(responses);
  if(merged.mixedHolders)throw Error('Different report holders were detected among the pages. Clear this scan and upload one person per session. No data was imported.');
  if(mode==='ask'){a.answer=rrShort(merged.answer||merged.summary||'No answer returned',6000);a.status='AI answered. Cross-check the document before relying on its findings.'}
  else{
   if(!rrAiIngestProfile(merged.profile))throw Error('Mixed report holders detected. Clear the Reader and keep each person separate.');
   a.result=merged;
   const n=rrAiReviewImport(true);
   if(!merged.accounts.length||(!n&&!reportReader.accounts.some(x=>x.aiReview)))a.error='The AI could not identify an account from these images. Crop closer to the creditor name, balance and account status, then retry.';
   a.lastSource='ai';
   a.status=`AI scanned ${useImages.length} screenshot(s) in ${responses.length} batch(es). ${merged.accounts.length} account finding(s); ${n} new entries staged automatically for review and autofill.`;
  }
 }catch(e){a.error=String(e.message||e).slice(0,420);a.lastSource='failed';a.status=responses.length?`Paid AI only analyzed part of the report. Free on-device OCR remains available; no charge is required for it.`:'Paid AI unavailable. Your on-device OCR and knowledge guide still work without OpenAI credits.';
  // Preserve successful partial analysis instead of discarding it.
  if(mode==='analyze'&&responses.length){const m=rrAiMergeResults(responses);if(!m.mixedHolders&&rrAiIngestProfile(m.profile)){a.result=m;rrAiReviewImport(true)}}
 }finally{a.busy=false;render()}
}
function rrAiReviewImport(silent=false){const r=reportReader,items=r.ai.result?.accounts||[];if(!items.length){if(!silent)toast('AI did not identify any accounts');return 0}r.aiEntries=[];for(const x of items){if(!x.company||/^(unknown|unidentified|not provided)/i.test(x.company))continue;const a={id:'ai-'+Math.random().toString(36).slice(2,10),company:rrShort(x.company,85),account:rrLast4(x.accountLast4),balance:rrNum(x.balance),limit:rrNum(x.creditLimit),status:rrShort(x.status,125),originalCreditor:rrShort(x.originalCreditor,100),accountType:rrShort(x.accountType,80),pastDue:rrNum(x.pastDue),opened:rrDate(x.dateOpened),firstMissed:rrDate(x.firstDelinquency),lastReported:rrDate(x.lastReported),paymentHistory:rrShort(x.paymentHistory,120),reportDate:'',type:x.type||'Other',bureau:BUREAUS.includes(x.bureau)?x.bureau:'Not identified',source:(x.sourcePages||[])[0]||'Optional AI scan',confidence:'AI review · verify',raw:x.sourceQuote||'',sourcePages:x.sourcePages||[],aiReview:{explanation:x.explanation,suggestedPath:x.suggestedPath,sourcePages:x.sourcePages||[]}};r.aiEntries.push(a)}rrReconcile();r.status=`AI observations grouped: ${r.accounts.length} distinct accounts. Review before any case import.`;if(!silent){render();toast('AI findings grouped by account and bureau')}return r.aiEntries.length}
function rrBureauGroups(){return reportReader.accounts.map(a=>({company:a.company,last:a.account,entries:Object.entries(a.bureauReports||{}).filter(([b])=>b!=='Not identified').map(([b,v])=>({...v,bureau:b,company:a.company,id:a.id})),conflicts:a.conflicts||[],sourcePages:a.sourcePages||[]}))}
function rrBureauMatrix(){const groups=rrBureauGroups();if(!groups.length)return '';return `<section class="card bureau-matrix"><div class="row-between"><div><span class="eyebrow">ONE ACCOUNT · MULTIPLE BUREAUS</span><h2>Compare the reporting, not the screenshots</h2></div><span class="pill">${groups.length} distinct account${groups.length===1?'':'s'}</span></div><p class="small soft">Each column represents what that bureau appears to report. Multiple screenshots of one account are evidence, not additional accounts. Different values must be checked against their dates and records before disputing.</p>${groups.map(g=>{const by=BUREAUS.map(b=>g.entries.find(x=>x.bureau===b));const values=[...new Set(by.filter(Boolean).map(x=>x.balance).filter(v=>v!==''))];const differences=values.length>1||[...new Set(by.filter(Boolean).map(x=>x.status).filter(Boolean))].length>1;return `<div class="matrix-group"><div class="row-between"><strong>${rrEsc(g.company)}${g.last?' ·•••• '+rrEsc(g.last):''}</strong>${differences?'<span class="pill warn">Compare values</span>':'<span class="pill">Grouped</span>'}</div><div class="matrix-grid">${BUREAUS.map((b,ix)=>{const x=by[ix];return `<div class="matrix-cell"><b>${rrEsc(b)}</b>${x?`<strong>${rrEsc(rrMoney(x.balance))}</strong><span>${rrEsc(x.status||'Status not shown')}</span><small>Reported ${rrEsc(x.lastReported||'date not shown')}</small><small>${x.sourcePages.length} screenshot${x.sourcePages.length===1?'':'s'}</small>`:'<small>Not identified in uploads</small>'}</div>`}).join('')}</div>${differences?'<p class="small-print">Check timing and source records; differences are leads, not proven inaccuracies.</p>':''}</div>`}).join('')}</section>`}
function rrAiFastAutofill(){
 const r=reportReader;
 if(!r.accounts.length){toast('Scan some screenshots first');return}
 const checkbox=document.getElementById('readerImportConfirm');
 if(!checkbox){toast('Scroll to Transfer to case and choose where to import');return}
 if(!confirm(`Autofill ${r.selected.size} distinct account(s) into a draft client case? Confirm that you checked the displayed account names, balances and statuses against the original screenshots. No dispute allegation will be asserted automatically.`))return;
 checkbox.checked=true;
 const profileBox=document.getElementById('readerProfileConfirm');if(profileBox)profileBox.checked=true;
 rrImport();
}
function rrInfoHTML(){return `<div class="callout mint"><strong>No-payment reading available.</strong> Credit-report text stays in this browser session. The report is not sent to a credit bureau. You control whether to send selected screenshots to the optional AI service. PDF and backup OCR libraries are bundled. Standard local OCR may load a library from a CDN when internet is available, but recognition happens on your device without an OpenAI API key. Your private notes can be encrypted on this device. The AI service only sends information after you explicitly approve transmitting your report; it needs a separate server connection. Automatic local suggestions are rule-based and can be wrong.</div>`}
function readerPage(){const s=reportReader,client=activeClient();const selected=s.accounts.filter(a=>s.selected.has(a.id)).length;return `<section class="page-head"><div><div class="eyebrow">REPORT READER 12.0 · ACCOUNT-FIRST</div><h1>Read & analyze your report</h1><p>Upload PDFs or screenshots, hear what each account means, correct extracted values, and autofill dispute drafts after your review.</p></div></section>
<div class="card reader-intro"><div class="row-between"><div><div class="eyebrow">REPORT ASSISTANT</div><h3>Know what you're looking at</h3><p class="small soft">Reads reports on your device with no API payment, searches your stored credit education and personal study notes, and prepares verified information for your case.</p></div><div class="reader-icon" aria-hidden="true">▤</div></div><div class="row-wrap"><button class="btn mint" data-action="reader-ai-pick">✦ Read screenshots FREE</button><button class="btn secondary" data-action="reader-pick">＋ Upload only</button><button class="btn ghost" data-action="reader-demo">Try a sample</button><button class="btn secondary" data-action="reader-knowledge-open">▧ Free Knowledge Vault</button><a class="btn secondary" href="./offline-desk.html">◈ Open Full Offline Desk 2</a></div><p class="small-print">The Reader tries standard on-device OCR first, then the bundled offline engine when needed. No OpenAI credits required. Every extracted word is editable; verify account details before saving.</p><input type="file" id="reportUpload" hidden multiple accept=".pdf,application/pdf,image/*,.txt,text/plain"/><div class="small-print" style="margin-top:13px">Supports PDF, JPG, PNG, screenshots, and TXT. Multiple files allowed. Scanned pages can take longer on iPhone. PDF and screenshot readers are bundled locally; once your Home Screen app has cached them, reading does not require an internet connection.</div></div>
<div class="card flat" style="margin-top:14px"><div class="row-between" style="margin-bottom:10px"><strong>Or paste text from a report</strong><span class="pill">Private session</span></div><textarea class="reader-paste" id="reportPaste" placeholder="Example: Account Name: ABC Bank&#10;Account Number: ****1234&#10;Balance: $850&#10;Account Status: Collection" rows="5">${rrEsc(s.paste)}</textarea><div class="row-wrap" style="margin-top:9px"><div class="field" style="flex:1;min-width:140px"><label for="readerBureau">Bureau shown</label><select id="readerBureau" data-reader-bureau="1"><option value="auto">Detect automatically</option>${BUREAUS.map(b=>`<option value="${b}" ${s.forcedBureau===b?'selected':''}>${b}</option>`).join('')}</select></div><button class="btn primary" data-action="reader-paste-run" style="align-self:end">Analyze pasted text</button></div></div>
${rrInfoHTML()}<div class="reader-progress ${s.busy?'reader-progress-busy':''}" id="readerProgress" aria-live="polite">${s.busy?'<span class="reader-spinner">◌</span> ':''}${rrEsc(s.status||'Ready for report files.')}${s.busy?'<button class="btn sm secondary" data-action="reader-cancel">Stop</button>':''}</div>
${s.error?`<div class="callout warning" role="alert"><strong>Reader issue:</strong> ${rrEsc(s.error)}<p class="small">You can still correct the OCR text below or use iPhone Photos Live Text. No paid AI required.</p></div>`:''}
${s.extracted.length?`<div class="section-title"><h3>Files processed</h3><button class="btn ghost sm" data-action="reader-clear">Clear session</button></div><div class="stack">${s.extracted.map(x=>`<div class="reader-source"><span>▤</span><div><strong>${rrEsc(x.name)}</strong><div class="small muted">${rrEsc(x.bureau)} • ${x.entries.length} OCR finding(s) — grouped below • ${rrEsc(x.method)}${x.warning?' • '+rrEsc(x.warning):''}</div></div></div>`).join('')}</div>`:''}
${rrOCRPanel()}
${s.extracted.length?`<div class="reader-overview card"><span class="eyebrow">${s.accounts.length?'PLAIN-ENGLISH SUMMARY':'SCAN NOT COMPLETE'}</span><h2>${s.accounts.length?'Here is what the document says':'No account details read yet'}</h2><p>${rrEsc(rrSummary())}</p><div class="row-wrap"><button class="btn primary" data-action="reader-speak-summary">▶ Read it to me</button><button class="btn secondary" data-action="reader-speak-all">▶ Explain all items</button><button class="btn ghost" data-action="reader-stop-speech">■ Stop voice</button><label class="reader-speed">Voice <select id="readerVoiceSpeed"><option value="0.75" ${s.voiceRate===0.75?'selected':''}>Slow</option><option value="0.92" ${s.voiceRate===0.92?'selected':''}>Normal</option><option value="1.15" ${s.voiceRate===1.15?'selected':''}>Fast</option></select></label></div></div>`:''}
${s.uncertainCount?`<div class="callout warning"><strong>${s.uncertainCount} uncertain OCR fragment(s) were not counted as accounts.</strong> Review and correct the recognized text if important account details are missing.</div>`:''}
${s.extracted.length?`<div class="reader-metrics"><div><b>${s.accounts.length}</b><span>Distinct accounts</span></div><div><b>${s.extracted.length}</b><span>Files read</span></div><div><b>${s.accounts.reduce((n,a)=>n+(a.conflicts?.length||0),0)}</b><span>Field conflicts to review</span></div></div><div class="section-title"><h3>Accounts to review</h3><span class="pill">${selected} selected</span></div>${s.accounts.length?s.accounts.map((a,n)=>readerAccountHTML(a,n)).join(''):'<div class="callout warning">No complete accounts were identified. Review the OCR transcript above, correct it, or use iPhone Photos Live Text. You can also add the account manually. The paid AI connection remains optional.</div>'}<div class="card reader-review"><div class="section-title" style="margin:0 0 10px"><h3>Transfer to case</h3><span class="pill">You approve first</span></div><p class="soft small">Copy only the selected extracted fields. Suggested dispute issues are <strong>not</strong> automatically asserted. An issue is transferred only when you choose it, describe supporting facts, and check that you verified it.</p><div class="field" style="margin:12px 0"><label for="readerTarget">Import into which client?</label><select id="readerTarget"><option value="new" ${!client?'selected':''}>＋ Create a separate client case</option>${client?`<option value="current" selected>${rrEsc(clientLabel(client))} — existing case</option>`:''}</select></div>${client&&s.profile.name&&client.name&&s.profile.name.toLowerCase().replace(/\s+/g,' ')!==client.name.toLowerCase().replace(/\s+/g,' ')?`<label class="toggle-line"><input type="checkbox" id="readerOtherNameConfirm"/><span><strong>Names differ: ${rrEsc(s.profile.name)} vs. ${rrEsc(client.name)}</strong><span class="muted small">Only add this report to the existing case if you have confirmed it belongs to that person.</span></span></label>`:''}${s.profile.name?`<div class="reader-profile"><strong>Detected report holder: ${rrEsc(s.profile.name)}</strong><p class="small muted">Use these identity fields only if you have checked that the report belongs to this person.</p><label class="toggle-line"><input id="readerProfileConfirm" type="checkbox"/><span>Use detected profile details to fill <em>blank</em> client fields only</span></label></div>`:''}<label class="toggle-line"><input type="checkbox" id="readerImportConfirm"/><span>I compared selected details with the original report and understand this is a draft for review</span></label><div class="row-wrap"><button class="btn mint" data-action="reader-import">Import ${selected} ${selected===1?'entry':'entries'} into case →</button><button class="btn primary" data-action="reader-import-letters">Import &amp; open dispute letters →</button><button class="btn secondary" data-action="reader-speak-raw">▶ Read extracted report text</button></div>${s.importResult?`<div class="callout mint" style="margin-top:12px">${rrEsc(s.importResult)} <button class="btn sm secondary" data-action="nav" data-value="cases">Review cases</button> <button class="btn sm primary" data-action="nav" data-value="letters">Open letters</button></div>`:''}<details style="margin-top:15px"><summary class="small soft">Show extracted text (review against original)</summary><p class="small-print">Sensitive numbers are masked in this preview. The original document remains on your device.</p><pre class="reader-text-preview">${rrEsc(rrSanitize(s.reportText).slice(0,40000))}</pre></details></div>`:''}
${FK.panel()}${rrAiPanel()}${rrBureauMatrix()}`}

function rrSuggestedPath(a){
 const status=String(a.status||'').toLowerCase();
 if(a.type==='Collection'||a.type==='Medical collection')return {title:'Review a validation request + reporting dispute',issue:'balance',body:'First check who owns the debt, the amount, the date of first delinquency, and the collector notice. You may ask the collector for validation; send a bureau dispute only for a specific reporting error supported by records.'};
 if(a.type==='Charge-off')return {title:'Review account balance, dates and status',issue:'balance',body:'A charge-off alone is not an error. Compare the balance, charge-off date and payment history with your statements before choosing an accuracy dispute.'};
 if(a.type==='Late payments'||/30 days|60 days|90 days|late payment|delinquen/i.test(status))return {title:'Payment-history review; goodwill if accurate',issue:'late',body:'Compare each late-payment month with dated payment proof. If the marks are accurate, a goodwill request is different from an accuracy dispute and is not guaranteed.'};
 if(a.type==='Not my account')return {title:'Verify identity and ownership',issue:'notmine',body:'If the account truly belongs to someone else or resulted from identity theft, preserve identity documents and consider identity theft reporting. Do not select this just because the account is unfamiliar.'};
 if(a.type==='Inquiry')return {title:'Verify whether the inquiry was authorized',issue:'inquiry',body:'Check the inquiry date, company and any application you made. Only dispute the inquiry as inaccurate or unauthorized when verified.'};
 if(a.type==='Personal information')return {title:'Personal-information correction',issue:'personal',body:'Check spelling, addresses, phone numbers and associated records before requesting a correction.'};
 if(a.type==='Repossession')return {title:'Review repossession dates, proceeds and balance',issue:'balance',body:'Compare the dates, sale proceeds, fees and balance with original records. A repossession entry alone is not proof of an error.'};
 if(/paid|settled/.test(status)&&a.balance!==''&&Number(a.balance)>0)return {title:'Investigate balance versus payment status',issue:'paid',body:'The account may need closer review because its reported status mentions payment or settlement. Confirm whether any remaining balance is legitimate.'};
 return {title:'Check for specific reporting inaccuracies',issue:'other',body:'Compare creditor, balance, account reference, dates and status. If all match your records, no accuracy dispute may be appropriate.'};
}
function rrEditableFields(a){
 const fields=[['company','Creditor / collector','text'],['account','Account ending (last 4)','text'],['balance','Balance shown','decimal'],['limit','Credit limit','decimal'],['status','Status','text'],['originalCreditor','Original creditor','text'],['firstMissed','First delinquency (YYYY-MM-DD)','date'],['lastReported','Last reported (YYYY-MM-DD)','date']];
 return `<details class="reader-correct"><summary>✎ Correct extracted fields before autofill</summary><p class="small muted">OCR can misread account numbers, names or dollar amounts. Edit anything that differs from the original credit report, then review the case again after importing.</p><div class="reader-correct-grid">${fields.map(([key,label,type])=>`<div class="field"><label>${label}</label><input type="${type==='decimal'?'text':type}" ${type==='decimal'?'inputmode="decimal"':''} data-reader-edit="${a.id}" data-reader-key="${key}" value="${rrEsc(a[key]||'')}" placeholder="Not shown" autocomplete="off"></div>`).join('')}<div class="field"><label>Bureau</label><select data-reader-edit="${a.id}" data-reader-key="bureau">${['Not identified',...BUREAUS].map(b=>`<option value="${b}" ${a.bureau===b?'selected':''}>${b}</option>`).join('')}</select></div><div class="field"><label>Reporting type</label><select data-reader-edit="${a.id}" data-reader-key="type">${TYPES.map(t=>`<option value="${rrEsc(t)}" ${a.type===t?'selected':''}>${rrEsc(t)}</option>`).join('')}</select></div></div><button class="btn secondary sm" data-action="reader-refresh" data-value="${a.id}">Update explanations with corrected fields</button></details>`;
}
function readerAccountHTML(a,n){
 const s=reportReader,review=s.review[a.id]||{},hints=rrHeuristic(a,s.accounts),path=rrSuggestedPath(a),chosen=!!s.selected.has(a.id),bureaus=Object.entries(a.bureauReports||{});
 return `<section class="card reader-account" id="reader-account-${a.id}"><div class="row-between reader-account-head"><label class="reader-select"><input type="checkbox" data-reader-select="${a.id}" ${chosen?'checked':''}/><span class="reader-index">${n+1}</span><span class="reader-account-name">${rrEsc(a.company)}</span></label><span class="pill">${a.sourcePages.length} screenshot${a.sourcePages.length===1?'':'s'} grouped</span></div>
 <div class="reader-chips"><span>${rrEsc(a.type)}</span>${a.account?`<span>Account •••• ${rrEsc(a.account)}</span>`:'<span>Account number unconfirmed</span>'}<span>${bureaus.filter(([b])=>b!=='Not identified').length} reporting bureau(s)</span></div>
 <h3 style="margin:14px 0 7px">What each bureau reports</h3><div class="reader-grid">${bureaus.map(([b,x])=>`<div style="padding:12px;border:1px solid var(--line, #34435e);border-radius:12px"><strong>${rrEsc(b)}</strong><div class="small">Balance: <b>${rrEsc(rrMoney(x.balance))}</b></div><div class="small">Status: ${rrEsc(x.status||'Not shown')}</div><div class="small">Last reported: ${rrEsc(x.lastReported||'Not shown')}</div><div class="small">First delinquency: ${rrEsc(x.firstMissed||'Not shown')}</div><div class="small">${x.sourcePages.length} source screenshot(s)</div></div>`).join('')}</div>
 ${a.conflicts.length?`<div class="callout warning" style="margin-top:10px"><strong>${a.conflicts.length} field reading(s) conflict on the same bureau.</strong> Check the images before using those fields. ${a.conflicts.map(c=>`<p class="small">${rrEsc(c.bureau)} · ${rrEsc(c.field)}: ${rrEsc(c.values.join(' vs '))}</p>`).join('')}</div>`:''}
 <div class="reader-explanation"><div class="row-between"><strong>Analysis · what the report says</strong><button class="btn secondary sm" data-action="reader-speak-item" data-value="${a.id}">▶ Listen</button></div><p>${rrEsc(a.aiReview?.explanation||rrExplain(a))}</p></div>
 <div class="reader-path"><span class="eyebrow">WHICH REPAIR PATH FITS?</span><strong>${rrEsc(path.title)}</strong><p>${rrEsc(path.body)}</p><small>Suggested review only; a charge-off or collection is not automatically inaccurate.</small></div>
 <details open class="reader-action-plan"><summary><strong>Step-by-step account review and dispute workflow</strong></summary><ol>${rrPlan(a).map(step=>`<li>${rrEsc(step)}</li>`).join('')}</ol></details>
 <div class="reader-suggestions"><strong>Possible issues to investigate — not confirmed errors</strong>${hints.map(h=>`<div class="reader-suggestion"><span class="reader-dot"></span><div><b>${rrEsc(h.title)}</b><p>${rrEsc(h.body)}</p></div></div>`).join('')}</div>
 <div class="fk-account-help"><strong>Reference your credit-learning notes</strong>${FK.matches((a.type||'')+' '+(a.status||'')+' '+(a.company||''),2).filter(t=>t.kind==='topic').map(t=>`<p><b>${rrEsc(t.title)}:</b> ${rrEsc(t.text)} <small>${rrEsc(t.steps)}</small></p>`).join('')}<button class="btn sm secondary" data-action="fk-account-record" data-value="${a.id}">Save this review to my private notes</button></div>
 ${a.aiReview?`<div class="ai-inline"><strong>✦ Optional AI interpretation · verify</strong><p>${rrEsc(a.aiReview.explanation)}</p></div>`:''}
 ${a.sourcePages.length?`<div class="ai-sources"><strong>Source screenshots used</strong><div class="row-wrap">${a.sourcePages.map(name=>`<button class="btn sm secondary" data-action="reader-show-source" data-value="${rrEsc(name)}">▤ ${rrEsc(name)}</button>`).join('')}</div></div>`:''}
 ${rrEditableFields(a)}
 <div class="field" style="margin-top:12px"><label>What does your evidence show? (needed to dispute)</label><textarea data-reader-note="${a.id}" rows="3" placeholder="Example: My March statement shows a $200 payment, but Equifax lists that month as late.">${rrEsc(review.note||'')}</textarea></div>
 <div class="field" style="margin-top:12px"><label>What type of reporting error did you verify?</label><select data-reader-issue="${a.id}"><option value="">No confirmed error — education only</option>${ISSUE_OPTS.map(o=>`<option value="${o[0]}" ${review.issue===o[0]?'selected':''}>${rrEsc(o[1])}</option>`).join('')}</select></div>
 <div class="field" style="margin-top:12px"><label>Which bureau(s) actually show this error?</label><div class="row-wrap">${bureaus.filter(([b])=>b!=='Not identified').map(([b])=>`<label class="toggle-line"><input type="checkbox" data-reader-issue-bureau="${a.id}" data-reader-for="${b}" ${review.issueBureaus?.[b]?'checked':''}/><span>${rrEsc(b)}</span></label>`).join('')||'<small>Bureau not confirmed yet — select or correct the bureau before drafting.</small>'}</div></div>
 <label class="toggle-line"><input type="checkbox" data-reader-verified="${a.id}" ${review.verified?'checked':''}/><span><strong>I verified the specific error with records.</strong><small>Only documented claims you approve can enter letters.</small></span></label></section>`;
}
function rrSetStatus(message){reportReader.status=message;const el=document.getElementById('readerProgress');if(el)el.innerHTML=rrEsc(message)+(reportReader.busy?' <button class="btn sm secondary" data-action="reader-cancel">Stop</button>':'')}
async function rrLoadScript(url,globalName){if(window[globalName])return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.crossOrigin='anonymous';script.onload=resolve;script.onerror=()=>reject(new Error('Unable to load the '+globalName+' reader library. Check your internet connection.'));document.head.appendChild(script)});if(!window[globalName])throw Error('Reader library failed to initialize')}
async function rrPDFText(file){
 const pdfjsLib=await import('./pdfjs.js');pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('./pdfjs-worker.js',location.href).href;
 const doc=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true}).promise;
 let text='',scanned=0;
 try{for(let p=1;p<=doc.numPages;p++){
  if(reportReader.cancel)break;rrSetStatus(`Reading ${file.name}: page ${p} of ${doc.numPages}`);
  const page=await doc.getPage(p),content=await page.getTextContent();const lines=new Map();
  for(const part of content.items||[]){if(!part.str?.trim())continue;const y=Math.round((part.transform?.[5]||0)*2)/2,x=part.transform?.[4]||0;if(!lines.has(y))lines.set(y,[]);lines.get(y).push({x,t:part.str})}
  let pageText=[...lines.entries()].sort((a,b)=>b[0]-a[0]).map(([,parts])=>parts.sort((a,b)=>a.x-b.x).map(v=>v.t).join(' ')).join('\n');
  if(pageText.trim().length<100){
   try{const v=page.getViewport({scale:1.7}),cv=document.createElement('canvas');cv.width=Math.round(v.width);cv.height=Math.round(v.height);await page.render({canvasContext:cv.getContext('2d',{alpha:false}),viewport:v}).promise;
    rrQueueCanvas(cv,`${file.name} · page ${p}`);
    const fullPage=await new Promise(resolve=>cv.toBlob(resolve,'image/png'));
    reportReader.ocrSources.push({name:`${file.name} · page ${p}`,blob:fullPage||null});scanned++;
    // On iPhone, OCR runs only if the user taps 'Try local OCR'; do not block the screenshot queue.
    cv.width=cv.height=0;
   }catch(e){reportReader.error=`Could not render scanned PDF page ${p}: ${e.message}`}
  }
  text+=`\n[Page ${p}]\n${pageText}\n`;
  page.cleanup?.();
 }}finally{await doc.destroy()}
 return {text,method:scanned?`PDF extracted · ${scanned} scanned page(s) queued for AI vision`:'PDF text extraction'};
}
// Dispute Desk 2's compact English OCR runs locally without API credits or a CDN.
// It is lazy-loaded only after a user uploads a picture. The incoming image stays in this browser.
async function rrDD2OcrImage(source){
 await rrLoadScript('./dd2-ocr-engine.js','DD2Ocr');
 await rrLoadScript('./dd2-ocr-data.js','DD2OfflineOcrData');
 const O=window.DD2Ocr,D=window.DD2OfflineOcrData;
 if(!O||!D)throw Error('The bundled OCR reader did not load. Re-upload the bundled offline OCR files.');
 if(!O.hasModel())O.loadModel(D.meta,O.b64bytes(D.b64));
 if(!O.hasModel())throw Error('The offline OCR model could not initialize.');
 let img;
 if(source instanceof HTMLCanvasElement)img=source;
 else{
  const blob=source instanceof Blob?source:await fetch(source).then(r=>r.blob());
  if(typeof createImageBitmap==='function'){
   try{img=await createImageBitmap(blob)}catch(_){}
  }
  if(!img){img=await new Promise((resolve,reject)=>{const el=new Image(),u=URL.createObjectURL(blob);el.onload=()=>{URL.revokeObjectURL(u);resolve(el)};el.onerror=()=>{URL.revokeObjectURL(u);reject(Error('iPhone could not decode this image'))};el.src=u})}
 }
 const w0=img.width||img.naturalWidth,h0=img.height||img.naturalHeight;
 if(!w0||!h0)throw Error('The image had no readable dimensions');
 const scale=Math.min(1,2500/Math.max(w0,h0)),w=Math.round(w0*scale),h=Math.round(h0*scale);
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
 if(!ctx)throw Error('The browser cannot read image pixels');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
 if(img.close)img.close();
 let gray=O.lumaFromRGBA(ctx.getImageData(0,0,w,h).data,w,h);
 canvas.width=1;canvas.height=1;
 const result=await O.readGray(gray,w,h,{onProgress:f=>{rrSetStatus('Free offline OCR: '+Math.round(f*100)+'%');},shouldStop:()=>!!reportReader.cancel,minConf:.52});
 gray=null;
 return result.text||'';
}
// OCR is always local. Tesseract is the stronger free engine when its library can load;
// the bundled offline recognizer is a backup when the device is offline.
function rrOCRQuality(text){
 const v=String(text||''),lines=rrLines(v),letters=(v.match(/[a-z]/gi)||[]).length;
 const fields=(v.match(/\b(?:account|balance|credit|payment|status|opened|reported|limit|collection|charged? off|date|past due)\b/gi)||[]).length;
 const numbers=(v.match(/(?:\$\s*\d[\d,.]*|\b\d{2}[\/.-]\d{2}[\/.-]\d{2,4}\b)/g)||[]).length;
 return Math.min(100,Math.round(Math.min(35,letters/8)+Math.min(35,fields*5)+Math.min(20,numbers*4)+Math.min(10,lines.length/2)));
}
async function rrTesseract(blobOrCanvas){
 await rrLoadScript(REPORT_OCR_URL,'Tesseract');
 if(!reportReader.ocrWorker)reportReader.ocrWorker=await Tesseract.createWorker('eng',1,{logger:m=>{
  if(m.status==='recognizing text'&&m.progress!=null)rrSetStatus('Reading small text: '+Math.round(m.progress*100)+'%');
 }});
 const r=await reportReader.ocrWorker.recognize(blobOrCanvas);
 return r.data?.text||'';
}
async function rrOCR(blobOrCanvas){
 let best='',engine='',errors=[];
 // Prefer the standard OCR engine for tiny credit-report fonts. Never send the image to OpenAI.
 try{best=await rrTesseract(blobOrCanvas);engine='Standard local OCR'}catch(e){errors.push('Standard OCR: '+String(e.message||e))}
 const score=txt=>{let valid=[],total=0;try{const parsed=rrParseAccounts(txt,'OCR review','auto');total=parsed.entries.length;valid=parsed.entries.filter(e=>rrCreditorOK(e.company)&&!!rrLast4(e.account)&&rrAccountFields(e)>=1)}catch(_){}const distinct=new Set(valid.map(e=>rrCreditorKey(e.company)+'|'+rrLast4(e.account)));return rrOCRQuality(txt)+Math.min(distinct.size,2)*45+Math.min(valid.length,3)*5-Math.min(40,Math.max(0,total-valid.length)*4)};
 if(score(best)<130){
  try{const alternative=await rrDD2OcrImage(blobOrCanvas);
   if(score(alternative)>score(best)){best=alternative;engine='Bundled offline OCR'}
  }catch(e){errors.push('Bundled OCR: '+String(e.message||e))}
 }
 if(!best.trim()&&errors.length)throw Error(errors.join('. '));
 reportReader.ocrMode=engine||'Local OCR';
 return best;
}
function rrOCRPanel(){
 const r=reportReader;if(!r.ocrPages.length&&!r.ai.images.length)return '';
 return `<section class="card reader-ocr-review" id="reader-ocr-review">
 <div class="eyebrow">FREE SCAN · YOUR DEVICE</div><h3>What the Reader actually recognized</h3>
 <p class="small soft">Review the words below before using any account fields. If the scan is incomplete, correct the text and tap Extract accounts. Nothing is sent to paid AI.</p>
 ${r.ocrPages.map((page,i)=>`<div class="reader-ocr-page"><div class="row-between"><strong>${rrEsc(page.name)}</strong><span class="pill ${rrOCRQuality(page.text)<45?'warn':''}">${page.text.trim()?rrOCRQuality(page.text)>=45?'Text captured · verify':'Weak scan · needs review':'No text captured'}</span></div>
 <p class="small muted">${rrEsc(page.engine||'Local OCR')} · ${page.text.trim().length} characters · ${page.accounts||0} possible account(s)</p>
 <textarea data-reader-ocr-edit="${i}" class="reader-paste" rows="7" spellcheck="false" placeholder="No readable text. Open this image in iPhone Photos, use Live Text to copy the account details, then paste them here.">${rrEsc(page.text)}</textarea>
 <div class="row-wrap"><button class="btn mint sm" data-action="reader-ocr-apply" data-value="${i}">Extract accounts from this text</button><button class="btn secondary sm" data-action="reader-show-source" data-value="${page.index}">View screenshot</button></div></div>`).join('')}
 <div class="row-wrap"><button class="btn secondary" data-action="reader-ocr-retry">Retry free scan</button><button class="btn ghost" data-action="reader-manual-open">＋ Add account by hand</button></div>
 <details class="reader-manual"><summary>Manual account entry (when OCR misses a field)</summary>
 <div class="reader-correct-grid">${[['company','Creditor name'],['account','Account last four'],['balance','Balance'],['status','Status']].map(([key,label])=>`<div class="field"><label>${label}</label><input data-reader-manual="${key}" value="${rrEsc(r.manual[key]||'')}" placeholder="${label}"></div>`).join('')}
 <div class="field"><label>Bureau</label><select data-reader-manual="bureau">${['Not identified',...BUREAUS].map(b=>`<option value="${b}" ${r.manual.bureau===b?'selected':''}>${b}</option>`).join('')}</select></div></div>
 <button class="btn primary" data-action="reader-manual-add">Add for review</button></details></section>`;
}
function rrOCRApply(index){
 const page=reportReader.ocrPages[index];if(!page)return;
 rrOCRApplyNoRender(page);
 reportReader.status=page.accounts?`Read ${page.accounts} raw account observation(s) in ${page.name}; ${reportReader.accounts.length} distinct account(s) across the scan.`:`Text saved for ${page.name}, but no complete account matched. You can correct the text or add an account manually.`;
 render();
}

function rrManualAdd(){const m=reportReader.manual;if(!m.company.trim()||![m.account,m.balance,m.status].some(x=>String(x).trim())){toast('Enter a creditor and at least one actual report field.');return}const a={id:'manual-'+Math.random().toString(36).slice(2,10),company:m.company.trim().slice(0,85),account:rrLast4(m.account),balance:rrNum(m.balance),limit:'',status:m.status.trim().slice(0,125),originalCreditor:'',opened:'',firstMissed:'',lastReported:'',reportDate:'',paymentHistory:'',accountType:'',pastDue:'',type:'Other',bureau:m.bureau,source:'Manual entry · verify',confidence:'Manual',raw:'Account Name: '+m.company+'\nAccount Number: '+m.account+'\nBalance: '+m.balance+'\nStatus: '+m.status};reportReader.manualEntries??=[];reportReader.manualEntries.push(a);rrReconcile();reportReader.manual={company:'',account:'',balance:'',status:'',bureau:'Not identified'};reportReader.status='Manual observation added. It was grouped with any matching account. Confirm every field.';render()}
async function rrProcess(files){
 if(reportReader.busy)return;const list=[...files];if(!list.length)return;
 reportReader.busy=true;reportReader.cancel=false;reportReader.error='';reportReader.importResult='';reportReader.status='Preparing your report for free on-device reading…';render();let completed=0;
 try{for(const file of list){if(reportReader.cancel)break;const name=String(file.name||`Report ${reportReader.extracted.length+1}`);
  if(file.size>40*1024*1024){rrSetStatus(`${name}: this file is over 40 MB; split it into smaller sections.`);continue}
  let out={text:'',method:''};try{
   const type=file.type||'',ext=name.split('.').pop().toLowerCase(),isImage=type.startsWith('image/')||['jpg','jpeg','png','webp','heic'].includes(ext);
   if(type==='application/pdf'||ext==='pdf')out=await rrPDFText(file);
   else if(isImage){rrSetStatus(`Preparing screenshot ${completed+1} of ${list.length} for free OCR…`);await rrAiCaptureImage(file,name);
     out={text:'',method:'Screenshot queued for free OCR'};
   }else if(type.startsWith('text/')||ext==='txt')out={text:await file.text(),method:'Text file'};
   else throw Error('Choose PDF, JPEG, PNG, WebP, or TXT');
   const parsed=rrParseAccounts(out.text,name,reportReader.forcedBureau);
   if(parsed.profile.name&&reportReader.profile.name&&parsed.profile.name.replace(/\W/g,'').toLowerCase()!==reportReader.profile.name.replace(/\W/g,'').toLowerCase())throw Error('This seems to be a different report holder. Clear the session to scan a different person.');
   reportReader.extracted.push({name,bureau:parsed.bureau,entries:parsed.entries,method:out.method,warning:!parsed.entries.length?'Waiting for OCR results; no account details extracted yet.':''});
   rrReconcile();reportReader.profile={...parsed.profile,...reportReader.profile};reportReader.reportText+=`\n===== ${name} =====\n${out.text}\n`;
   completed++;rrSetStatus(`Prepared ${completed} of ${list.length} file(s)`);
  }catch(err){reportReader.extracted.push({name,bureau:'Unknown',entries:[],method:'Could not prepare',warning:String(err.message||err)});reportReader.error=`${name}: ${String(err.message||err)}`}
 }
 reportReader.status=`${completed} file(s) ready. ${reportReader.ai.images.length} screenshot/page preview(s) queued. Free OCR runs automatically after upload; review the recognized text below.`;
 if(!reportReader.ai.payload){const raw=reportReader.reportText.trim();reportReader.ai.payload=rrAiRedact(raw.slice(0,40000))||'[Uploaded screenshot(s) for AI visual review. Extract only what appears on each page.]'}
 }finally{reportReader.busy=false;if(reportReader.ocrWorker){try{await reportReader.ocrWorker.terminate()}catch(_){}reportReader.ocrWorker=null}render();const shouldScan=reportReader.ai.scanAfterUpload;reportReader.ai.scanAfterUpload=false;
 if(reportReader.ai.images.length&&reportReader.freeLastScanCount!==reportReader.ai.images.length){reportReader.freeLastScanCount=reportReader.ai.images.length;await rrOCRRetry()}
 if(shouldScan&&reportReader.ai.accessCode&&reportReader.ai.consent){reportReader.status+=' Paid AI remains optional; tap Read ALL screenshots with AI when you have API credits.';render()}}
}
function rrProcessPaste(){const input=document.getElementById('reportPaste')?.value||reportReader.paste;reportReader.paste=input;if(!input.trim()){toast('Paste account text first');return}if(input.trim().length<35){toast('Paste a longer section that includes account details');return}const name='Pasted report '+(reportReader.extracted.length+1);const p=rrParseAccounts(input,name,reportReader.forcedBureau);if(p.profile.name&&reportReader.profile.name&&p.profile.name.toLowerCase().replace(/\s+/g,' ')!==reportReader.profile.name.toLowerCase().replace(/\s+/g,' ')){toast('Different person detected — Clear session before analyzing their report.');return}reportReader.extracted.push({name,bureau:p.bureau,entries:p.entries,method:'Pasted text'});reportReader.profile={...p.profile,...reportReader.profile};reportReader.reportText+=`\n===== ${name} =====\n${input}\n`;rrReconcile();reportReader.status=`Read pasted text; ${reportReader.accounts.length} distinct account(s) grouped across all sources. Check original values before importing.`;reportReader.paste='';if(!FK.locked)void FK.record('Pasted report text',name,input.slice(0,13000));render()}
function rrDemo(){const sample=`Consumer Name: Alex Morgan\nCurrent Address: 123 Example Street Brooklyn NY 11201\nReport Date: 11/23/2026\nAccount Name: First Lakeshore Card\nAccount Number: XXXX4471\nAccount Status: Current\nBalance: $615.00\nCredit Limit: $2500\nDate Opened: 05/12/2020\nDate Last Reported: 11/10/2026\nAccount Name: Harlow Recovery Services\nAccount Number: XXXX9931\nAccount Status: Collection\nBalance: $842.00\nDate of First Delinquency: 06/03/2023\nDate Last Reported: 11/05/2026`;const p=rrParseAccounts(sample,'Fictional example — Experian','Experian');reportReader.extracted.push({name:'FICTIONAL example (not your data)',bureau:'Experian',entries:p.entries,method:'Demo data'});reportReader.reportText+=sample;reportReader.profile=p.profile;rrReconcile();reportReader.status='Demo grouped into distinct accounts. No real case data was changed.';render()}
function rrStopSpeech(){if('speechSynthesis' in window)window.speechSynthesis.cancel();reportReader.speaking=false;reportReader.speechQueue=[]}
function rrSpeak(text){if(!('speechSynthesis' in window)){toast('Speech is unavailable on this device');return}rrStopSpeech();const clean=rrSanitize(text).replace(/\s+/g,' ').slice(0,30000);if(!clean.trim()){toast('No text to read');return}const chunks=clean.match(/.{1,180}(?:\s|$)/g)||[clean];reportReader.speechQueue=chunks;reportReader.speaking=true;function next(){if(!reportReader.speaking||!reportReader.speechQueue.length){reportReader.speaking=false;return}const u=new SpeechSynthesisUtterance(reportReader.speechQueue.shift());u.rate=reportReader.voiceRate;u.lang='en-US';u.onend=next;u.onerror=()=>{reportReader.speaking=false;toast('Speech ended; tap Listen to retry')};window.speechSynthesis.speak(u)}next();toast('Reading aloud · use Stop voice to finish')}
function rrImport(openLetters=false){
 const s=reportReader,chosen=s.accounts.filter(a=>s.selected.has(a.id));
 if(!chosen.length){toast('Select at least one distinct account to import');return false}
 if(!document.getElementById('readerImportConfirm')?.checked){toast('Confirm that you reviewed the original screenshots first');return false}
 const target=document.getElementById('readerTarget')?.value||'new';let c=target==='current'?activeClient():null;
 if(c&&s.profile.name&&c.name&&s.profile.name.toLowerCase().replace(/\s+/g,' ')!==c.name.toLowerCase().replace(/\s+/g,' ')&&!document.getElementById('readerOtherNameConfirm')?.checked){toast('Different person detected; review the report holder before importing');return false}
 if(!c){c=newClient('');state.clients.push(c);state.activeId=c.id}
 if(document.getElementById('readerProfileConfirm')?.checked)for(const k of ['name','address','city','state','zip'])if(!c[k]&&s.profile[k])c[k]=s.profile[k];
 let added=0,updated=0,issues=0;
 for(const a of chosen){
  const found=a.account?c.items.find(x=>x.account===a.account&&rrSameCreditor(x.collector||x.originalCreditor,a.company)):null;
  const blank=c.items.find(x=>!x.collector&&!x.originalCreditor&&!x.account&&!x.balance&&!x.notes);
  const item=found||blank||newItem();if(!found&&!blank)c.items.push(item);
  if(!found){item.type=a.type;item.collector=a.company;item.originalCreditor=a.originalCreditor||'';item.account=a.account;item.balance=a.balance;item.status=a.status||a.accountType;item.reportDate=a.reportDate||'';item.firstMissed=a.firstMissed||'';item.statusDate=a.lastReported||'';item.bureaus=[];added++}else updated++;
  item.bureauReports??={};item.bureauDisputes??={};item.issues??=[];item.notes??='';item.reviewed??={};
  for(const [bureau,source] of Object.entries(a.bureauReports||{})){
   if(!BUREAUS.includes(bureau))continue;
   const snap={bureau,company:a.company,account:a.account,balance:source.balance||'',creditLimit:source.limit||'',pastDue:source.pastDue||'',status:source.status||'',accountType:source.accountType||'',opened:source.opened||'',firstDelinquency:source.firstMissed||'',lastReported:source.lastReported||'',reportDate:source.reportDate||'',paymentHistory:source.paymentHistory||'',sourcePages:source.sourcePages||[],reviewedAt:new Date().toISOString()};
   item.bureauReports[bureau]=snap;item.bureaus=[...new Set([...item.bureaus,bureau])];
  }
  const rev=s.review[a.id]||{},note=(rev.note||'').trim();
  if(rev.issue&&rev.verified&&note.length>=12){
   const targeted=Object.keys(rev.issueBureaus||{}).filter(b=>rev.issueBureaus[b]&&BUREAUS.includes(b)&&item.bureaus.includes(b));
   for(const bureau of targeted){item.bureauDisputes[bureau]={issues:[rev.issue],why:rrSanitize(note),correctBalance:''};issues++}
   if(targeted.length===1&&item.bureaus.length===1){item.issues=[...new Set([...item.issues,rev.issue])];if(['date','late','duplicate','personal','inquiry'].includes(rev.issue))item.dateExplanation=rrSanitize(note);else item.why=rrSanitize(note)}
  }
  const digest=`Reviewed report ${a.company} ••••${a.account||'not shown'}; sources: ${a.sourcePages.join(', ')}; bureaus: ${Object.keys(a.bureauReports||{}).join(', ')}. ${note?'Client-supplied account evidence: '+rrSanitize(note):''}`;
  if(!item.notes.includes(digest))item.notes+=(item.notes?'\n':'')+digest;
  item.reviewed={};c.activeItemId=item.id;
 }
 signature=null;persist();s.importResult=`Imported ${added} distinct account(s), updated ${updated} existing account(s), preserved bureau-specific readings, and prepared ${issues} evidence-confirmed dispute instruction(s). Open Letters to finish drafts and check your identity/address.`;
 if(!FK.locked)void FK.record('Case import',clientLabel(c),JSON.stringify({accountCount:chosen.length,verifiedBureauIssues:issues,source:'Reviewed and corrected report fields',date:new Date().toISOString()}));
 if(openLetters){state.tab='letters';state.letter='bureau';state.bureau=chosen.flatMap(a=>Object.keys(a.bureauReports||{})).find(b=>BUREAUS.includes(b))||'Experian';}
 render();toast(issues?'Case and verified bureau-specific letter fields prepared':'Account fields imported; verify any inaccuracy before drafting');return true;
}
async function rrOCRRetry(force=false){
 const a=reportReader.ai;if(!a.images.length){toast('Upload a screenshot first');return}
 if(reportReader.busy)return;
 if(force)reportReader.ocrCompleted=new Set();
 reportReader.busy=true;reportReader.cancel=false;reportReader.error='';render();
 try{for(let i=0;i<a.images.length;i++){
  if(reportReader.cancel)break;
  const image=a.images[i],key=i+'|'+image.name+'|'+image.data.length;
  if(reportReader.ocrCompleted.has(key))continue;
  rrSetStatus(`Reading screenshot ${i+1} of ${a.images.length} locally…`);
  let txt='',engine='';
  try{txt=await rrOCR(reportReader.ocrSources[i]?.blob||image.data);engine=reportReader.ocrMode;}
  catch(e){reportReader.error=`${image.name}: ${String(e.message||e)}`;}
  let page=reportReader.ocrPages.find(x=>x.index===i);
  if(!page){page={index:i,key:i+'|'+image.name,name:image.name,text:'',engine:'',accounts:0,block:''};reportReader.ocrPages.push(page)}
  if(txt.trim()||!page.text.trim()){page.text=txt;page.engine=engine||'OCR unavailable'}
  if(txt.trim())reportReader.ocrCompleted.add(key);
  rrOCRApplyNoRender(page);
  if(txt.trim()&&!FK.locked)await FK.record('OCR transcript',image.name,txt.slice(0,13000));
 }
 reportReader.status=reportReader.accounts.length?`Free scan complete: ${reportReader.accounts.length} distinct account(s) grouped across ${reportReader.extracted.length} file(s). Compare each bureau and check the proposed repair steps.`:
  'Free scan finished without a complete account. Open the OCR text above and correct it, or use Photos → Live Text → Copy and paste it. The Reader will not invent missing fields.';
 }finally{reportReader.busy=false;if(reportReader.ocrWorker){try{await reportReader.ocrWorker.terminate()}catch(_){}reportReader.ocrWorker=null}render()}
}
function rrOCRApplyNoRender(page){
 const parsed=rrParseAccounts(page.text,page.name,reportReader.forcedBureau);
 if(parsed.profile.name&&reportReader.profile.name&&parsed.profile.name.replace(/\W/g,'').toLowerCase()!==reportReader.profile.name.replace(/\W/g,'').toLowerCase()){reportReader.error='Different report holder detected; do not combine these pages.';return}
 const old=reportReader.extracted.find(x=>x.name===page.name);
 for(const item of parsed.entries){item.ocrPage=page.key||page.name;item.source=page.name}
 if(old){old.entries=parsed.entries;old.bureau=parsed.bureau;old.method=page.engine||'Free OCR';old.warning=parsed.entries.length?'':'Account not reliably identified; edit text before proceeding.';}
 else reportReader.extracted.push({name:page.name,entries:parsed.entries,bureau:parsed.bureau,method:page.engine||'Free OCR'});
 page.accounts=parsed.entries.length;
 if(parsed.profile.name&&!reportReader.profile.name)reportReader.profile=parsed.profile;
 const block=`\n=== ${page.name} (OCR) ===\n${page.text}\n`;
 if(page.block)reportReader.reportText=reportReader.reportText.replace(page.block,block);else reportReader.reportText+=block;
 page.block=block;
 rrReconcile();
}
async function readerClick(action,val,el){const r=reportReader;if(action.startsWith('fk-'))return FK.click(action,val);switch(action){case 'reader-show-source':{const index=/^\d+$/.test(String(val))?Number(val):r.ai.images.findIndex(im=>im.name===val);const page=r.ai.images[index];const original=r.ocrSources[index]?.blob;const url=original?URL.createObjectURL(original):page?.data;if(page)openModal(`<div class="modal-panel"><div class="modal-head"><h2>Uploaded page preview</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div><p class="small muted">${rrEsc(page.name)} · optimized image; compare with the original before approving</p><img src="${rrEsc(url)}" alt="Original report screenshot" style="display:block;width:100%;max-height:70dvh;object-fit:contain;background:white;border-radius:12px"></div>`);else toast('Source screenshot is no longer in memory');if(original)setTimeout(()=>URL.revokeObjectURL(url),120000);break;}
case 'reader-knowledge-open':document.getElementById('knowledge-vault')?.scrollIntoView({behavior:'smooth',block:'start'});break;case 'reader-ai-prepare':rrAiPrepare();break;case 'reader-ai-analyze':await rrAiRun('analyze');break;case 'reader-ai-test-connection':await rrAiConnectivityTest(false);break;case 'reader-ai-test-model':await rrAiConnectivityTest(true);break;case 'reader-ai-pick':r.ai.scanAfterUpload=true;document.getElementById('reportUpload')?.click();break;case 'reader-ai-ask':await rrAiRun('ask');break;case 'reader-ai-import':rrAiReviewImport();break;case 'reader-ai-autofill':rrAiFastAutofill();break;case 'reader-ocr-only':await rrOCRRetry(true);break;case 'reader-ocr-retry':await rrOCRRetry(true);break;case 'reader-ocr-apply':rrOCRApply(Number(val));break;case 'reader-manual-open':document.querySelector('.reader-manual')?.setAttribute('open','');document.querySelector('.reader-manual')?.scrollIntoView({behavior:'smooth',block:'center'});break;case 'reader-manual-add':rrManualAdd();break;case 'reader-ai-read-answer':if(r.ai.answer)rrSpeak(r.ai.answer);break;case 'reader-ai-read-review':if(r.ai.result)rrSpeak(r.ai.result.summary+' '+r.ai.result.accounts.map(x=>x.explanation+' '+x.suggestedPath).join(' '));break;case 'reader-ai-clear':r.ai.result=null;r.ai.answer='';r.ai.error='';r.ai.images=[];r.ai.payload='';render();break;case 'reader-pick':document.getElementById('reportUpload')?.click();break;case 'reader-demo':rrDemo();break;case 'reader-paste-run':rrProcessPaste();break;case 'reader-clear':if(!confirm('Clear extracted report text and review notes from this session? Existing saved cases will remain unchanged.'))return;rrStopSpeech();r.files=[];r.extracted=[];r.accounts=[];r.manualEntries=[];r.aiEntries=[];r.uncertainCount=0;r.reportText='';r.ai.images=[];r.ai.payload='';r.ai.result=null;r.ai.answer='';r.ai.error='';r.paste='';r.profile={};r.ocrCompleted=new Set();r.ocrSources=[];r.ocrPages=[];r.manual={company:'',account:'',balance:'',status:'',bureau:'Not identified'};r.freeLastScanCount=0;r.selected=new Set();r.review={};r.status='Session cleared.';r.importResult='';render();break;case 'reader-cancel':r.cancel=true;rrSetStatus('Stopping after the current page or image…');break;case 'reader-speak-summary':rrSpeak(rrSummary());break;case 'reader-speak-all':rrSpeak(rrSummary()+' '+r.accounts.map(a=>a.aiReview?.explanation||rrExplain(a)+' '+rrHeuristic(a,r.accounts).map(x=>x.title+': '+x.body).join('. ')).join(' '));break;case 'reader-speak-item':{const a=r.accounts.find(x=>x.id===val);if(a)rrSpeak(a.aiReview?.explanation?a.aiReview.explanation+' '+a.aiReview.suggestedPath:rrExplain(a)+' '+rrHeuristic(a,r.accounts).map(x=>x.title+': '+x.body).join('. '));break}case 'reader-speak-raw':rrSpeak(r.reportText);break;case 'reader-stop-speech':rrStopSpeech();toast('Voice stopped');break;case 'reader-refresh':render();toast('Explanations updated from your corrections');break;case 'reader-import':rrImport();break;case 'reader-import-letters':rrImport(true);break;}}
function readerInput(el){if(FK.input(el))return true;if(el.dataset.readerOcrEdit!==undefined){const page=reportReader.ocrPages[Number(el.dataset.readerOcrEdit)];if(page)page.text=el.value;return true}if(el.dataset.readerManual){reportReader.manual[el.dataset.readerManual]=el.value;return true}if(el.id==='readerAiEndpoint'){reportReader.ai.endpoint=el.value;return true}if(el.id==='readerAiCode'){reportReader.ai.accessCode=el.value;return true}if(el.id==='readerAiPayload'){reportReader.ai.payload=el.value;return true}if(el.id==='readerAiQuestion'){reportReader.ai.question=el.value;return true}if(el.id==='reportPaste'){reportReader.paste=el.value;return true}if(el.dataset.readerNote){reportReader.review[el.dataset.readerNote]??={};reportReader.review[el.dataset.readerNote].note=el.value;return true}return false}
function readerChange(el){if(el.dataset.readerManual){reportReader.manual[el.dataset.readerManual]=el.value;return true}if(el.id==='fkFile'){void FK.change(el);return true}if(el.id==='readerAiConsent'){reportReader.ai.consent=el.checked;return true}if(el.id==='readerAiImages'){reportReader.ai.includeImages=el.checked;return true}if(el.id==='readerVoiceSpeed'){reportReader.voiceRate=Number(el.value)||0.92;return true}if(el.dataset.readerEdit){const account=reportReader.accounts.find(a=>a.id===el.dataset.readerEdit);const key=el.dataset.readerKey;if(!account||!['company','account','balance','limit','status','originalCreditor','firstMissed','lastReported','bureau','type'].includes(key))return true;let val=el.value.trim();if(key==='account')val=rrLast4(val);if(['balance','limit'].includes(key))val=val===''?'':rrNum(val);if(['firstMissed','lastReported'].includes(key)&&val&&!/^\d{4}-\d{2}-\d{2}$/.test(val)){toast('Use YYYY-MM-DD for dates');return true}account[key]=val.slice(0,140);account.corrected=true;if(Object.keys(account.bureauReports||{}).length===1){const one=Object.values(account.bureauReports)[0];if(one&&Object.hasOwn(one,key))one[key]=account[key]}return true}if(el.id==='reportUpload'){const fs=[...el.files||[]];el.value='';void rrProcess(fs);return true}if(el.dataset.readerSelect){if(el.checked)reportReader.selected.add(el.dataset.readerSelect);else reportReader.selected.delete(el.dataset.readerSelect);const indicator=document.querySelector('.reader-review .btn.mint');if(indicator)indicator.textContent=`Import ${reportReader.selected.size} ${reportReader.selected.size===1?'entry':'entries'} into case →`;return true}if(el.dataset.readerIssueBureau){const v=reportReader.review[el.dataset.readerIssueBureau]??={};v.issueBureaus??={};v.issueBureaus[el.dataset.readerFor]=el.checked;return true}if(el.dataset.readerIssue){reportReader.review[el.dataset.readerIssue]??={};reportReader.review[el.dataset.readerIssue].issue=el.value;return true}if(el.dataset.readerVerified){reportReader.review[el.dataset.readerVerified]??={};reportReader.review[el.dataset.readerVerified].verified=el.checked;return true}if(el.dataset.readerBureau){reportReader.forcedBureau=el.value;return true}return false}
