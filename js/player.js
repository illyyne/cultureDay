(async function () {
  const playerId = await signInAnonymously();
  if (!playerId) return alert('Authentication failed. Please refresh.');

  let gameCode = null;
  let gameRef = null;
  let playerName = '';
  let hasAnswered = false;
  let timerInterval = null;
  let currentState = null;
  let wakeLock = null;
  let playerMap = null;
  let playerMarker = null;
  let currentQuestionData = null;

  const $ = id => document.getElementById(id);

  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl) $('game-code-input').value = codeFromUrl.toUpperCase();

  // === JOIN ===
  $('btn-join').addEventListener('click', joinGame);
  $('player-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
  $('game-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('player-name-input').focus(); });

  async function joinGame() {
    const code = $('game-code-input').value.trim().toUpperCase();
    const name = $('player-name-input').value.trim();
    $('join-error').textContent = '';

    if (!code || code.length < 4) { $('join-error').textContent = 'Enter a valid game code'; return; }
    if (!name) { $('join-error').textContent = 'Enter your name'; return; }

    $('btn-join').disabled = true;

    const gameSnap = await db.ref('games/' + code).once('value');
    if (!gameSnap.exists()) { $('join-error').textContent = 'Game not found'; $('btn-join').disabled = false; return; }

    const gameData = gameSnap.val();
    if (gameData.state !== STATES.LOBBY) { $('join-error').textContent = 'Game already in progress'; $('btn-join').disabled = false; return; }

    const playersSnap = await db.ref('games/' + code + '/players').once('value');
    const existing = playersSnap.val() || {};
    if (Object.values(existing).some(p => p.name.toLowerCase() === name.toLowerCase())) {
      $('join-error').textContent = 'Name already taken'; $('btn-join').disabled = false; return;
    }

    gameCode = code;
    gameRef = db.ref('games/' + gameCode);
    playerName = name;

    await gameRef.child('players/' + playerId).set({
      name: playerName, score: 0, streak: 0,
      lastPoints: 0, lastCorrect: false, lastDistance: null,
      joinedAt: firebase.database.ServerValue.TIMESTAMP
    });

    $('player-display-name').textContent = playerName;
    showScreen('screen-lobby');
    listenForGameState();
    listenForPlayerCount();
    requestWakeLock();
  }

  // === LISTEN ===
  function listenForGameState() {
    gameRef.on('value', snap => {
      const game = snap.val();
      if (!game) return;
      const newState = game.state;
      if (newState === currentState) return;
      currentState = newState;

      switch (newState) {
        case STATES.LOBBY: showScreen('screen-lobby'); break;
        case STATES.QUESTION: enterQuestion(game); break;
        case STATES.REVEAL: enterFeedback(game); break;
        case STATES.FINISHED: enterFinished(game); break;
      }
    });
  }

  function listenForPlayerCount() {
    gameRef.child('players').on('value', snap => {
      const count = snap.numChildren();
      $('wait-player-count').textContent = count + ' player' + (count !== 1 ? 's' : '') + ' joined';
    });
  }

  // === QUESTION ===
  function enterQuestion(game) {
    hasAnswered = false;
    const qIndex = game.currentQuestionIndex || 0;
    const questionIds = game.questionIds || [];
    const round = game.currentRound;

    db.ref('questions/' + questionIds[qIndex]).once('value').then(snap => {
      const q = snap.val();
      if (!q) return;
      currentQuestionData = q;

      const roundLabel = (ROUND_ICONS[round] || '') + ' ' + (ROUND_LABELS[round] || round);
      const qNum = (qIndex + 1) + '/' + questionIds.length;
      const isDouble = game.isDoublePoints;

      if (isMapQuestion(q)) {
        enterMapQuestion(q, roundLabel, qNum, isDouble, game);
      } else {
        enterChoiceQuestion(q, roundLabel, qNum, isDouble, game);
      }
    });
  }

  function enterChoiceQuestion(q, roundLabel, qNum, isDouble, game) {
    showScreen('screen-question');
    $('p-round-info').textContent = roundLabel + ' — Question ' + qNum;
    $('p-question-text').textContent = q.text;
    $('p-double-badge').style.display = isDouble ? 'block' : 'none';

    const grid = $('p-answer-grid');
    grid.innerHTML = q.choices.map((c, i) =>
      '<button class="answer-btn" data-index="' + i + '" style="background:' + ANSWER_COLORS[i].bg + '">' +
        '<span class="shape">' + ANSWER_COLORS[i].shape + '</span>' +
        '<span>' + escapeHtml(c) + '</span>' +
      '</button>'
    ).join('');

    grid.querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('click', () => submitChoiceAnswer(parseInt(btn.dataset.index), game));
    });

    startPlayerTimer(game.timerEnd, game.timerDuration || SCORING.DEFAULT_TIMER_DURATION, 'p-timer');
  }

  function enterMapQuestion(q, roundLabel, qNum, isDouble, game) {
    showScreen('screen-question-map');
    $('p-map-round-info').textContent = roundLabel + ' — Question ' + qNum;
    $('p-map-question-text').textContent = q.text;
    $('p-map-double-badge').style.display = isDouble ? 'block' : 'none';
    $('btn-confirm-pin').disabled = true;

    if (playerMap) playerMap.remove();
    playerMarker = null;

    setTimeout(() => {
      playerMap = L.map('player-map').setView([20, 0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OSM', maxZoom: 18
      }).addTo(playerMap);

      playerMap.on('click', function (e) {
        if (hasAnswered) return;
        if (playerMarker) playerMap.removeLayer(playerMarker);
        playerMarker = L.marker(e.latlng).addTo(playerMap);
        $('btn-confirm-pin').disabled = false;
      });

      playerMap.invalidateSize();
    }, 100);

    $('btn-confirm-pin').onclick = () => {
      if (!playerMarker || hasAnswered) return;
      const ll = playerMarker.getLatLng();
      submitMapAnswer(ll.lat, ll.lng, game);
    };

    startPlayerTimer(game.timerEnd, game.timerDuration || SCORING.MAP_TIMER_DURATION, 'p-map-timer');
  }

  // === SUBMIT ANSWERS ===
  async function submitChoiceAnswer(choiceIndex, game) {
    if (hasAnswered) return;
    hasAnswered = true;

    $('p-answer-grid').querySelectorAll('.answer-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (i === choiceIndex) btn.classList.add('selected');
    });

    const qIndex = game.currentQuestionIndex || 0;
    try {
      await gameRef.child('answers/' + qIndex + '/' + playerId).set({
        choiceIndex, answeredAt: getServerTime()
      });
    } catch (e) { console.error('Answer failed:', e); }

    showScreen('screen-answered');
  }

  async function submitMapAnswer(lat, lng, game) {
    if (hasAnswered) return;
    hasAnswered = true;
    $('btn-confirm-pin').disabled = true;

    const qIndex = game.currentQuestionIndex || 0;
    try {
      await gameRef.child('answers/' + qIndex + '/' + playerId).set({
        lat, lng, answeredAt: getServerTime()
      });
    } catch (e) { console.error('Answer failed:', e); }

    showScreen('screen-answered');
  }

  // === TIMER ===
  function startPlayerTimer(timerEnd, duration, elementId) {
    clearInterval(timerInterval);
    const el = $(elementId);
    const elWait = $('p-timer-wait');

    function tick() {
      const remaining = Math.max(0, Math.ceil((timerEnd - getServerTime()) / 1000));
      if (el) el.textContent = remaining;
      if (elWait) elWait.textContent = remaining;
      if (el) {
        if (remaining <= 5) { el.classList.add('urgent'); } else { el.classList.remove('urgent'); }
      }
      if (remaining <= 0) clearInterval(timerInterval);
    }
    tick();
    timerInterval = setInterval(tick, 250);
  }

  // === FEEDBACK ===
  function enterFeedback(game) {
    showScreen('screen-feedback');
    const round = game.currentRound;

    gameRef.child('players/' + playerId).once('value').then(snap => {
      const player = snap.val();
      if (!player) return;

      const isCorrect = player.lastCorrect;
      const points = player.lastPoints || 0;
      const distance = player.lastDistance;
      const isMap = isMapQuestion(currentQuestionData);

      const fbScreen = $('screen-feedback');
      fbScreen.classList.remove('correct', 'wrong');

      if (isMap) {
        const feedback = distance !== null ? getDistanceFeedback(distance) : { emoji: '⏰', label: 'No answer!' };
        fbScreen.classList.add(distance !== null && distance <= 500 ? 'correct' : 'wrong');
        $('fb-icon').textContent = feedback.emoji;
        $('fb-result').textContent = feedback.label;
        $('fb-result').className = 'feedback-result ' + (distance !== null && distance <= 500 ? 'correct' : 'wrong');
        $('fb-distance').textContent = distance !== null ? Math.round(distance) + ' km away' : '';
        $('fb-distance').style.display = distance !== null ? 'block' : 'none';
      } else {
        fbScreen.classList.add(isCorrect ? 'correct' : 'wrong');
        $('fb-icon').textContent = isCorrect ? '✅' : '❌';
        $('fb-result').textContent = isCorrect ? 'Correct!' : 'Wrong!';
        $('fb-result').className = 'feedback-result ' + (isCorrect ? 'correct' : 'wrong');
        $('fb-distance').style.display = 'none';
      }

      const isDouble = game.isDoublePoints;
      $('fb-points').textContent = (isDouble ? '⚡ ' : '') + '+' + formatPoints(points);

      if (player.streak >= SCORING.STREAK_THRESHOLD) {
        $('fb-streak').textContent = '🔥 ' + player.streak + ' in a row!';
        $('fb-streak').style.display = 'inline-flex';
      } else {
        $('fb-streak').style.display = 'none';
      }

      if (!isCorrect && !isMap) {
        const qIndex = game.currentQuestionIndex || 0;
        const questionIds = game.questionIds || [];
        db.ref('questions/' + questionIds[qIndex]).once('value').then(qSnap => {
          const q = qSnap.val();
          if (q) $('fb-correct').textContent = 'Answer: ' + q.choices[q.correctIndex];
        });
      } else {
        $('fb-correct').textContent = isMap && currentQuestionData ?
          '📍 ' + (currentQuestionData.location.city || '') + ', ' + (currentQuestionData.location.country || '') : '';
      }

      // Show rank inline
      gameRef.child('players').orderByChild('score').once('value').then(rankSnap => {
        const sorted = [];
        rankSnap.forEach(child => { sorted.push({ id: child.key, ...child.val() }); });
        sorted.reverse();
        const myIndex = sorted.findIndex(p => p.id === playerId);
        $('fb-correct').textContent += '   |   Your rank: #' + (myIndex + 1) + ' / ' + sorted.length;
      });
    });
  }

  // === RANK ===
  function enterRank(game) {
    showScreen('screen-rank');
    gameRef.child('players').orderByChild('score').once('value').then(snap => {
      const sorted = [];
      snap.forEach(child => { sorted.push({ id: child.key, ...child.val() }); });
      sorted.reverse();
      const myIndex = sorted.findIndex(p => p.id === playerId);
      const myPlayer = sorted[myIndex];
      $('rank-position').textContent = '#' + (myIndex + 1);
      $('rank-of').textContent = 'out of ' + sorted.length;
      $('rank-score').textContent = formatPoints(myPlayer ? myPlayer.score || 0 : 0) + ' pts';
    });
  }

  // === FINISHED ===
  function enterFinished(game) {
    showScreen('screen-finished');
    gameRef.child('players').orderByChild('score').once('value').then(snap => {
      const sorted = [];
      snap.forEach(child => { sorted.push({ id: child.key, ...child.val() }); });
      sorted.reverse();
      const myIndex = sorted.findIndex(p => p.id === playerId);
      const rank = myIndex + 1;

      let trophy = '🎮', message = 'Thanks for playing!';
      if (rank === 1) { trophy = '🥇'; message = 'You are the champion!'; }
      else if (rank === 2) { trophy = '🥈'; message = 'Amazing runner-up!'; }
      else if (rank === 3) { trophy = '🥉'; message = 'Great job, bronze medalist!'; }
      else if (rank <= 5) { message = 'Top 5! Well played!'; }

      $('final-trophy').textContent = trophy;
      $('final-rank').textContent = '#' + rank;
      $('final-score').textContent = formatPoints(sorted[myIndex] ? sorted[myIndex].score || 0 : 0) + ' pts';
      $('final-message').textContent = message;
    });
  }

  // === UTILS ===
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();
