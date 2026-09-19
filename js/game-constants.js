const STATES = {
  LOBBY: 'lobby',
  QUESTION: 'question',
  ANSWERS: 'answers',
  REVEAL: 'reveal',
  LEADERBOARD: 'leaderboard',
  FINISHED: 'finished'
};

const ROUNDS = {
  PHOTOS: 'photos',
  MUSIC: 'music',
  FOOD: 'food',
  HISTORY: 'history',
  GEOGRAPHY: 'geography',
  TRADITIONS: 'traditions',
  CLOTHES: 'clothes'
};

const ROUND_LABELS = {
  photos: 'Photos & Places',
  music: 'Music & Instruments',
  food: 'Food & Cuisine',
  history: 'History',
  geography: 'Geography',
  traditions: 'Traditions & Festivals',
  clothes: 'Clothes & Fashion'
};

const ROUND_ICONS = {
  photos: '📸',
  music: '🎵',
  food: '🍜',
  history: '📜',
  geography: '🌍',
  traditions: '🎭',
  clothes: '👘'
};

const ROUND_ORDER = ['photos', 'music', 'food', 'history', 'geography', 'traditions', 'clothes'];

const MAP_ROUNDS = ['photos', 'geography'];

const QUESTIONS_PER_ROUND = 5;

function isMapRound(round) {
  return MAP_ROUNDS.includes(round);
}

const SCORING = {
  BASE_POINTS: 1000,
  MAX_SPEED_BONUS: 500,
  STREAK_THRESHOLD: 3,
  STREAK_BONUS: 100,
  DEFAULT_TIMER_DURATION: 20,
  MAP_TIMER_DURATION: 30,
  DOUBLE_POINTS_MULTIPLIER: 2
};

const DISTANCE_SCORING = [
  { maxKm: 50,   points: 1500 },
  { maxKm: 200,  points: 1200 },
  { maxKm: 500,  points: 900 },
  { maxKm: 1000, points: 600 },
  { maxKm: 2000, points: 300 },
  { maxKm: Infinity, points: 100 }
];

const DISTANCE_FEEDBACK = [
  { maxKm: 50,   label: 'Perfect!', emoji: '🎯' },
  { maxKm: 200,  label: 'Very close!', emoji: '🔥' },
  { maxKm: 500,  label: 'Not bad!', emoji: '👍' },
  { maxKm: 1500, label: 'Far!', emoji: '😬' },
  { maxKm: Infinity, label: 'Way off!', emoji: '🌍' }
];

const ANSWER_COLORS = [
  { bg: '#E21B3C', label: 'A', shape: '▲' },
  { bg: '#1368CE', label: 'B', shape: '◆' },
  { bg: '#D89E00', label: 'C', shape: '●' },
  { bg: '#26890C', label: 'D', shape: '■' }
];

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateDistanceScore(distanceKm) {
  for (const tier of DISTANCE_SCORING) {
    if (distanceKm <= tier.maxKm) return tier.points;
  }
  return 100;
}

function getDistanceFeedback(distanceKm) {
  for (const tier of DISTANCE_FEEDBACK) {
    if (distanceKm <= tier.maxKm) return tier;
  }
  return DISTANCE_FEEDBACK[DISTANCE_FEEDBACK.length - 1];
}

function calculateScore(isCorrect, responseTimeMs, timerDurationMs, currentStreak) {
  if (!isCorrect) {
    return { points: 0, newStreak: 0, breakdown: { base: 0, speed: 0, streak: 0 } };
  }

  const base = SCORING.BASE_POINTS;
  const clampedTime = Math.max(0, Math.min(responseTimeMs, timerDurationMs));
  const speedFraction = 1 - (clampedTime / timerDurationMs);
  const speed = Math.round(SCORING.MAX_SPEED_BONUS * speedFraction);

  const newStreak = currentStreak + 1;
  const streak = newStreak >= SCORING.STREAK_THRESHOLD ? SCORING.STREAK_BONUS : 0;

  return {
    points: base + speed + streak,
    newStreak,
    breakdown: { base, speed, streak }
  };
}

function calculateMapScore(distanceKm, responseTimeMs, timerDurationMs, currentStreak) {
  const base = calculateDistanceScore(distanceKm);
  const clampedTime = Math.max(0, Math.min(responseTimeMs, timerDurationMs));
  const speedFraction = 1 - (clampedTime / timerDurationMs);
  const speed = Math.round(200 * speedFraction);

  const isGood = distanceKm <= 500;
  const newStreak = isGood ? currentStreak + 1 : 0;
  const streak = newStreak >= SCORING.STREAK_THRESHOLD ? SCORING.STREAK_BONUS : 0;

  return {
    points: base + speed + streak,
    newStreak,
    distanceKm: Math.round(distanceKm),
    breakdown: { base, speed, streak }
  };
}

function isDoublePointsQuestion(questionIndex, questions) {
  if (questionIndex < 0 || questionIndex >= questions.length) return false;
  const q = questions[questionIndex];
  const roundQuestions = questions.filter(qq => qq.round === q.round);
  const indexInRound = roundQuestions.indexOf(q);
  return indexInRound === roundQuestions.length - 1;
}

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

function formatPoints(pts) {
  return pts.toLocaleString();
}
