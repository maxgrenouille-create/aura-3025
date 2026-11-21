const $=id=>document.getElementById(id);
const MODAL=$('settingsModal');
const STORAGE='aura_preview_last_exchange_v2';
let listening=false;
let recognition=null;
let activeAudio=null;

function stopSpeaking(){
  const audio=activeAudio;
  activeAudio=null;
  if(audio)audio.pause();
  if(activeUtterance){activeUtterance=null;try{window.speechSynthesis?.cancel();}catch{}}
  $('playVoice').hidden=true;
  $('playVoice').onclick=null;
  auraAvatar.stop();
  setStatus('IN ATTESA DI UNA DOMANDA');
}

function setStatus(message){$('stageStatus').textContent=message;}
function setHint(message){$('hint').textContent=message;}
function render(text,actions=[],follow=[]){
  $('reply').textContent=text;
  const box=$('actionArea');box.replaceChildren();box.hidden=!actions.length&&!follow.length;
  for(const action of actions){const link=document.createElement('a');link.className='action-link';link.href=action.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=action.label;box.append(link);}
  if(follow.length){const row=document.createElement('div');row.className='follow-row';
    for(const q of follow){const b=document.createElement('button');b.type='button';b.className='follow-chip';b.textContent=q;b.onclick=()=>ask(q);row.append(b);}
    box.append(row);}
  try{sessionStorage.setItem(STORAGE,JSON.stringify({text,actions,follow}));}catch{}
}

// ---------- Cervello di AURA: base di conoscenze + memoria ----------
const MEM_KEY='aura3025_memory_v1';
const memory=(()=>{try{return JSON.parse(localStorage.getItem(MEM_KEY)||'{}');}catch{return {};}})();
memory.history=memory.history||[];
function saveMemory(){try{localStorage.setItem(MEM_KEY,JSON.stringify(memory));}catch{}}
const norm=t=>(' '+t.toLocaleLowerCase('it-IT').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’'`]/g,' ').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()+' ');
const KB=(typeof AURA_KB!=='undefined'?AURA_KB:[]).map(e=>({...e,nkeys:e.keys.map(k=>norm(k).trim())}));
const GENERIC=new Set(['mascagni','pietro','cavalleria','rusticana','opere','vita','aura','chi era','storia','compositore','di cosa parla','trama','fine','finale','debutto','successo','famos','prima volta','ciao','buongiorno','buonasera','salve','hey','ehi']);
// ---- comprensione tollerante: parole simili, spezzate o attaccate ----
const FILLERS=[' ti ho chiesto',' ti chiedo',' volevo sapere',' vorrei sapere',' mi sai dire',' sai dirmi',' mi dici',' dimmi',' senti',' scusa',' scusami',' per favore',' allora',' ehm',' aura',' allora aura',' ciao aura',' mi piacerebbe sapere',' potresti dirmi',' puoi dirmi',' mi parli',' parlami un po',' un po'];
function clean_q(q){let r=q;for(const f of FILLERS){if(r.startsWith(f+' ')||r.includes(f+' ')){const t=r.replace(f+' ',' ');if(t.trim().length>=3)r=t;}}return r.replace(/\s+/g,' ');}
function lev(a,b,max){
  if(Math.abs(a.length-b.length)>max)return max+1;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const cur=[i];let rowMin=i;
    for(let j=1;j<=b.length;j++){cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(cur[j]<rowMin)rowMin=cur[j];}
    if(rowMin>max)return max+1;prev=cur;}
  return prev[b.length];
}
function candidates(q){
  const t=q.trim().split(' ').filter(Boolean),c=t.map(x=>({t:x,j:false}));
  for(let i=0;i<t.length;i++){if(t[i+1])c.push({t:t[i]+t[i+1],j:true});if(t[i+2])c.push({t:t[i]+t[i+1]+t[i+2],j:true});}
  return c;
}
function fuzzyHas(cands,k){
  if(k.includes(' ')||k.length<5)return false;            // tolleranza solo sulle parole singole
  const max=k.length>=7?2:1;
  for(const c of cands){
    if(c.t.length<4)continue;
    if(c.j&&k.length<7)continue;                          // parole unite: solo per nomi lunghi (pino tta → pinotta)
    if(lev(c.t,k,max)<=max)return true;
  }
  return false;
}
function kbScore(text){const q=clean_q(norm(text));const cands=candidates(q);let b=0;
  for(const e of KB){let sc=0;for(const k of e.nkeys){if(!k)continue;const w=GENERIC.has(k)?k.length/3:k.length+4;if(q.includes(' '+k))sc+=w;else if(fuzzyHas(cands,k))sc+=w*.85;}if(sc>b)b=sc;}
  return b;}
