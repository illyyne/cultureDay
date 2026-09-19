(async function () {
  await signInAnonymously();

  let allQuestions = {};
  let activeRound = 'all';
  let editingId = null;

  const $ = id => document.getElementById(id);

  // === LOAD QUESTIONS ===
  function listenForQuestions() {
    db.ref('questions').on('value', snap => {
      allQuestions = {};
      snap.forEach(child => {
        allQuestions[child.key] = child.val();
      });
      renderQuestions();
    });
  }

  function renderQuestions() {
    const list = $('question-list');
    const filtered = Object.entries(allQuestions)
      .filter(([, q]) => activeRound === 'all' || q.round === activeRound)
      .sort((a, b) => {
        const roundDiff = ROUND_ORDER.indexOf(a[1].round) - ROUND_ORDER.indexOf(b[1].round);
        if (roundDiff !== 0) return roundDiff;
        return (a[1].order || 0) - (b[1].order || 0);
      });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">' +
        '<div class="empty-state-icon">📝</div>' +
        '<p class="empty-state-text">No questions yet. Add one or import from JSON.</p></div>';
      return;
    }

    list.innerHTML = filtered.map(([id, q]) => {
      const choices = (q.choices || []).map((c, i) =>
        '<div class="choice-item' + (i === q.correctIndex ? ' correct' : '') + '">' +
          ANSWER_COLORS[i].shape + ' ' + escapeHtml(c) +
        '</div>'
      ).join('');

      const mediaBadge = q.mediaType === 'photo' ? '📸' : q.mediaType === 'audio' ? '🎵' : '';
      const locationStr = q.location ? (q.location.city || '') + ', ' + (q.location.country || '') : '';

      return '<div class="question-card" data-id="' + id + '">' +
        '<div class="question-card-header">' +
          '<div class="question-card-text">' + escapeHtml(q.text) + '</div>' +
          '<span class="question-card-badge">' + (ROUND_LABELS[q.round] || q.round) + '</span>' +
        '</div>' +
        '<div class="question-card-choices">' + choices + '</div>' +
        '<div class="question-card-meta">' +
          (mediaBadge ? '<span>' + mediaBadge + ' Media attached</span>' : '') +
          (locationStr ? '<span>📍 ' + escapeHtml(locationStr) + '</span>' : '') +
          '<span>Order: ' + (q.order || 1) + '</span>' +
        '</div>' +
        '<div class="question-card-actions">' +
          '<button class="btn-sm" onclick="editQuestion(\'' + id + '\')">Edit</button>' +
          '<button class="btn-sm" onclick="duplicateQuestion(\'' + id + '\')">Duplicate</button>' +
          '<button class="btn-sm danger" onclick="deleteQuestion(\'' + id + '\')">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // === ROUND TABS ===
  document.querySelectorAll('.round-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.round-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeRound = tab.dataset.round;
      renderQuestions();
    });
  });

  // === MODAL ===
  function openModal(questionId) {
    editingId = questionId || null;
    $('form-edit-id').value = editingId || '';
    $('modal-title').textContent = editingId ? 'Edit Question' : 'Add Question';

    if (editingId && allQuestions[editingId]) {
      const q = allQuestions[editingId];
      $('form-round').value = q.round || 'photos';
      $('form-text').value = q.text || '';
      (q.choices || []).forEach((c, i) => {
        const el = $('form-choice-' + i);
        if (el) el.value = c;
      });
      document.querySelector('input[name="correct"][value="' + (q.correctIndex || 0) + '"]').checked = true;
      $('form-media-type').value = q.mediaType || '';
      $('form-media-url').value = q.mediaUrl || '';
      $('form-city').value = q.location ? q.location.city || '' : '';
      $('form-country').value = q.location ? q.location.country || '' : '';
      $('form-lat').value = q.location ? q.location.lat || '' : '';
      $('form-lng').value = q.location ? q.location.lng || '' : '';
      $('form-funfact').value = q.funFact || '';
      $('form-order').value = q.order || 1;
    } else {
      $('form-round').value = activeRound !== 'all' ? activeRound : 'photos';
      $('form-text').value = '';
      for (let i = 0; i < 4; i++) $('form-choice-' + i).value = '';
      document.querySelector('input[name="correct"][value="0"]').checked = true;
      $('form-media-type').value = '';
      $('form-media-url').value = '';
      $('form-city').value = '';
      $('form-country').value = '';
      $('form-lat').value = '';
      $('form-lng').value = '';
      $('form-funfact').value = '';
      $('form-order').value = 1;
    }

    toggleMediaInput();
    $('question-modal').classList.add('active');
  }

  function closeModal() {
    $('question-modal').classList.remove('active');
    editingId = null;
    $('media-preview-container').innerHTML = '';
  }

  $('btn-add').addEventListener('click', () => openModal());
  $('btn-cancel').addEventListener('click', closeModal);

  $('question-modal').addEventListener('click', e => {
    if (e.target === $('question-modal')) closeModal();
  });

  // === MEDIA TYPE TOGGLE ===
  $('form-media-type').addEventListener('change', toggleMediaInput);

  function toggleMediaInput() {
    const type = $('form-media-type').value;
    const fileInput = $('form-media-file');
    if (type) {
      fileInput.style.display = 'block';
      fileInput.accept = type === 'photo' ? 'image/*' : 'audio/*';
    } else {
      fileInput.style.display = 'none';
    }
  }

  // === MEDIA UPLOAD ===
  $('form-media-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !storage) return;

    const path = 'questions/' + Date.now() + '_' + file.name;
    const ref = storage.ref(path);

    try {
      $('btn-save').disabled = true;
      $('btn-save').textContent = 'Uploading...';
      const snap = await ref.put(file);
      const url = await snap.ref.getDownloadURL();
      $('form-media-url').value = url;

      const preview = $('media-preview-container');
      if (file.type.startsWith('image/')) {
        preview.innerHTML = '<img src="' + url + '" class="media-preview" alt="Preview">';
      } else {
        preview.innerHTML = '<audio controls src="' + url + '" style="margin-top:var(--space-2)"></audio>';
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      $('btn-save').disabled = false;
      $('btn-save').textContent = 'Save Question';
    }
  });

  // === SAVE ===
  $('btn-save').addEventListener('click', async () => {
    const text = $('form-text').value.trim();
    if (!text) return alert('Question text is required');

    const choices = [];
    for (let i = 0; i < 4; i++) {
      const val = $('form-choice-' + i).value.trim();
      if (!val) return alert('All 4 answers are required');
      choices.push(val);
    }

    const correctIndex = parseInt(document.querySelector('input[name="correct"]:checked').value);
    const lat = parseFloat($('form-lat').value) || null;
    const lng = parseFloat($('form-lng').value) || null;

    const data = {
      text,
      round: $('form-round').value,
      choices,
      correctIndex,
      mediaType: $('form-media-type').value || null,
      mediaUrl: $('form-media-url').value.trim() || null,
      location: {
        city: $('form-city').value.trim() || null,
        country: $('form-country').value.trim() || null,
        lat,
        lng
      },
      funFact: $('form-funfact').value.trim() || null,
      order: parseInt($('form-order').value) || 1,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    try {
      if (editingId) {
        await db.ref('questions/' + editingId).update(data);
      } else {
        data.createdAt = firebase.database.ServerValue.TIMESTAMP;
        await db.ref('questions').push(data);
      }
      closeModal();
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  });

  // === DELETE ===
  window.deleteQuestion = async function (id) {
    if (!confirm('Delete this question?')) return;
    await db.ref('questions/' + id).remove();
  };

  // === EDIT ===
  window.editQuestion = function (id) {
    openModal(id);
  };

  // === DUPLICATE ===
  window.duplicateQuestion = async function (id) {
    const q = allQuestions[id];
    if (!q) return;
    const copy = { ...q };
    delete copy.createdAt;
    copy.text = q.text + ' (copy)';
    copy.createdAt = firebase.database.ServerValue.TIMESTAMP;
    copy.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    await db.ref('questions').push(copy);
  };

  // === IMPORT ===
  $('btn-import').addEventListener('click', () => $('import-file').click());

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const questions = data.questions || data;

      if (!Array.isArray(questions)) {
        return alert('Invalid format. Expected { "questions": [...] } or [...]');
      }

      let count = 0;
      for (const q of questions) {
        q.createdAt = firebase.database.ServerValue.TIMESTAMP;
        q.updatedAt = firebase.database.ServerValue.TIMESTAMP;
        await db.ref('questions').push(q);
        count++;
      }

      alert('Imported ' + count + ' questions!');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }

    e.target.value = '';
  });

  // === EXPORT ===
  $('btn-export').addEventListener('click', () => {
    const questions = Object.values(allQuestions);
    const blob = new Blob([JSON.stringify({ questions }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'culture-day-questions.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // === SEED SAMPLE QUESTIONS ===
  $('btn-seed').addEventListener('click', async () => {
    if (!confirm('This will add sample questions. Continue?')) return;

    const seed = getSeedQuestions();
    let count = 0;
    for (const q of seed) {
      q.createdAt = firebase.database.ServerValue.TIMESTAMP;
      q.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      await db.ref('questions').push(q);
      count++;
    }
    alert('Added ' + count + ' sample questions!');
  });

  function getSeedQuestions() {
    return [
      {
        text: "Which country is the Taj Mahal located in?",
        round: "photos",
        choices: ["Pakistan", "India", "Bangladesh", "Nepal"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Agra", country: "India", lat: 27.1751, lng: 78.0421 },
        funFact: "The Taj Mahal was built between 1632 and 1653 by Mughal Emperor Shah Jahan.",
        order: 1
      },
      {
        text: "Where can you find the Machu Picchu ruins?",
        round: "photos",
        choices: ["Mexico", "Colombia", "Peru", "Bolivia"],
        correctIndex: 2,
        mediaType: null, mediaUrl: null,
        location: { city: "Cusco", country: "Peru", lat: -13.1631, lng: -72.545 },
        funFact: "Machu Picchu was built in the 15th century and was unknown to the outside world until 1911.",
        order: 2
      },
      {
        text: "Which country is the Great Wall located in?",
        round: "photos",
        choices: ["Japan", "South Korea", "China", "Mongolia"],
        correctIndex: 2,
        mediaType: null, mediaUrl: null,
        location: { city: "Beijing", country: "China", lat: 40.4319, lng: 116.5704 },
        funFact: "The Great Wall stretches over 21,000 km and was built over many centuries.",
        order: 3
      },
      {
        text: "The Colosseum is an iconic landmark of which city?",
        round: "photos",
        choices: ["Athens", "Rome", "Istanbul", "Barcelona"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Rome", country: "Italy", lat: 41.8902, lng: 12.4922 },
        funFact: "The Colosseum could hold between 50,000 and 80,000 spectators.",
        order: 4
      },
      {
        text: "Angkor Wat is a famous temple complex in which country?",
        round: "photos",
        choices: ["Thailand", "Vietnam", "Cambodia", "Laos"],
        correctIndex: 2,
        mediaType: null, mediaUrl: null,
        location: { city: "Siem Reap", country: "Cambodia", lat: 13.4125, lng: 103.8670 },
        funFact: "Angkor Wat is the largest religious monument in the world.",
        order: 5
      },
      {
        text: "Which country does Samba music originate from?",
        round: "music",
        choices: ["Argentina", "Brazil", "Cuba", "Portugal"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Rio de Janeiro", country: "Brazil", lat: -22.9068, lng: -43.1729 },
        funFact: "Samba originated in Rio's Afro-Brazilian communities in the early 20th century.",
        order: 1
      },
      {
        text: "Flamenco is a traditional art form from which country?",
        round: "music",
        choices: ["Mexico", "Spain", "Italy", "Portugal"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Seville", country: "Spain", lat: 37.3891, lng: -5.9845 },
        funFact: "Flamenco was inscribed as a UNESCO Intangible Cultural Heritage in 2010.",
        order: 2
      },
      {
        text: "The sitar is a traditional instrument from which country?",
        round: "music",
        choices: ["India", "Turkey", "Iran", "Egypt"],
        correctIndex: 0,
        mediaType: null, mediaUrl: null,
        location: { city: "Delhi", country: "India", lat: 28.6139, lng: 77.209 },
        funFact: "Ravi Shankar popularized the sitar worldwide through his collaborations with The Beatles.",
        order: 3
      },
      {
        text: "K-Pop music originates from which country?",
        round: "music",
        choices: ["Japan", "South Korea", "China", "Taiwan"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 },
        funFact: "The global K-Pop industry is worth over $10 billion.",
        order: 4
      },
      {
        text: "Reggae music originated on which Caribbean island?",
        round: "music",
        choices: ["Cuba", "Trinidad", "Jamaica", "Barbados"],
        correctIndex: 2,
        mediaType: null, mediaUrl: null,
        location: { city: "Kingston", country: "Jamaica", lat: 18.0179, lng: -76.8099 },
        funFact: "Bob Marley is the most iconic reggae artist and a global cultural icon.",
        order: 5
      },
      {
        text: "Which country does sushi originally come from?",
        round: "food",
        choices: ["China", "South Korea", "Japan", "Thailand"],
        correctIndex: 2,
        mediaType: null, mediaUrl: null,
        location: { city: "Tokyo", country: "Japan", lat: 35.6762, lng: 139.6503 },
        funFact: "The original sushi was fermented fish preserved in rice, quite different from modern sushi.",
        order: 1
      },
      {
        text: "Tacos are a traditional food from which country?",
        round: "food",
        choices: ["Spain", "Mexico", "Brazil", "Argentina"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Mexico City", country: "Mexico", lat: 19.4326, lng: -99.1332 },
        funFact: "Tacos have been a staple in Mexico since pre-Columbian times.",
        order: 2
      },
      {
        text: "Pad Thai is the national dish of which country?",
        round: "food",
        choices: ["Vietnam", "Thailand", "Malaysia", "Indonesia"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Bangkok", country: "Thailand", lat: 13.7563, lng: 100.5018 },
        funFact: "Pad Thai was promoted as a national dish in the 1930s to foster Thai identity.",
        order: 3
      },
      {
        text: "Couscous is a traditional dish from which region?",
        round: "food",
        choices: ["Middle East", "North Africa", "Central Asia", "Southern Europe"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Marrakech", country: "Morocco", lat: 31.6295, lng: -7.9811 },
        funFact: "The knowledge and practices around couscous were inscribed by UNESCO in 2020.",
        order: 4
      },
      {
        text: "Which country is the origin of croissants?",
        round: "food",
        choices: ["France", "Austria", "Belgium", "Switzerland"],
        correctIndex: 1,
        mediaType: null, mediaUrl: null,
        location: { city: "Vienna", country: "Austria", lat: 48.2082, lng: 16.3738 },
        funFact: "Despite being associated with France, croissants were inspired by the Austrian Kipferl.",
        order: 5
      }
    ];
  }

  // === UTILS ===
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Init
  listenForQuestions();
})();
