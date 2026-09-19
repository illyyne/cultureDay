(async function () {
  const hostId = await signInAnonymously();
  if (!hostId) return alert('Authentication failed. Please refresh.');

  let gameCode = null;
  let gameRef = null;
  let questions = [];
  let players = {};
  let currentQIndex = 0;
  let timerInterval = null;
  let timerDuration = 20;
  let answerListener = null;
  let leafletMap = null;
  let revealTimeout = null;
  let revealCountdownInterval = null;
  let isTransitioningToReveal = false;

  const $ = id => document.getElementById(id);

  // === LOBBY ===
  async function createGame() {
    gameCode = generateGameCode();
    gameRef = db.ref('games/' + gameCode);
    if ((await gameRef.once('value')).exists()) {
      gameCode = generateGameCode();
      gameRef = db.ref('games/' + gameCode);
    }

    await gameRef.set({
      hostId, state: STATES.LOBBY,
      currentQuestionIndex: 0, questionIds: [],
      currentRound: '', timerEnd: 0, timerDuration: 20,
      isDoublePoints: false,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    $('game-code-display').textContent = gameCode;
    generateQRCode();
    listenForPlayers();
  }

  function generateQRCode() {
    const base = window.location.href.replace('host.html', '');
    const url = base + '?code=' + gameCode;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qrcode').innerHTML = qr.createSvgTag(5, 0);
    const linkEl = document.createElement('a');
    linkEl.href = url;
    linkEl.target = '_blank';
    linkEl.style.cssText = 'display:block;font-size:var(--text-base);color:var(--color-accent);margin-top:var(--space-3);word-break:break-all;max-width:320px;text-align:center;text-decoration:underline;';
    linkEl.textContent = url;
    const hintEl = document.createElement('div');
    hintEl.style.cssText = 'font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:var(--space-1);text-align:center;';
    hintEl.textContent = '💻 Or open this link on your laptop';
    $('qrcode').appendChild(linkEl);
    $('qrcode').appendChild(hintEl);
  }

  function listenForPlayers() {
    gameRef.child('players').on('value', snap => {
      players = snap.val() || {};
      const names = Object.values(players).map(p => p.name);
      $('player-count').textContent = names.length + ' player' + (names.length !== 1 ? 's' : '') + ' joined';
      $('player-chips').innerHTML = names.map(n =>
        '<span class="player-chip">' + escapeHtml(n) + '</span>').join('');
      $('btn-start').disabled = names.length < 1;
    });
  }

  async function loadQuestions() {
    const snap = await db.ref('questions').orderByChild('order').once('value');
    const all = [];
    snap.forEach(child => { all.push({ id: child.key, ...child.val() }); });

    const byRound = {};
    ROUND_ORDER.forEach(r => { byRound[r] = []; });
    all.forEach(q => { if (byRound[q.round]) byRound[q.round].push(q); });

    questions = [];
    ROUND_ORDER.forEach(r => {
      byRound[r].sort((a, b) => (a.order || 0) - (b.order || 0));
      questions.push(...byRound[r]);
    });
    return questions.map(q => q.id);
  }

  // === START ===
  $('btn-start').addEventListener('click', async () => {
    $('btn-start').disabled = true;
    timerDuration = parseInt($('timer-select').value);
    const questionIds = await loadQuestions();
    if (questionIds.length === 0) {
      alert('No questions found! Add questions in the admin panel first.');
      $('btn-start').disabled = false;
      return;
    }
    await gameRef.update({ questionIds, timerDuration, currentQuestionIndex: 0 });
    currentQIndex = 0;
    showRoundInterstitial(questions[0].round, () => transitionTo(STATES.QUESTION));
  });

  // === STATE MACHINE (simplified: QUESTION → REVEAL → next QUESTION → FINISHED) ===
  let questionStartTime = 0;

  async function transitionTo(state) {
    switch (state) {
      case STATES.QUESTION:
        // enterQuestion writes state + metadata in one atomic update
        enterQuestion();
        break;
      case STATES.REVEAL:
        await gameRef.update({ state });
        enterReveal();
        break;
      case STATES.FINISHED:
        await gameRef.update({ state });
        enterFinished();
        break;
      default:
        await gameRef.update({ state });
    }
  }

  // === QUESTION ===
  async function enterQuestion() {
    isTransitioningToReveal = false;
    clearTimeout(revealTimeout);
    clearInterval(revealCountdownInterval);
    const q = questions[currentQIndex];
    if (!q) return transitionTo(STATES.FINISHED);

    const isMap = isMapRound(q.round);
    const effectiveTimer = isMap ? Math.max(timerDuration, SCORING.MAP_TIMER_DURATION) : timerDuration;
    const isDouble = isDoublePointsQuestion(currentQIndex, questions);

    showScreen('screen-question');

    $('q-round-badge').textContent = (ROUND_ICONS[q.round] || '') + ' ' + (ROUND_LABELS[q.round] || q.round);
    $('q-counter').textContent = (currentQIndex + 1) + ' of ' + questions.length;
    $('q-text').textContent = q.text;
    $('q-double-badge').style.display = isDouble ? 'block' : 'none';

    const img = $('q-image');
    const audioContainer = $('q-audio-container');
    const audio = $('q-audio');
    img.style.display = 'none';
    audioContainer.style.display = 'none';

    if (q.mediaType === 'photo' && q.mediaUrl) {
      img.src = q.mediaUrl;
      img.style.display = 'block';
    } else if (q.mediaType === 'audio' && q.mediaUrl) {
      audio.src = q.mediaUrl;
      audioContainer.style.display = 'flex';
      audio.play().catch(() => {});
    }

    if (isMap) {
      $('q-choices').innerHTML = '<div style="font-size:var(--text-xl);color:var(--host-accent);text-align:center;padding:var(--space-4)">🗺️ Players are pinning on the map...</div>';
    } else {
      $('q-choices').innerHTML = q.choices.map((c, i) =>
        '<div class="host-choice" style="background:' + ANSWER_COLORS[i].bg + '">' +
          '<span class="shape">' + ANSWER_COLORS[i].shape + '</span> ' + escapeHtml(c) + '</div>'
      ).join('');
    }

    const playerCount = Object.keys(players).length;
    $('total-players').textContent = playerCount;
    $('answered-count').textContent = '0';
    $('q-answer-count').style.display = 'flex';

    const timerMs = effectiveTimer * 1000;
    questionStartTime = getServerTime();
    const timerEnd = questionStartTime + timerMs;

    // Single atomic write: state + all question metadata together
    // Prevents race where player sees state change before round/timer are set
    await gameRef.update({
      state: STATES.QUESTION,
      timerEnd, timerDuration: effectiveTimer,
      currentQuestionIndex: currentQIndex,
      currentRound: q.round,
      isDoublePoints: isDouble
    });

    startTimer(effectiveTimer);
    listenForAnswers();
  }

  function startTimer(seconds) {
    clearInterval(timerInterval);
    const circumference = 2 * Math.PI * 44;
    let remaining = seconds;
    $('timer-text').textContent = remaining;
    $('timer-progress').style.strokeDashoffset = '0';

    timerInterval = setInterval(() => {
      remaining--;
      $('timer-text').textContent = Math.max(0, remaining);
      const fraction = 1 - (remaining / seconds);
      $('timer-progress').style.strokeDashoffset = (circumference * fraction).toFixed(2);
      $('timer-progress').style.stroke = remaining <= 5 ? 'var(--color-wrong)' : 'var(--color-accent)';
      if (remaining <= 0) { clearInterval(timerInterval); goToReveal(); }
    }, 1000);
  }

  function listenForAnswers() {
    if (answerListener) answerListener();
    const ref = gameRef.child('answers/' + currentQIndex);
    const handler = ref.on('value', snap => {
      const count = Object.keys(snap.val() || {}).length;
      $('answered-count').textContent = count;
      if (count >= Object.keys(players).length && Object.keys(players).length > 0) {
        clearInterval(timerInterval);
        goToReveal();
      }
    });
    answerListener = () => ref.off('value', handler);
  }

  async function goToReveal() {
    if (isTransitioningToReveal) return;
    isTransitioningToReveal = true;
    if (answerListener) { answerListener(); answerListener = null; }
    const audio = $('q-audio');
    if (audio && !audio.paused) audio.pause();

    const q = questions[currentQIndex];
    const isMap = isMapRound(q.round);
    const isDouble = isDoublePointsQuestion(currentQIndex, questions);

    const snap = await gameRef.child('answers/' + currentQIndex).once('value');
    const answers = snap.val() || {};

    await computeScores(q, answers, isMap, isDouble);

    // Refresh players after score update
    const pSnap = await gameRef.child('players').once('value');
    players = pSnap.val() || {};

    transitionTo(STATES.REVEAL);
  }

  async function computeScores(question, answers, isMap, isDouble) {
    const effectiveTimer = isMap ? Math.max(timerDuration, SCORING.MAP_TIMER_DURATION) : timerDuration;
    const timerMs = effectiveTimer * 1000;
    const multiplier = isDouble ? SCORING.DOUBLE_POINTS_MULTIPLIER : 1;
    const updates = {};

    for (const [pid, answer] of Object.entries(answers)) {
      const player = players[pid];
      if (!player) continue;
      const currentStreak = player.streak || 0;
      const responseTime = answer.answeredAt ? Math.max(0, Math.min(answer.answeredAt - questionStartTime, timerMs)) : timerMs;

      if (isMap) {
        if (answer.lat != null && answer.lng != null && question.location) {
          const dist = haversineDistance(answer.lat, answer.lng, question.location.lat, question.location.lng);
          const result = calculateMapScore(dist, responseTime, timerMs, currentStreak);
          const pts = result.points * multiplier;
          updates['players/' + pid + '/score'] = (player.score || 0) + pts;
          updates['players/' + pid + '/streak'] = result.newStreak;
          updates['players/' + pid + '/lastPoints'] = pts;
          updates['players/' + pid + '/lastCorrect'] = dist <= 500;
          updates['players/' + pid + '/lastDistance'] = Math.round(dist);
        } else {
          updates['players/' + pid + '/streak'] = 0;
          updates['players/' + pid + '/lastPoints'] = 0;
          updates['players/' + pid + '/lastCorrect'] = false;
          updates['players/' + pid + '/lastDistance'] = null;
        }
      } else {
        const isCorrect = answer.choiceIndex === question.correctIndex;
        const result = calculateScore(isCorrect, responseTime, timerMs, currentStreak);
        const pts = result.points * multiplier;
        updates['players/' + pid + '/score'] = (player.score || 0) + pts;
        updates['players/' + pid + '/streak'] = result.newStreak;
        updates['players/' + pid + '/lastPoints'] = pts;
        updates['players/' + pid + '/lastCorrect'] = isCorrect;
        updates['players/' + pid + '/lastDistance'] = null;
      }
    }

    for (const [pid] of Object.entries(players)) {
      if (!answers[pid]) {
        updates['players/' + pid + '/streak'] = 0;
        updates['players/' + pid + '/lastPoints'] = 0;
        updates['players/' + pid + '/lastCorrect'] = false;
        updates['players/' + pid + '/lastDistance'] = null;
      }
    }

    // Guard against NaN — Firebase rejects NaN and would fail the entire update
    for (const key of Object.keys(updates)) {
      if (typeof updates[key] === 'number' && isNaN(updates[key])) {
        updates[key] = 0;
      }
    }
    if (Object.keys(updates).length > 0) await gameRef.update(updates);
  }

  // === REVEAL (combined with leaderboard) ===
  function enterReveal() {
    const q = questions[currentQIndex];
    const isMap = isMapRound(q.round);
    const isDouble = isDoublePointsQuestion(currentQIndex, questions);

    showScreen('screen-reveal');

    // Double points
    $('reveal-double-badge').style.display = isDouble ? 'block' : 'none';
    $('reveal-q-text').textContent = q.text;

    // Left: answer details
    if (isMap) {
      $('reveal-choices').innerHTML = '';
      $('answer-bars').innerHTML = '';
    } else {
      $('reveal-choices').innerHTML = q.choices.map((c, i) => {
        const cls = i === q.correctIndex ? 'correct' : 'wrong';
        return '<div class="host-choice ' + cls + '" style="background:' + ANSWER_COLORS[i].bg + '">' +
          '<span class="shape">' + ANSWER_COLORS[i].shape + '</span> ' + escapeHtml(c) + '</div>';
      }).join('');
      $('answer-bars').innerHTML = '';
    }

    // Map
    if (q.location && q.location.lat) {
      $('reveal-map').style.display = 'block';
      setTimeout(() => {
        if (leafletMap) leafletMap.remove();
        leafletMap = initMap('reveal-map', q.location.lat, q.location.lng);
        addMarker(leafletMap, q.location.lat, q.location.lng,
          q.location.city + ', ' + q.location.country);
      }, 100);
    } else {
      $('reveal-map').style.display = 'none';
    }

    // Fun fact
    if (q.funFact) {
      $('reveal-fun-fact').textContent = q.funFact;
      $('reveal-fun-fact').style.display = 'block';
    } else {
      $('reveal-fun-fact').style.display = 'none';
    }

    // Right: leaderboard
    renderLeaderboard('leaderboard-list', players, 8);

    // Next button + auto-advance
    const isLast = currentQIndex >= questions.length - 1;
    const nextBtn = $('btn-next-question');
    clearTimeout(revealTimeout);
    clearInterval(revealCountdownInterval);

    function advanceToNext() {
      clearTimeout(revealTimeout);
      clearInterval(revealCountdownInterval);
      if (leafletMap) { leafletMap.remove(); leafletMap = null; }
      if (isLast) {
        transitionTo(STATES.FINISHED);
      } else {
        const nextQ = questions[currentQIndex + 1];
        const currentQ = questions[currentQIndex];
        const isNewRound = nextQ && nextQ.round !== currentQ.round;
        currentQIndex++;
        gameRef.update({ currentQuestionIndex: currentQIndex });
        if (isNewRound) {
          showRoundInterstitial(nextQ.round, () => transitionTo(STATES.QUESTION));
        } else {
          transitionTo(STATES.QUESTION);
        }
      }
    }

    nextBtn.textContent = isLast ? 'Show Final Results 🏆' : 'Next Question →';
    nextBtn.onclick = advanceToNext;

    // Auto-advance countdown (20 seconds)
    const countdownEl = $('reveal-countdown');
    let revealSecondsLeft = 20;
    if (countdownEl) {
      countdownEl.textContent = revealSecondsLeft + 's';
      countdownEl.style.display = 'inline-block';
    }
    revealCountdownInterval = setInterval(() => {
      revealSecondsLeft--;
      if (countdownEl) countdownEl.textContent = revealSecondsLeft + 's';
      if (revealSecondsLeft <= 0) clearInterval(revealCountdownInterval);
    }, 1000);
    revealTimeout = setTimeout(advanceToNext, 20000);
  }

  // === FINISHED ===
  function enterFinished() {
    showScreen('screen-finished');
    const sorted = Object.entries(players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    if (sorted.length > 0) $('winner-text').textContent = '🎉 ' + sorted[0].name + ' Wins! 🎉';

    const podiumData = [
      { place: 1, class: 'gold', trophy: '🥇', player: sorted[0] },
      { place: 2, class: 'silver', trophy: '🥈', player: sorted[1] },
      { place: 3, class: 'bronze', trophy: '🥉', player: sorted[2] }
    ].filter(p => p.player);

    const displayOrder = [podiumData[1], podiumData[0], podiumData[2]].filter(Boolean);
    $('podium').innerHTML = displayOrder.map(p =>
      '<div class="podium-place animate-scale-in">' +
        '<div class="podium-trophy">' + p.trophy + '</div>' +
        '<div class="podium-name">' + escapeHtml(p.player.name) + '</div>' +
        '<div class="podium-bar ' + p.class + '">' +
          '<div class="podium-score">' + formatPoints(p.player.score || 0) + '</div>' +
        '</div>' +
      '</div>'
    ).join('');

    renderLeaderboard('final-leaderboard', players, 50);
    createConfetti();
  }

  function createConfetti() {
    const container = $('confetti-container');
    container.innerHTML = '';
    const colors = ['#E21B3C', '#1368CE', '#D89E00', '#26890C', '#E85D3A', '#F2A922'];
    for (let i = 0; i < 80; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 2 + 's';
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      container.appendChild(piece);
    }
  }

  function showRoundInterstitial(round, callback) {
    const roundIdx = ROUND_ORDER.indexOf(round) + 1;
    $('round-number').textContent = 'Round ' + roundIdx;
    $('round-name').textContent = (ROUND_ICONS[round] || '') + ' ' + (ROUND_LABELS[round] || round);
    const el = $('round-interstitial');
    el.classList.add('active');
    setTimeout(() => { el.classList.remove('active'); callback(); }, 3000);
  }

  $('btn-play-again').addEventListener('click', () => window.location.reload());

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  createGame();
})();
