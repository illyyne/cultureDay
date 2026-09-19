function createAudioPlayer(container, src) {
  container.innerHTML = '';
  const audio = document.createElement('audio');
  audio.src = src;
  audio.preload = 'auto';

  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn-accent';
  playBtn.style.cssText = 'font-size:var(--text-base);padding:var(--space-2) var(--space-4);';
  playBtn.textContent = '▶ Play';

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().catch(() => {});
      playBtn.textContent = '⏸ Pause';
    } else {
      audio.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶ Play';
  });

  container.appendChild(playBtn);
  container.appendChild(audio);

  return audio;
}
