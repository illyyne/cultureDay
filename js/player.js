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

  const $ = id => document.getElementById(id);

  // Pre-fill game code from URL
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl) {
    $('game-code-input').value = codeFromUrl.toUpperCase();
  }

  // === JOIN ===
  $('btn-join').addEventListener('click', joinGame);
  $('player-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
  $('game-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('player-name-input').focus(); });

  async function joinGame() {
    const code = $('game-code-input').value.trim().toUpperCase();
    const name = $('player-name-input').value.trim();

    $('join-error').textContent = '';

    if (!code || code.length < 4) {
      $('join-error').textContent = 'Enter a valid game code';
      return;
    }
    if (!name) {
      $('join-error').textContent = 'Enter your name';
      return;
    }

    $('btn-join').disabled = true;

    // Check game exists
    const gameSnap = await db.ref('games/' + code).once('value');
    if (!gameSnap.exists()) {
      $('join-error').textContent = 'Game not found';
      $('btn-join').disabled = false;
      return;
    }

    const gameData = gameSnap.val();
    if (gameData.state !== STATES.LOBBY) {
      $('join-error').textContent = 'Game already in progress';
      $('btn-join').disabled = false;
      return;
    }

    // Check name taken
    const playersSnap = await db.ref('games/' + code + '/players').once('value');
    const existingPlayers = playersSnap.val() || {};
    const nameTaken = Object.values(existingPlayers).some(p => p.name.toLowerCase() === name.toLowerCase());
    if (nameTaken) {
      $('join-error').textContent = 'Name already taken';
      $('btn-join').disabled = false;
      return;
    }

    gameCode = code;
    gameRef = db.ref('games/' + gameCode);
    playerName = name;

    await gameRef.child('players/' + playerId).set({
      name: playerName,
      score: 0,
      streak: 0,
      lastPoints: 0,
      lastCorrect: false,
      joinedAt: firebase.database.ServerValue.TIMESTAMP
    });

    $('player-display-name').textContent = playerName;
    showScreen('screen-lobby');
    listenForGameState();
    listenForPlayerCount();
    requestWakeLock();
  }

  // === LISTEN FOR STATE CHANGES ===
  function listenForGameState() {
    gameRef.on('value', snap => {
      const game = snap.val();
      if (!game) return;

      const newState = game.state;
      if (newState === currentState) return;
      currentState = newState;

      switch (newState) {
        case STATES.LOBBY:
          showScreen('screen-lobby');
          break;
        case STATES.QUESTION:
          enterQuestion(game);
          break;
        case STATES.ANSWERS:
          // Stay on answered screen, score is being computed
          break;
        case STATES.REVEAL:
          enterFeedback(game);
          break;
        case STATES.LEADERBOARD:
          enterRank(game);
          break;
        case STATES.FINISHED:
          enterFinished(game);
          break;
      }
    });
  }

  function listenForPlayerCount() {
    gameRef.child('players').on('value', snap => {
      const count = snap.numChildren();
      $('wait-player-count').textContent = count + ' player' + (count !== 1 ? 's' : '') + ' joined';
    });
  }

  // === QUESTION STATE ===
  function enterQuestion(game) {
    hasAnswered = false;
    showScreen('screen-question');

    const qIndex = game.currentQuestionIndex || 0;
    const questionIds = game.questionIds || [];
    const roundLabel = ROUND_LABELS[game.currentRound] || '';

    $('p-round-info').textContent = roundLabel + ' — Question ' + (qIndex + 1) + '/' + questionIds.length;

    // Load question data
    db.ref('questions/' + questionIds[qIndex]).once('value').then(snap => {
      const q = snap.val();
      if (!q) return;

      $('p-question-text').textContent = q.text;

      const grid = $('p-answer-grid');
      grid.innerHTML = q.choices.map((c, i) =>
        '<button class="answer-btn" data-index="' + i + '" style="background:' + ANSWER_COLORS[i].bg + '">' +
          '<span class="shape">' + ANSWER_COLORS[i].shape + '</span>' +
          '<span>' + escapeHtml(c) + '</span>' +
        '</button>'
      ).join('');

      grid.querySelectorAll('.answer-btn').forEach(btn => {
        btn.addEventListener('click', () => submitAnswer(parseInt(btn.dataset.index), game));
      });
    });

    // Timer
    startPlayerTimer(game.timerEnd, game.timerDuration || 20);
  }

  function startPlayerTimer(timerEnd, duration) {
    clearInterval(timerInterval);
    const el = $('p-timer');
    const elWait = $('p-timer-wait');

    function tick() {
      const now = getServerTime();
      const remaining = Math.max(0, Math.ceil((timerEnd - now) / 1000));
      el.textContent = remaining;
      elWait.textContent = remaining;

      if (remaining <= 5) {
        el.classList.add('urgent');
      } else {
        el.classList.remove('urgent');
      }

      if (remaining <= 0) {
        clearInterval(timerInterval);
      }
    }

    tick();
    timerInterval = setInterval(tick, 250);
  }

  async function submitAnswer(choiceIndex, game) {
    if (hasAnswered) return;
    hasAnswered = true;

    const qIndex = game.currentQuestionIndex || 0;

    // Disable all buttons immediately
    $('p-answer-grid').querySelectorAll('.answer-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (i === choiceIndex) btn.classList.add('selected');
    });

    try {
      await gameRef.child('answers/' + qIndex + '/' + playerId).set({
        choiceIndex,
        answeredAt: getServerTime()
      });
    } catch (err) {
      console.error('Answer submit failed:', err);
    }

    showScreen('screen-answered');
  }

  // === FEEDBACK STATE ===
  function enterFeedback(game) {
    showScreen('screen-feedback');

    // Read own player data for score update
    gameRef.child('players/' + playerId).once('value').then(snap => {
      const player = snap.val();
      if (!player) return;

      const isCorrect = player.lastCorrect;
      const points = player.lastPoints || 0;

      const fbScreen = $('screen-feedback');
      fbScreen.classList.remove('correct', 'wrong');
      fbScreen.classList.add(isCorrect ? 'correct' : 'wrong');

      $('fb-icon').textContent = isCorrect ? '✅' : '❌';
      $('fb-result').textContent = isCorrect ? 'Correct!' : 'Wrong!';
      $('fb-result').className = 'feedback-result ' + (isCorrect ? 'correct' : 'wrong');
      $('fb-points').textContent = isCorrect ? '+' + formatPoints(points) : '0';

      // Streak
      if (player.streak >= SCORING.STREAK_THRESHOLD) {
        $('fb-streak').textContent = '🔥 ' + player.streak + ' in a row!';
        $('fb-streak').style.display = 'inline-flex';
      } else {
        $('fb-streak').style.display = 'none';
      }

      // Show correct answer if wrong
      if (!isCorrect) {
        const qIndex = game.currentQuestionIndex || 0;
        const questionIds = game.questionIds || [];
        db.ref('questions/' + questionIds[qIndex]).once('value').then(qSnap => {
          const q = qSnap.val();
          if (q) {
            $('fb-correct').textContent = 'Answer: ' + q.choices[q.correctIndex];
          }
        });
      } else {
        $('fb-correct').textContent = '';
      }
    });
  }

  // === RANK STATE ===
  function enterRank(game) {
    showScreen('screen-rank');

    gameRef.child('players').orderByChild('score').once('value').then(snap => {
      const sorted = [];
      snap.forEach(child => {
        sorted.push({ id: child.key, ...child.val() });
      });
      sorted.reverse();

      const myIndex = sorted.findIndex(p => p.id === playerId);
      const myPlayer = sorted[myIndex];

      $('rank-position').textContent = '#' + (myIndex + 1);
      $('rank-of').textContent = 'out of ' + sorted.length;
      $('rank-score').textContent = formatPoints(myPlayer ? myPlayer.score || 0 : 0) + ' pts';
    });
  }

  // === FINISHED STATE ===
  function enterFinished(game) {
    showScreen('screen-finished');

    gameRef.child('players').orderByChild('score').once('value').then(snap => {
      const sorted = [];
      snap.forEach(child => {
        sorted.push({ id: child.key, ...child.val() });
      });
      sorted.reverse();

      const myIndex = sorted.findIndex(p => p.id === playerId);
      const rank = myIndex + 1;

      let trophy = '🎮';
      let message = 'Thanks for playing!';
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

  // === WAKE LOCK ===
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      // Wake lock not supported or denied
    }
  }

  // === UTILS ===
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();
