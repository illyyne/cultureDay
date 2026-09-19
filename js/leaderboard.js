function renderLeaderboard(containerId, players, maxEntries) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sorted = Object.entries(players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, maxEntries || 5);

  const maxScore = sorted.length > 0 ? (sorted[0].score || 1) : 1;

  container.innerHTML = sorted.map((p, i) => {
    const rank = i + 1;
    let rankDisplay = '#' + rank;
    if (rank === 1) rankDisplay = '🥇';
    else if (rank === 2) rankDisplay = '🥈';
    else if (rank === 3) rankDisplay = '🥉';

    const pointsChange = p.lastPoints > 0 ? '+' + p.lastPoints.toLocaleString() : '';

    return '<div class="leaderboard-entry" style="animation-delay:' + (i * 0.1) + 's">' +
      '<div class="leaderboard-rank">' + rankDisplay + '</div>' +
      '<div class="leaderboard-name">' + escapeHtmlLB(p.name) + '</div>' +
      '<div>' +
        '<div class="leaderboard-score">' + (p.score || 0).toLocaleString() + '</div>' +
        (pointsChange ? '<div class="leaderboard-points-change">' + pointsChange + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function escapeHtmlLB(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
