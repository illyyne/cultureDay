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
  FOOD: 'food'
};

const ROUND_LABELS = {
  photos: 'Photos & Places',
  music: 'Music & Rhythm',
  food: 'Food & Cuisine'
};

const ROUND_ORDER = ['photos', 'music', 'food'];

const SCORING = {
  BASE_POINTS: 1000,
  MAX_SPEED_BONUS: 500,
  STREAK_THRESHOLD: 3,
  STREAK_BONUS: 100,
  DEFAULT_TIMER_DURATION: 20
};

const ANSWER_COLORS = [
  { bg: '#E21B3C', label: 'A', shape: '▲' },
  { bg: '#1368CE', label: 'B', shape: '◆' },
  { bg: '#D89E00', label: 'C', shape: '●' },
  { bg: '#26890C', label: 'D', shape: '■' }
];

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
