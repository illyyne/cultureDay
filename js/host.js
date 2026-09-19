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
  let currentMarker = null;

  // DOM refs
  const $ = id => document.getElementById(id);

  // === LOBBY ===
  async function createGame() {
    gameCode = generateGameCode();
    gameRef = db.ref('games/' + gameCode);

    const exists = (await gameRef.once('value')).exists();
    if (exists) {
      gameCode = generateGameCode();
      gameRef = db.ref('games/' + gameCode);
    }

    await gameRef.set({
      hostId,
      state: STATES.LOBBY,
      currentQuestionIndex: 0,
      questionIds: [],
      currentRound: '',
      timerEnd: 0,
      timerDuration: 20,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    $('game-code-display').textContent = gameCode;
    generateQRCode();
    listenForPlayers();
  }

  function generateQRCode() {
    const url = window.location.href.replace('host.html', '') + '?code=' + gameCode;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qrcode').innerHTML = qr.createSvgTag(5, 0);
  }

  function listenForPlayers() {
    gameRef.child('players').on('value', snap => {
      players = snap.val() || {};
      const names = Object.values(players).map(p => p.name);
      $('player-count').textContent = names.length + ' player' + (names.length !== 1 ? 's' : '') + ' joined';
      $('player-chips').innerHTML = names.map(n =>
        '<span class="player-chip">' + escapeHtml(n) + '</span>'
      ).join('');
      $('btn-start').disabled = names.length < 1;
    });
  }

  // === LOAD QUESTIONS ===
  async function loadQuestions() {
    const snap = await db.ref('questions').orderByChild('order').once('value');
    const all = [];
    snap.forEach(child => {
      all.push({ id: child.key, ...child.val() });
    });

    const byRound = {};
    ROUND_ORDER.forEach(r => { byRound[r] = []; });
    all.forEach(q => {
      if (byRound[q.round]) byRound[q.round].push(q);
    });

    questions = [];
    ROUND_ORDER.forEach(r => {
      byRound[r].sort((a, b) => (a.order || 0) - (b.order || 0));
      questions.push(...byRound[r]);
    });

    return questions.map(q => q.id);
  }

  // === START GAME ===
  $('btn-start').addEventListener('click', async () => {
    $('btn-start').disabled = true;
    timerDuration = parseInt($('timer-select').value);

    const questionIds = await loadQuestions();
    if (questionIds.length === 0) {
      alert('No questions found! Add questions in the admin panel first.');
      $('btn-start').disabled = false;
      return;
    }

    await gameRef.update({
      questionIds,
      timerDuration,
      currentQuestionIndex: 0
    });

    currentQIndex = 0;
    showRoundInterstitial(questions[0].round, () => {
      transitionTo(STATES.QUESTION);
    });
  });

  // === STATE MACHINE ===
  async function transitionTo(state) {
    await gameRef.update({ state });

    switch (state) {
      case STATES.QUESTION: enterQuestion(); break;
      case STATES.ANSWERS: enterAnswers(); break;
      case STATES.REVEAL: enterReveal(); break;
      case STATES.LEADERBOARD: enterLeaderboard(); break;
      case STATES.FINISHED: enterFinished(); break;
    }
  }

  // === QUESTION STATE ===
  function enterQuestion() {
    const q = questions[currentQIndex];
    if (!q) return transitionTo(STATES.FINISHED);

    showScreen('screen-question');

    $('q-round-badge').textContent = ROUND_LABELS[q.round] || q.round;
    $('q-counter').textContent = (currentQIndex + 1) + ' of ' + questions.length;
    $('q-text').textContent = q.text;

    // Media
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

    // Choices
    $('q-choices').innerHTML = q.choices.map((c, i) =>
      '<div class="host-choice" style="background:' + ANSWER_COLORS[i].bg + '">' +
        '<span class="shape">' + ANSWER_COLORS[i].shape + '</span> ' +
        escapeHtml(c) +
      '</div>'
    ).join('');

    // Answer counter
    const playerCount = Object.keys(players).length;
    $('total-players').textContent = playerCount;
    $('answered-count').textContent = '0';
    $('q-answer-count').style.display = 'flex';

    // Timer
    const timerMs = timerDuration * 1000;
    const timerEnd = getServerTime() + timerMs;
    gameRef.update({
      timerEnd,
      currentQuestionIndex: currentQIndex,
      currentRound: q.round
    });

    startTimer(timerDuration);
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

      if (remaining <= 5) {
        $('timer-progress').style.stroke = 'var(--color-wrong)';
      } else {
        $('timer-progress').style.stroke = 'var(--color-accent)';
      }

      if (remaining <= 0) {
        clearInterval(timerInterval);
        transitionTo(STATES.ANSWERS);
      }
    }, 1000);
  }

  function listenForAnswers() {
    if (answerListener) answerListener();
    const ref = gameRef.child('answers/' + currentQIndex);
    const handler = ref.on('value', snap => {
      const answers = snap.val() || {};
      const count = Object.keys(answers).length;
      $('answered-count').textContent = count;

      const playerCount = Object.keys(players).length;
      if (count >= playerCount && playerCount > 0) {
        clearInterval(timerInterval);
        transitionTo(STATES.ANSWERS);
      }
    });
    answerListener = () => ref.off('value', handler);
  }

  // === ANSWERS STATE ===
  async function enterAnswers() {
    if (answerListener) { answerListener(); answerListener = null; }

    const q = questions[currentQIndex];
    showScreen('screen-answers');
    $('answers-q-text').textContent = q.text;

    // Stop audio
    const audio = $('q-audio');
    if (audio && !audio.paused) audio.pause();

    // Read answers
    const snap = await gameRef.child('answers/' + currentQIndex).once('value');
    const answers = snap.val() || {};

    // Count per choice
    const counts = [0, 0, 0, 0];
    Object.values(answers).forEach(a => {
      if (a.choiceIndex >= 0 && a.choiceIndex < 4) counts[a.choiceIndex]++;
    });

    const maxCount = Math.max(...counts, 1);
    $('answer-bars').innerHTML = q.choices.map((c, i) =>
      '<div class="answer-bar-row">' +
        '<div class="answer-bar-label" style="color:' + ANSWER_COLORS[i].bg + '">' +
          ANSWER_COLORS[i].shape + ' ' + ANSWER_COLORS[i].label +
        '</div>' +
        '<div class="answer-bar" style="background:' + ANSWER_COLORS[i].bg +
          ';width:' + (counts[i] / maxCount * 100) + '%">' +
          counts[i] +
        '</div>' +
      '</div>'
    ).join('');

    // Compute scores
    await computeScores(q, answers);

    setTimeout(() => transitionTo(STATES.REVEAL), 3000);
  }

  async function computeScores(question, answers) {
    const timerMs = timerDuration * 1000;
    const updates = {};

    for (const [playerId, answer] of Object.entries(answers)) {
      const player = players[playerId];
      if (!player) continue;

      const isCorrect = answer.choiceIndex === question.correctIndex;
      const responseTime = answer.answeredAt ? (answer.answeredAt - (getServerTime() - timerMs)) : timerMs;
      const currentStreak = player.streak || 0;

      const result = calculateScore(isCorrect, Math.max(0, responseTime), timerMs, currentStreak);

      updates['players/' + playerId + '/score'] = (player.score || 0) + result.points;
      updates['players/' + playerId + '/streak'] = result.newStreak;
      updates['players/' + playerId + '/lastPoints'] = result.points;
      updates['players/' + playerId + '/lastCorrect'] = isCorrect;
    }

    // Players who didn't answer
    for (const [playerId, player] of Object.entries(players)) {
      if (!answers[playerId]) {
        updates['players/' + playerId + '/streak'] = 0;
        updates['players/' + playerId + '/lastPoints'] = 0;
        updates['players/' + playerId + '/lastCorrect'] = false;
      }
    }

    if (Object.keys(updates).length > 0) {
      await gameRef.update(updates);
    }
  }

  // === REVEAL STATE ===
  function enterReveal() {
    const q = questions[currentQIndex];
    showScreen('screen-reveal');

    $('reveal-q-text').textContent = q.text;

    $('reveal-choices').innerHTML = q.choices.map((c, i) => {
      const isCorrect = i === q.correctIndex;
      const cls = isCorrect ? 'correct' : 'wrong';
      return '<div class="host-choice ' + cls + '" style="background:' + ANSWER_COLORS[i].bg + '">' +
        '<span class="shape">' + ANSWER_COLORS[i].shape + '</span> ' +
        escapeHtml(c) +
      '</div>';
    }).join('');

    // Map
    if (q.location && q.location.lat) {
      $('reveal-map').style.display = 'block';
      setTimeout(() => {
        if (leafletMap) leafletMap.remove();
        leafletMap = initMap('reveal-map', q.location.lat, q.location.lng);
        currentMarker = addMarker(leafletMap, q.location.lat, q.location.lng,
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
  }

  $('btn-show-leaderboard').addEventListener('click', () => {
    transitionTo(STATES.LEADERBOARD);
  });

  // === LEADERBOARD STATE ===
  function enterLeaderboard() {
    showScreen('screen-leaderboard');
    renderLeaderboard('leaderboard-list', players, 5);

    const isLast = currentQIndex >= questions.length - 1;
    const nextBtn = $('btn-next-question');

    if (isLast) {
      nextBtn.textContent = 'Show Final Results 🏆';
      nextBtn.onclick = () => transitionTo(STATES.FINISHED);
    } else {
      const nextQ = questions[currentQIndex + 1];
      const currentQ = questions[currentQIndex];
      const isNewRound = nextQ && nextQ.round !== currentQ.round;

      nextBtn.textContent = 'Next Question →';
      nextBtn.onclick = () => {
        currentQIndex++;
        gameRef.update({ currentQuestionIndex: currentQIndex });

        if (isNewRound) {
          showRoundInterstitial(nextQ.round, () => {
            transitionTo(STATES.QUESTION);
          });
        } else {
          transitionTo(STATES.QUESTION);
        }
      };
    }
  }

  // === FINISHED STATE ===
  function enterFinished() {
    showScreen('screen-finished');

    const sorted = Object.entries(players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    // Winner text
    if (sorted.length > 0) {
      $('winner-text').textContent = '🎉 ' + sorted[0].name + ' Wins! 🎉';
    }

    // Podium
    const podiumData = [
      { place: 1, class: 'gold', trophy: '🥇', player: sorted[0] },
      { place: 2, class: 'silver', trophy: '🥈', player: sorted[1] },
      { place: 3, class: 'bronze', trophy: '🥉', player: sorted[2] }
    ].filter(p => p.player);

    // Display order: silver(2), gold(1), bronze(3)
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

  // === ROUND INTERSTITIAL ===
  function showRoundInterstitial(round, callback) {
    const roundIdx = ROUND_ORDER.indexOf(round) + 1;
    $('round-number').textContent = 'Round ' + roundIdx;
    $('round-name').textContent = ROUND_LABELS[round] || round;

    const el = $('round-interstitial');
    el.classList.add('active');

    setTimeout(() => {
      el.classList.remove('active');
      callback();
    }, 3000);
  }

  // === PLAY AGAIN ===
  $('btn-play-again').addEventListener('click', () => {
    window.location.reload();
  });

  // === UTILS ===
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Init
  createGame();
})();
