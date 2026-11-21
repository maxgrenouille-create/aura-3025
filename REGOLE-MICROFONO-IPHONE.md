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