window.kbScore=kbScore;
const STOP=new Set('che chi cosa come dove quando quale quali quanto quanti perche per con del della dei delle degli dal dalla nel nella nei sul sulla una uno gli le lo la il di da in su tra fra non piu mi ti si ci vi sei sono era erano e ha hanno ho hai abbiamo mio mia tuo tua suo sua loro questo questa quello quella parlami dimmi raccontami sai conosci puoi vorrei sapere anche ancora molto poco tutto tutti cos fatto fare essere stato stata opera opere mascagni pietro aura'.split(' '));
for(const e of KB)e.ntext=norm(e.text+' '+e.keys.join(' '));
const IDF={};{const df={};for(const e of KB){const seen=new Set(e.ntext.trim().split(' ').map(w=>w.length>5?w.slice(0,w.length-2):w));for(const w of seen)df[w]=(df[w]||0)+1;}
  for(const w in df)IDF[w]=Math.log(1+KB.length/df[w]);}
const TOPIC_NAMES={mascagni:'della vita di Mascagni',opere:'delle sue opere',cavalleria:'di Cavalleria rusticana',festival:'del Festival',aura:'di me',livorno:'di Livorno',opera:'dell\u2019opera',curiosita:'di qualche curiosità'};
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);

function demoAnswer(question){
  const q=clean_q(norm(question));
  // memoria: nome
  const named=question.match(/(?:mi chiamo|il mio nome (?:è|e)|chiamami)\s+([A-Za-zÀ-ÿ'’]+)/i);
  if(named){memory.name=cap(named[1].toLowerCase());saveMemory();
    return {voice:'nome',text:`Piacere, ${memory.name}. Me lo ricorderò: noi macchine dimentichiamo poco. Che cosa vuoi sapere di Mascagni?`,actions:[],follow:['Chi era Mascagni?','Di cosa parla Cavalleria rusticana?']};}
  if(/ come mi chiamo | sai chi sono | ti ricordi (di )?me | il mio nome /.test(q))
    return {voice:'nome',text:memory.name?`Certo: sei ${memory.name}. Non ti avrei dimenticato.`:'Non me l’hai ancora detto. Come ti chiami?',actions:[],follow:[]};
  if(/ (di )?cosa abbiamo parlato | ti ricordi | ricordi cosa | l ultima volta /.test(q)){
    const topics=[...new Set(memory.history.map(h=>h.topic).filter(t=>TOPIC_NAMES[t]))].slice(-4).map(t=>TOPIC_NAMES[t]);
    return {voice:'ricordo',text:topics.length?`Ricordo bene: abbiamo parlato ${topics.join(', ').replace(/, ([^,]*)$/,' e $1')}. Vuoi riprendere da lì?`:'Per ora non abbiamo ancora parlato di nulla. Cominciamo?',actions:[],follow:['Chi era Mascagni?','Raccontami una curiosità']};
  }
  // ricerca nella base di conoscenze
  const aboutMe=/ (sei|tu|ti|tuo|tua|te) /.test(q);
  const last=memory.history.at(-1)?.topic;
  let best=null,bestScore=0;
  const cands=candidates(q);
  for(const e of KB){
    let score=0;
    for(const k of e.nkeys){
      if(!k)continue;
      const w=GENERIC.has(k)?k.length/3:k.length+4;
      if(q.includes(' '+k)){score+=w;continue;}
      if(fuzzyHas(cands,k))score+=w*.85;              // parola trascritta male ma riconoscibile
    }
    if(!score)continue;
    if(aboutMe&&e.topic==='aura')score+=4;
    if(e.topic===last)score+=2;
    if(score>bestScore){best=e;bestScore=score;}
  }
  if((!best||bestScore<4)&&!/^ (conosci|sai chi e|chi e|chi era|hai mai sentito) /.test(q)){
    const words=q.trim().split(' ').filter(w=>w.length>2&&!STOP.has(w));
    let tb=null,ts=0;
    for(const e of KB){
      let sc=0;
      for(const w of words){const st=w.length>5?w.slice(0,w.length-2):w;if(e.ntext.includes(' '+st))sc+=IDF[st]??1;}
      if(e.topic===last)sc+=.3;
      if(sc>ts){tb=e;ts=sc;}
    }
    if(tb&&ts>=2.2){best=tb;bestScore=4;}
  }
  let text,id,topic,actions=[],follow=[];
  if(best&&bestScore>=4){
    ({text,id,topic}=best);actions=best.actions||[];follow=best.follow||[];
    if(best.texts&&best.texts.length){memory.rot=memory.rot||{};const n=(memory.rot[id]||0)%best.texts.length;text=best.texts[n];memory.rot[id]=n+1;}
    if(memory.name&&['saluto','grazie','ciao'].includes(id))text=`${memory.name}, `+text.charAt(0).toLowerCase()+text.slice(1);
    if(memory.history.at(-1)?.q===q&&id!=='curiosita2'&&!best.texts)text='Te l’ho appena detto, ma lo ripeto volentieri: '+text.charAt(0).toLowerCase()+text.slice(1);
  }else if(/^ (conosci|sai chi e|chi e|chi era|hai mai sentito) /.test(q)){
    const who=question.replace(/^\s*(conosci|sai chi è|sai chi e|chi è|chi e|chi era|hai mai sentito parlare di|hai mai sentito)\s*/i,'').replace(/[?!.]+$/,'').trim();
    id='persona';topic=last;
    text=`${who?who.charAt(0).toUpperCase()+who.slice(1):'Questa persona'}? Non ho ancora una scheda su di lui o su di lei, e non voglio inventare nulla. Conosco bene Pietro Mascagni, i personaggi delle sue opere, Marco Voleri e chi mi ha creato.`;
    follow=['Chi era Mascagni?','Conosci Marco Voleri?','Chi ti ha creato?'];
  }else{
    id='generica';topic=last;
    text='Su questo non ho ancora una risposta preparata, e preferisco tacere piuttosto che inventare. Posso però raccontarti di Pietro Mascagni, delle sue opere, di Cavalleria rusticana e del Festival.';
    follow=['Chi era Mascagni?','Di cosa parla Cavalleria rusticana?','Raccontami una curiosità'];
  }
  memory.history.push({id,topic,q,t:Date.now()});memory.history=memory.history.slice(-30);saveMemory();
  return {voice:id,text,actions,follow};
}

// ---------- Voce del dispositivo (gratuita, nessun file audio) ----------
const synth=window.speechSynthesis||null;
const VOICE_KEY='aura_voice_name';
let activeUtterance=null;
function italianVoices(){return synth?synth.getVoices().filter(v=>/^it([-_]|$)/i.test(v.lang)):[];}
function voiceScore(v){
  const n=v.name.toLowerCase();let s=0;
  if(/premium/.test(n))s+=6;if(/enhanced|avanzat|migliorat/.test(n))s+=5;
  if(/natural|neural|online/.test(n))s+=5;if(/siri/.test(n))s+=4;if(/google/.test(n))s+=3;
  if(/luca|diego|cosimo|giorgio|paolo|giuseppe|marco|benigno|calogero|gianni|lorenzo|rinaldo|\bmale|maschil|itc|itd/.test(n))s+=12;
  if(/alice|federica|paola|elsa|isabella|emma|carla|carlotta|fiamma|irene|imelda|palmira|pierina|giorgia|chiara|female|femminil/.test(n))s-=6;
  if(/reed|eddy|rocko|grandpa|nonno|shelley|sandy|flo|grandma|nonna|bubbles|bells|bad news|good news|albert|zarvox|whisper|cellos|organ|trinoids|wobble|jester|superstar|boing|bahh/.test(n))s-=20;
  if(v.localService===false)s+=1;
  return s;
}
function isMale(v){return !!v&&/luca|diego|cosimo|giorgio|paolo|giuseppe|marco|benigno|calogero|gianni|lorenzo|rinaldo|\bmale|maschil|itc|itd/i.test(v.name);}
function chosenVoice(){
  const list=italianVoices();if(!list.length)return null;
  let saved=null;try{saved=localStorage.getItem(VOICE_KEY);}catch{}
  return list.find(v=>v.name===saved)||[...list].sort((a,b)=>voiceScore(b)-voiceScore(a))[0];
}
function fillVoiceSelect(){
  const sel=$('voiceSelect');if(!sel)return;
  const list=[...italianVoices()].sort((a,b)=>voiceScore(b)-voiceScore(a)).filter(v=>voiceScore(v)>-10);
  const current=chosenVoice();
  sel.innerHTML='';
  if(!list.length){sel.innerHTML='<option>Nessuna voce italiana su questo dispositivo</option>';sel.disabled=true;return;}
  sel.disabled=false;
  for(const v of list){const o=document.createElement('option');o.value=v.name;o.textContent=v.name.replace(/\s*\(.*?\)\s*/g,' ').trim()+(isMale(v)?' · maschile':'');if(current&&v.name===current.name)o.selected=true;sel.append(o);}
}
if(synth){fillVoiceSelect();synth.addEventListener?.('voiceschanged',fillVoiceSelect);}

let voiceUnlocked=false;
function audioDuplex(){try{if(navigator.audioSession){if(navigator.audioSession.type!=='play-and-record')navigator.audioSession.type='play-and-record';dbg('audio: sessione '+navigator.audioSession.type+' stato '+navigator.audioSession.state);}else dbg('audio: audioSession non disponibile');}catch(e){dbg('audio: errore '+e.message);}}
let soundSeen=false,muteGuard=null,muteRetry=0;
function unlockVoice(after){audioDuplex();
  // Al prossimo tocco sullo schermo la voce si sblocca e (se serve) riparte.
  const go=()=>{document.removeEventListener('pointerup',go,true);voiceUnlocked=true;after&&after();};
  document.addEventListener('pointerup',go,true);
}
function clean(text){return text.replace(/…/g,', ').replace(/’/g,"'").replace(/\s+/g,' ').trim();}

function speak(_voice,text,retry=false){
  stopSpeaking();
  if(!$('voiceToggle').checked||!text)return;
  if(!synth){setHint('Questo browser non ha una voce di sintesi: leggi la risposta qui sopra.');return;}
  const u=new SpeechSynthesisUtterance(clean(text));
  const v=chosenVoice();if(v)u.voice=v;
  u.lang=v?.lang||'it-IT';u.rate=0.97;u.pitch=isMale(v)?0.92:0.72;u.volume=1;
  activeUtterance=u;
  let started=false;
  u.onstart=()=>{dbg('voce: inizia');if(activeUtterance!==u)return;started=true;auraAvatar.speakLive();setStatus('AURA STA PARLANDO');};
  u.onboundary=e=>{
    if(activeUtterance!==u||e.name&&e.name!=='word')return;
    const rest=u.text.slice(e.charIndex);const word=(rest.match(/^\S+/)||[''])[0];
    auraAvatar.liveWord(word);
  };
  const finish=()=>{if(activeUtterance===u)stopSpeaking();};
  u.onend=()=>{dbg('voce: finita');const mine=activeUtterance===u;finish();if(mine&&_voice!=='ciao')setTimeout(()=>window.auraRearm&&window.auraRearm(),450);};
  u.onerror=e=>{if(activeUtterance!==u)return;finish();if(e.error!=='interrupted'&&e.error!=='canceled')setHint('Voce non disponibile. Puoi leggere la risposta qui sopra.');};
  setStatus('AURA STA PER PARLARE');
  synth.speak(u);
  // Alcuni telefoni bloccano la voce se non parte da un tocco: offro il pulsante.
  setTimeout(()=>{
    if(activeUtterance!==u||started)return;
    synth.cancel();activeUtterance=null;
    if(!retry){speak(_voice,text,true);return;}
    setStatus('IN ATTESA DI UNA DOMANDA');
    unlockVoice(()=>speak(_voice,text,true));
  },2500);
}

function ask(question){
  const text=question.trim();if(!text)return;
  const asked=$('youAsked');if(asked){asked.textContent='Hai chiesto: «'+text+'»';asked.hidden=false;}
  const result=demoAnswer(text);
  render(result.text,result.actions,result.follow);
  setHint('Domanda ricevuta · puoi parlare ancora oppure scrivere');
  speak(result.voice,result.text);
  $('question').value='';
  if(result.voice==='ciao'){window.auraEndDialog&&window.auraEndDialog();farewellWhenDone();}
  else if(!$('voiceToggle').checked||!window.speechSynthesis)setTimeout(()=>window.auraRearm&&window.auraRearm(),900);
}
function farewellWhenDone(){
  const t0=Date.now();
  (function wait(){
    const talking=!!activeUtterance;
    if((talking||Date.now()-t0<2600)&&Date.now()-t0<20000){setTimeout(wait,300);return;}
    setTimeout(()=>window.auraOutro&&window.auraOutro(),500);
  })();
}

$('textForm').addEventListener('submit',event=>{event.preventDefault();ask($('question').value);});

const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
// ---------- Microfono: si spegne del tutto prima che AURA parli e si riaccende dopo ----------
// Su iPhone, se il microfono resta acceso mentre AURA risponde, la domanda successiva non viene più trascritta.
let rec=null,recRunning=false,armed=false,heardText='',armTimer=0,silenceTimer=0,dialog=false,startGuard=0;
const DEBUG=location.hash.includes('debug');
let dbgBox=null;
function dbg(msg){
  if(!DEBUG)return;
  if(!dbgBox){dbgBox=document.createElement('pre');dbgBox.style.cssText='position:fixed;left:6px;right:6px;top:6px;max-height:18vh;opacity:.85;pointer-events:none;overflow:auto;z-index:99;background:#000d;color:#9f9;font:11px/1.35 monospace;padding:8px;border-radius:8px;margin:0;white-space:pre-wrap';document.body.append(dbgBox);}
  const t=new Date();dbgBox.textContent=`${t.getMinutes()}:${String(t.getSeconds()).padStart(2,'0')}.${String(t.getMilliseconds()).padStart(3,'0').slice(0,1)} ${msg}\n`+dbgBox.textContent;
}
window.dbg=dbg;
function micUI(on){
  $('mic').classList.toggle('listening',on);
  if(on){setStatus('TI STO ASCOLTANDO');setHint(dialog?'Modalità dialogo: parla quando vuoi · tocca il microfono per fermare':'Parla ora…');}
  else if(['TI STO ASCOLTANDO','UN ISTANTE…'].includes($('stageStatus').textContent))setStatus('IN ATTESA DI UNA DOMANDA');
}
function hardStop(){if(rec){try{rec.abort();}catch{}}}           // spegne davvero il microfono
function sendHeard(){
  clearTimeout(armTimer);clearTimeout(silenceTimer);
  const h=heardText.trim();heardText='';armed=false;micUI(false);
  hardStop();
  if(h)setTimeout(()=>ask(h),350);                               // AURA risponde a microfono spento
}
function ensureRec(){
  if(!SpeechRecognition)return null;
  if(rec){const old=rec;try{old.onresult=old.onerror=old.onend=old.onstart=null;old.abort();}catch{}}
  rec=new SpeechRecognition();
  rec.lang='it-IT';rec.continuous=!IS_IOS;rec.interimResults=true;rec.maxAlternatives=1;   // su iPhone la modalità continua blocca le domande successive
  rec.onstart=()=>{dbg('mic: avviato');recRunning=true;clearTimeout(startGuard);if(armed)micUI(true);
    clearTimeout(armTimer);armTimer=setTimeout(()=>{if(armed&&!heardText)endDialog('Conversazione in pausa: tocca il microfono per riprendere.');},20000);};
  rec.onaudiostart=()=>{dbg('mic: audio aperto');clearTimeout(muteGuard);muteGuard=setTimeout(()=>{if(armed&&!soundSeen&&!heardText&&muteRetry<1){muteRetry++;dbg('mic: muto da 4 s, lo riavvio');try{speechSynthesis.cancel();}catch{}audioDuplex();hardStop();setTimeout(()=>{if(armed){ensureRec();try{rec.start();dbg('mic: riavviato');}catch(e){dbg('mic: riavvio fallito '+e.message);micAttention();}}},300);}},4000);};rec.onsoundstart=()=>{soundSeen=true;clearTimeout(muteGuard);dbg('mic: sente suoni');};rec.onspeechstart=()=>dbg('mic: sente parlare');
  rec.onaudioend=()=>dbg('mic: audio chiuso');rec.onnomatch=()=>dbg('mic: nessuna corrispondenza');
  rec.onresult=e=>{
    dbg('mic: risultato «'+[...e.results].map(r=>r[0].transcript).join(' ')+'» finale='+e.results[e.results.length-1].isFinal+' armato='+armed+' parla='+!!activeUtterance);
    if(activeUtterance)return;
    if(!armed){armed=true;micUI(true);}
    let txt='',fin=false;
    for(let i=0;i<e.results.length;i++){
      const r=e.results[i];let pick=r[0].transcript;
      if(r.isFinal&&r.length>1){let bs=kbScore(pick);for(let a=1;a<r.length;a++){const sc=kbScore(r[a].transcript);if(sc>bs+1){bs=sc;pick=r[a].transcript;}}}
      txt+=(txt&&!/\s$/.test(txt)&&!/^\s/.test(pick)?' ':'')+pick;fin=r.isFinal;}
    heardText=txt.trim();$('question').value=heardText;
    clearTimeout(silenceTimer);
    if(IS_IOS&&fin&&heardText){sendHeard();return;}
    if(heardText)silenceTimer=setTimeout(sendHeard,fin?1300:2000);   // invia solo dopo una pausa vera
  };
  rec.onerror=e=>{
    dbg('mic: ERRORE '+e.error);
    if(e.error==='aborted')return;
    if(e.error==='no-speech'){if(armed&&dialog){armed=false;micUI(false);if(IS_IOS)micAttention();else setTimeout(listenNow,300);}return;}
    const framed=(()=>{try{return window.self!==window.top;}catch{return true;}})();
    armed=false;micUI(false);
    setHint(framed?'In questa anteprima il microfono è bloccato: scrivi la domanda qui accanto.':e.error==='not-allowed'?'Tocca il microfono per rispondere.':e.error==='service-not-allowed'?'Su iPhone attiva la dettatura: Impostazioni → Generali → Tastiera → Abilita dettatura.':'Tocca il microfono per rispondere.');
  };
  rec.onend=()=>{dbg('mic: fine');recRunning=false;if(armed&&heardText)sendHeard();else if(armed){armed=false;micUI(false);if(dialog){if(IS_IOS)micAttention();else setTimeout(listenNow,300);}}};
  return rec;
}
// accende il microfono da zero per una nuova domanda
function listenNow(){
  if(!dialog||activeUtterance)return;
  $('mic').classList.remove('nudge');
  armed=true;heardText='';$('question').value='';setStatus('UN ISTANTE…');
  soundSeen=false;muteRetry=0;try{speechSynthesis.cancel();}catch{}audioDuplex();
  const go=()=>{ensureRec();if(!rec)return;recRunning=false;try{rec.start();dbg('mic: start() chiamato');}catch(err){dbg('mic: start() fallito '+err.message);}
    clearTimeout(startGuard);startGuard=setTimeout(()=>{if(armed&&!recRunning){setHint('Un istante: il microfono si sta accendendo…');}},2500);};
  go();
}
const IS_IOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
// Su iPhone il microfono funziona solo se lo accende un tocco: dopo la risposta lo invito a toccare.
function micAttention(){
  $('mic').classList.add('nudge');setStatus('IN ATTESA DI UNA DOMANDA');
  setHint('Tocca il microfono per la prossima domanda');
}
function rearm(){if(!dialog)return;if(IS_IOS){micAttention();return;}setTimeout(listenNow,300);}
function endDialog(msg){dialog=false;armed=false;heardText='';clearTimeout(armTimer);clearTimeout(silenceTimer);hardStop();micUI(false);if(msg)setHint(msg);}
window.auraRearm=rearm;window.auraEndDialog=endDialog;
// all'ingresso: chiede subito il permesso del microfono, poi lo spegne
$('mic').addEventListener('click',()=>{
  if(!SpeechRecognition){setHint('Questo browser non riconosce la voce: usa Safari su iPhone o Chrome, oppure scrivi la domanda.');$('question').focus();return;}
  if(armed&&recRunning&&heardText){sendHeard();return;}
  if(armed&&recRunning&&!IS_IOS){endDialog('Conversazione in pausa: tocca il microfono per riprendere.');return;}
  const speakingNow=!!activeUtterance||(window.speechSynthesis&&speechSynthesis.speaking);
  dbg('tocco microfono · AURA parlava='+speakingNow);
  if(speakingNow){stopSpeaking();try{speechSynthesis.cancel();}catch{}
    // iPhone: se il microfono parte mentre la voce occupa ancora l'audio, non sente nulla. Aspetto che l'audio si liberi.
    armed=false;dialog=true;setStatus('UN ISTANTE…');$('mic').classList.remove('nudge');
    setTimeout(()=>{dbg('mic: avvio dopo aver zittito AURA');listenNow();},IS_IOS?700:250);return;}
  armed=false;dialog=true;listenNow();
});

function closeSettings(){MODAL.hidden=true;}
$('settingsButton').onclick=()=>{MODAL.hidden=false;};$('closeSettings').onclick=closeSettings;$('modalBackdrop').onclick=closeSettings;
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSettings();});
$('adminEntry').onclick=()=>{$('adminPanel').hidden=!$('adminPanel').hidden;$('adminEntry').querySelector('span').textContent=$('adminPanel').hidden?'+':'−';};
$('phrases').value=localStorage.getItem('aura_preview_phrases')||'';
$('savePhrases').onclick=()=>{localStorage.setItem('aura_preview_phrases',$('phrases').value);$('saveStatus').textContent='Salvato qui';};
$('voiceSelect')&&($('voiceSelect').onchange=()=>{try{localStorage.setItem(VOICE_KEY,$('voiceSelect').value);}catch{}});
$('voiceTest')&&($('voiceTest').onclick=()=>speak('prova','Salve, umano. Sono AURA. Questa è la voce con cui ti parlerò.'));
function syncMute(){const on=$('voiceToggle').checked;const b=$('muteButton');if(!b)return;b.classList.toggle('muted',!on);b.setAttribute('aria-pressed',String(!on));b.setAttribute('aria-label',on?'Disattiva la voce':'Attiva la voce');try{localStorage.setItem('aura_muted',on?'0':'1');}catch{}}
$('voiceToggle').onchange=()=>{if(!$('voiceToggle').checked)stopSpeaking();syncMute();};
$('muteButton')&&($('muteButton').onclick=()=>{$('voiceToggle').checked=!$('voiceToggle').checked;if(!$('voiceToggle').checked)stopSpeaking();syncMute();});
try{if(localStorage.getItem('aura_muted')==='1')$('voiceToggle').checked=false;}catch{}
syncMute();
try{const previous=JSON.parse(sessionStorage.getItem(STORAGE)||'null');if(previous?.text)render(previous.text,previous.actions||[],previous.follow||[]);}catch{}

// ---------- Ingresso: l'astronave di AURA-3025 (il tocco sblocca anche la voce) ----------
(()=>{
  const intro=$('startAura');if(!intro)return;
  const cv=$('introStars'),ctx=cv.getContext('2d');
  // immagine dell'astronave (copre lo schermo; si mette a fuoco sulla cupola di comando)
  const SHIP={src:'assets/intro/ship.jpg?v=20261121103839',w:1672,h:941,bx:.36,by:.22,fx:.42};
  const TALL={src:'assets/intro/ship-tall.jpg?v=20261121103940',w:941,h:1672,bx:.35,by:.41};
  const scene=$('shipScene');
  function placeShip(){
    const vw=innerWidth,vh=innerHeight,m=SHIP;
    scene.style.backgroundImage=`url(${m.src})`;
    let iw,ih,left,top;
    if(vw/vh<1){
      // telefono in verticale: astronave e Terra intera, larghe quanto lo schermo
      const t=TALL;scene.style.backgroundImage=`url(${t.src})`;
      const k=Math.max(vw/t.w,vh/t.h);iw=t.w*k;ih=t.h*k;left=(vw-iw)/2;top=(vh-ih)/2;   // a tutto schermo
      scene.style.webkitMaskImage=scene.style.maskImage='none';
      scene.style.backgroundSize=`${iw}px ${ih}px`;scene.style.backgroundPosition=`${left}px ${top}px`;
      scene.style.transformOrigin=`${left+t.bx*iw}px ${top+t.by*ih}px`;
      return;
    }else{
      const k=Math.max(vw/m.w,vh/m.h);iw=m.w*k;ih=m.h*k;
      left=Math.min(0,Math.max(vw-iw,vw/2-m.fx*iw));top=(vh-ih)/2;
      scene.style.webkitMaskImage=scene.style.maskImage='none';
    }
    scene.style.backgroundSize=`${iw}px ${ih}px`;scene.style.backgroundPosition=`${left}px ${top}px`;
    scene.style.transformOrigin=`${left+m.bx*iw}px ${top+m.by*ih}px`;
  }
  placeShip();addEventListener('resize',placeShip);
  let W=0,H=0,dpr=Math.min(devicePixelRatio||1,2),warp=0,running=true,dir=1;
  const stars=Array.from({length:420},()=>({x:(Math.random()-.5)*2,y:(Math.random()-.5)*2,z:Math.random()*1+.05,pz:0}));
  function size(){W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
  size();addEventListener('resize',size);
  let last=performance.now();
  function draw(now){
    if(!running)return;requestAnimationFrame(draw);
    const dt=Math.min(.05,(now-last)/1000);last=now;
    ctx.clearRect(0,0,W,H);
    if(warp<=0){
      for(const s of stars){const tw=.35+.65*Math.abs(Math.sin(now/900*(s.tw||(s.tw=.4+Math.random()*1.6))+s.x*9));
        const x=(s.x*.5+.5)*W,y=(s.y*.5+.5)*H,r=(1-s.z)*1.1+.25;
        ctx.fillStyle=`rgba(225,235,255,${(1-s.z)*.8*tw})`;ctx.fillRect(x,y,r,r);}
      return;
    }
    const cx=W/2,cy=H*.45,f=Math.max(W,H)*.55;
    const speed=.05+warp*warp*3.2;
    ctx.globalCompositeOperation='lighter';
    for(const s of stars){
      s.pz=s.z;s.z-=speed*dt*dir;
      if(s.z<=.03){s.x=(Math.random()-.5)*2;s.y=(Math.random()-.5)*2;s.z=1;s.pz=1;}
      if(s.z>1){s.x=(Math.random()-.5)*2;s.y=(Math.random()-.5)*2;s.z=.06;s.pz=.06;}
      const hx=cx+s.x/s.z*f*.5,hy=cy+s.y/s.z*f*.5;
      if(hx<-50||hx>W+50||hy<-50||hy>H+50)continue;
      const near=1-s.z, a=Math.min(1,near*1.3)*Math.min(1,warp*2.2);
      const len=Math.hypot(hx-cx,hy-cy)*Math.min(.92,warp*warp*.95)*(dir<0?.55:1);   // lunghezza della scia
      const ang=Math.atan2(hy-cy,hx-cx), tx=hx-Math.cos(ang)*len, ty=hy-Math.sin(ang)*len;
      const c=s.c||(s.c=Math.random()<.7?'255,255,255':(Math.random()<.5?'190,220,255':'160,200,255'));
      const wdt=(.5+near*1.4)*(1+warp*.5);
      if(len<2){ctx.fillStyle=`rgba(${c},${a})`;ctx.beginPath();ctx.arc(hx,hy,wdt*.7,0,6.283);ctx.fill();continue;}
      const g=ctx.createLinearGradient(tx,ty,hx,hy);g.addColorStop(0,`rgba(${c},0)`);g.addColorStop(.75,`rgba(${c},${a*.55})`);g.addColorStop(1,`rgba(${c},${a})`);
      ctx.strokeStyle=g;ctx.lineWidth=wdt;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(hx,hy);ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over';
  }
  requestAnimationFrame(draw);
  let started=false;
  function enter(){
    if(started)return;started=true;
    voiceUnlocked=true;
    const hello=(typeof memory!=='undefined'&&memory.name)?`Bentornato a bordo, ${memory.name}. Sono AURA-3025. Chiedimi quello che vuoi su Pietro Mascagni.`:'Benvenuto a bordo, umano. Sono AURA-3025. Chiedimi quello che vuoi su Pietro Mascagni.';
    // la voce parte subito, dentro il tocco: così il telefono non la blocca
    if($('voiceToggle').checked){try{const z=new SpeechSynthesisUtterance(' ');z.volume=0;speechSynthesis.speak(z);}catch{}}
    intro.classList.add('entering');
    const t0=performance.now();
    (function accel(){const k=Math.max(0,(performance.now()-t0-250)/1150);warp=Math.min(1,k);if(k<1.6)requestAnimationFrame(accel);})();
    setTimeout(()=>{window.aura3d?.intro?.();render(hello,[],['Chi sei?','Chi era Mascagni?','Di cosa parla Cavalleria rusticana?']);},1500);
    setTimeout(()=>{intro.classList.add('leaving');if($('voiceToggle').checked)speak('saluto',hello);},1900);
    setTimeout(()=>{running=false;intro.hidden=true;intro.classList.remove('entering','leaving');},2900);
  }
  // ritorno all'astronave dopo il congedo
  window.auraOutro=()=>{
    if(!started)return;
    window.aura3d?.outro?.();
    setTimeout(()=>{
      intro.classList.remove('entering','leaving');intro.classList.add('returning');intro.hidden=false;
      dir=-1;warp=1;running=true;last=performance.now();requestAnimationFrame(draw);
      const t0=performance.now();
      (function decel(){const k=(performance.now()-t0)/1500;warp=Math.max(0,1-k);if(k<1)requestAnimationFrame(decel);else{dir=1;warp=0;}})();
      setTimeout(()=>intro.classList.remove('returning'),700);
      setTimeout(()=>{started=false;stopSpeaking();setStatus('IN ATTESA DI UNA DOMANDA');},1600);
    },1100);
  };
  intro.addEventListener('click',enter);
  intro.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();enter();}});
})();
