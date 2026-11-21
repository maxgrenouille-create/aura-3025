const auraAvatar = (() => {
  const portrait = document.querySelector('.portrait');
  const canvas = document.querySelector('.portrait-mouth');
  const context = canvas.getContext('2d');
  const crop = {x: 544, y: 390, width: 230, height: 155};
  const upperEdge = 40;
  const lowerEdge = 124;
  const lipLine = [[58, 70], [75, 69], [92, 67], [112, 68], [132, 68], [150, 69], [167, 69], [183, 70]];
  const columns = [];

  // The lip contour follows the mouth in the original portrait.
  for (let x = lipLine[0][0]; x < lipLine.at(-1)[0]; x++) {
    const right = lipLine.findIndex(([edge]) => edge > x);
    const [leftX, leftY] = lipLine[right - 1];
    const [rightX, rightY] = lipLine[right];
    const mix = (x - leftX) / (rightX - leftX);
    columns.push({x, split: leftY + (rightY - leftY) * mix});
  }

  let frame = 0;
  let opening = 0;
  let rounding = 0;
  let updatedAt = 0;

  function drawMouth() {
    context.clearRect(0, 0, crop.width, crop.height);
    if (opening < .018 || !portrait.naturalWidth) return;

    const width = columns.length - 1;
    for (const [index, {x, split}] of columns.entries()) {
      const center = Math.sin(Math.PI * index / width);
      const bend = center ** (1.65 + rounding * 1.5);
      const top = split - opening * bend * 1.8;
      const bottom = split + opening * bend * 8.2;
      if (bottom - top < .1) continue;

      const depth = context.createLinearGradient(0, top, 0, bottom);
      depth.addColorStop(0, '#292222');
      depth.addColorStop(.45, '#171414');
      depth.addColorStop(1, '#393030');
      context.fillStyle = depth;
      context.fillRect(x, top, 1, bottom - top);

      context.drawImage(portrait, crop.x + x, crop.y + upperEdge, 1, split - upperEdge,
        x, upperEdge, 1, top - upperEdge);
      context.drawImage(portrait, crop.x + x, crop.y + split, 1, lowerEdge - split,
        x, bottom, 1, lowerEdge - bottom);
    }
  }

  function sample(track, seconds) {
    const position = Math.max(0, seconds * 40);
    const index = Math.floor(position);
    const mix = position - index;
    const first = Number.parseInt(track[index] || '0', 16);
    const next = Number.parseInt(track[index + 1] || '0', 16);
    return (first + (next - first) * mix) / 15;
  }

  function speak(audio, cues) {
    stop();
    if (!context) return;

    function animate(now) {
      const time = audio.currentTime;
      const delta = updatedAt ? Math.min(60, now - updatedAt) : 16;
      updatedAt = now;
      const energy = sample(cues[0], time - .08) * .2 + sample(cues[0], time - .035) * .23
        + sample(cues[0], time + .015) * .31 + sample(cues[0], time + .055) * .26;
      const target = Math.max(0, (energy - .085) / .915);
      const shape = sample(cues[1], time);
      opening += (target - opening) * (1 - Math.exp(-delta / (target > opening ? 72 : 105)));
      rounding += (shape - rounding) * (1 - Math.exp(-delta / 120));
      drawMouth();
      frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
  }

  // Labiale "dal vivo" per la voce del dispositivo: sillabe simulate,
  // ritmate dagli eventi di parola e dalle pause della punteggiatura.
  let live = null;
  function speakLive() {
    stop();
    if (!context) return;
    live = {active: true, pauseFrom: 0, pauseUntil: 0, phase: 0, rate: 5, amp: .85, round: .2};
    function animate(now) {
      const delta = updatedAt ? Math.min(60, now - updatedAt) : 16;
      updatedAt = now;
      const paused = now >= live.pauseFrom && now < live.pauseUntil;
      let target = 0;
      if (live.active && !paused) {
        const before = live.phase;
        live.phase += delta / 1000 * live.rate * Math.PI * 2;
        if (Math.floor(before / (Math.PI * 2)) !== Math.floor(live.phase / (Math.PI * 2))) {
          live.rate = 4.1 + Math.random() * 2.2;          // ogni sillaba ha la sua durata
          live.amp = .55 + Math.random() * .45;
        }
        const syllable = .5 - .5 * Math.cos(live.phase);
        target = .12 + live.amp * .88 * Math.pow(syllable, .85);
      }
      opening += (target - opening) * (1 - Math.exp(-delta / (target > opening ? 55 : 80)));
      rounding += (live.round - rounding) * (1 - Math.exp(-delta / 140));
      drawMouth();
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
  }
  function liveWord(word) {
    if (!live) return;
    live.active = true;
    const w = word.toLowerCase();
    const vowels = w.match(/[aeiouàèéìòù]/g) || [];
    const round = vowels.filter(v => 'oòuù'.includes(v)).length;
    live.round = vowels.length ? Math.min(1, round / vowels.length * 1.6) : .2;
    if (/[.,;:!?…]$/.test(word)) {
      const start = performance.now() + Math.max(180, w.length * 70);
      live.pauseFrom = start;
      live.pauseUntil = start + (/[.!?…]$/.test(word) ? 380 : 210);
    }
  }

  function stop() {
    live = null;
    cancelAnimationFrame(frame);
    frame = opening = rounding = updatedAt = 0;
    context?.clearRect(0, 0, crop.width, crop.height);
  }

  return {speak, speakLive, liveWord, stop, level: () => opening, canvas};
})();
