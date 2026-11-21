# Regole del microfono su iPhone (Safari) — da NON cambiare

Verificate sul telefono di Massimo il 21/11/2026. Ogni violazione ha già rotto il microfono.

1. Il riconoscimento parte SOLO da un tocco sul pulsante: niente avvio automatico (né all'ingresso, né dopo la risposta).
2. Un oggetto SpeechRecognition NUOVO per ogni domanda; il precedente va chiuso con abort().
3. continuous = false su iPhone. (continuous = true blocca le domande successive.)
4. Appena arriva il risultato finale: abort() del microfono, POI AURA risponde. Il microfono non deve restare acceso mentre AURA parla.
5. Safari impiega più di 2 secondi ad avviare il microfono: nessun controllo a tempo che scarti le parole.
6. Niente getUserMedia "per tenere caldo" il microfono: occupa l'audio.
7. Dopo la risposta: il pulsante pulsa e invita a toccare ("Tocca il microfono per la prossima domanda").

Prima di pubblicare qualsiasi modifica al microfono: test con microfono simulato lento (avvio 2,2 s) e tre domande di fila.

8. Se si tocca il microfono mentre AURA parla: prima zittirla, poi accendere il microfono dopo ~700 ms. Se parte mentre la voce occupa l'audio, su iPhone non sente nulla (scoperto con il registro #debug, 21/11 ore 11:43).
9. Dopo che AURA ha parlato, iPhone può lasciare l'audio in modalità solo-riproduzione: il mic si apre ma riceve silenzio. VIETATO navigator.audioSession.type="play-and-record": provato il 21/11 alle 11:56, rende sordo il microfono anche alla PRIMA domanda. Rimedio corretto: regola 10 (doppio avvio).
10. SCOPERTA DI MASSIMO (21/11 11:52): dopo che AURA ha parlato, il PRIMO avvio del microfono resta sordo, il SECONDO funziona. Rimedio: al tocco, appena arriva "audio aperto", si chiude e si riavvia da solo (doppio avvio). Non togliere.

11. ERRORE MIO (21/11 11:56-12:15): il riavvio automatico fatto DA CODICE (senza tocco) resta sordo e ha rotto anche la PRIMA domanda. Un riavvio funziona solo se nasce da un tocco. Ripristinata la versione delle 11:43; il secondo avvio ora nasce dallo stesso tocco (touchstart = risveglio, click = ascolto), solo dalla seconda domanda in poi.

12. VERSIONE A DUE TOCCHI (21/11 12:50): dalla seconda domanda, tocco 1 = sveglia (scritta TOCCA ANCORA E PARLA), tocco 2 = ascolto. Il risveglio a un tocco (touchstart+click) NON ha funzionato su iPhone.
13. (21/11 12:55) Il secondo tocco vale solo quando compare TOCCA ANCORA E PARLA (1,8 s dopo il primo): i tocchi troppo rapidi (0,4 s) fallivano. Mentre AURA parla il microfono è grigio e i tocchi sono ignorati (idea di Massimo).
