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
const GENERIC=new Set(['mascagni','pietro','cavalleria','rusticana','opere','vita','aura','chi era','storia','compositore']);
const STOP=new Set('che chi cosa come dove quando quale quali quanto quanti perche per con del della dei delle degli dal dalla nel nella nei sul sulla una uno gli le lo la il di da in su tra fra non piu mi ti si ci vi sei sono era erano e ha hanno ho hai abbiamo mio mia tuo tua suo sua loro questo questa quello quella parlami dimmi raccontami sai conosci puoi vorrei sapere anche ancora molto poco tutto tutti cos fatto fare essere stato stata opera opere mascagni pietro aura'.split(' '));
for(const e of KB)e.ntext=norm(e.text+' '+e.keys.join(' '));
const IDF={};{const df={};for(const e of KB){const seen=new Set(e.ntext.trim().split(' ').map(w=>w.length>5?w.slice(0,w.length-2):w));for(const w of seen)df[w]=(df[w]||0)+1;}
  for(const w in df)IDF[w]=Math.log(1+KB.length/df[w]);}
const TOPIC_NAMES={mascagni:'della vita di Mascagni',opere:'delle sue opere',cavalleria:'di Cavalleria rusticana',festival:'del Festival',aura:'di me',livorno:'di Livorno',opera:'dell\u2019opera',curiosita:'di qualche curiosità'};
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);

function demoAnswer(question){
  const q=norm(question);
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
  for(const e of KB){
    let score=0;
    for(const k of e.nkeys){if(k&&q.includes(' '+k))score+=GENERIC.has(k)?k.length/3:k.length;}
    if(!score)continue;
    if(aboutMe&&e.topic==='aura')score+=4;
    if(e.topic===last)score+=2;
    if(score>bestScore){best=e;bestScore=score;}
  }
  if(!best||bestScore<4){
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
    if(memory.name&&['saluto','grazie','ciao'].includes(id))text=`${memory.name}, `+text.charAt(0).toLowerCase()+text.slice(1);
    if(memory.history.at(-1)?.q===q&&id!=='curiosita2')text='Te l’ho appena detto, ma lo ripeto volentieri: '+text.charAt(0).toLowerCase()+text.slice(1);
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

function clean(text){return text.replace(/…/g,', ').replace(/’/g,"'").replace(/\s+/g,' ').trim();}

function speak(_voice,text){
  stopSpeaking();
  if(!$('voiceToggle').checked||!text)return;
  if(!synth){setHint('Questo browser non ha una voce di sintesi: leggi la risposta qui sopra.');return;}
  const u=new SpeechSynthesisUtterance(clean(text));
  const v=chosenVoice();if(v)u.voice=v;
  u.lang=v?.lang||'it-IT';u.rate=0.97;u.pitch=isMale(v)?0.92:0.72;u.volume=1;
  activeUtterance=u;
  let started=false;
  u.onstart=()=>{if(activeUtterance!==u)return;started=true;auraAvatar.speakLive();setStatus('AURA STA PARLANDO');};
  u.onboundary=e=>{
    if(activeUtterance!==u||e.name&&e.name!=='word')return;
    const rest=u.text.slice(e.charIndex);const word=(rest.match(/^\S+/)||[''])[0];
    auraAvatar.liveWord(word);
  };
  const finish=()=>{if(activeUtterance===u)stopSpeaking();};
  u.onend=finish;
  u.onerror=e=>{if(activeUtterance!==u)return;finish();if(e.error!=='interrupted'&&e.error!=='canceled')setHint('Voce non disponibile. Puoi leggere la risposta qui sopra.');};
  setStatus('AURA STA PER PARLARE');
  synth.speak(u);
  // Alcuni telefoni bloccano la voce se non parte da un tocco: offro il pulsante.
  setTimeout(()=>{
    if(activeUtterance!==u||started)return;
    synth.cancel();activeUtterance=null;setStatus('IN ATTESA DI UNA DOMANDA');
    $('playVoice').hidden=false;$('playVoice').onclick=()=>{$('playVoice').hidden=true;speak(_voice,text);};
  },2500);
}

function ask(question){
  const text=question.trim();if(!text)return;
  const result=demoAnswer(text);
  render(result.text,result.actions,result.follow);
  setHint('Domanda ricevuta · puoi parlare ancora oppure scrivere');
  speak(result.voice,result.text);
  $('question').value='';
}

$('textForm').addEventListener('submit',event=>{event.preventDefault();ask($('question').value);});

const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
$('mic').addEventListener('click',()=>{
  try{if(window.speechSynthesis&&!window.__auraVoiceUnlocked){const z=new SpeechSynthesisUtterance(' ');z.volume=0;speechSynthesis.speak(z);window.__auraVoiceUnlocked=true;}}catch{}
  if(listening){recognition?.stop();return;}
  if(!SpeechRecognition){setHint('Il riconoscimento vocale non è supportato qui. Scrivi nel campo accanto.');$('question').focus();return;}
  try{
    recognition=new SpeechRecognition();recognition.lang='it-IT';recognition.interimResults=false;recognition.continuous=false;
    recognition.onstart=()=>{listening=true;$('mic').classList.add('listening');setStatus('TI STO ASCOLTANDO');setHint('Parla ora… tocca di nuovo per fermare');};
    recognition.onresult=event=>{const words=event.results?.[0]?.[0]?.transcript;if(words)ask(words);};
    recognition.onerror=event=>{const framed=(()=>{try{return window.self!==window.top;}catch{return true;}})();const reason=framed&&/not-allowed|service-not-allowed|audio-capture/.test(event.error)?'In questa anteprima il microfono è bloccato: scrivi la domanda qui accanto. Sul sito pubblicato potrai parlare.':event.error==='not-allowed'?'Consenti il microfono dalle impostazioni del browser.':event.error==='no-speech'?'Non ho sentito nulla. Riprova o scrivi.':'Microfono non disponibile ('+event.error+'). Puoi scrivere.';setHint(reason);};
    recognition.onend=()=>{listening=false;$('mic').classList.remove('listening');if($('stageStatus').textContent==='TI STO ASCOLTANDO')setStatus('IN ATTESA DI UNA DOMANDA');};
    recognition.start();
  }catch{setHint('Non riesco ad avviare il microfono. Prova a scrivere la domanda.');$('question').focus();}
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
