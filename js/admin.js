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

      if (!confirm('This will REPLACE all existing questions with the imported set (' + questions.length + ' questions). Continue?')) return;

      const batch = {};
      for (const q of questions) {
        const key = db.ref('questions').push().key;
        q.createdAt = firebase.database.ServerValue.TIMESTAMP;
        q.updatedAt = firebase.database.ServerValue.TIMESTAMP;
        batch[key] = q;
      }
      await db.ref('questions').set(batch);

      alert('Replaced with ' + questions.length + ' questions!');
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
    if (!confirm('This will REPLACE all existing questions with the sample set. Continue?')) return;

    const seed = getSeedQuestions();
    const batch = {};
    for (const q of seed) {
      const key = db.ref('questions').push().key;
      q.createdAt = firebase.database.ServerValue.TIMESTAMP;
      q.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      batch[key] = q;
    }
    await db.ref('questions').set(batch);
    alert('Replaced with ' + seed.length + ' sample questions!');
  });

  function getSeedQuestions() {
    return [
      // === PHOTOS & PLACES (5) ===
      {
        text: "In which country can you find this famous statue?",
        round: "photos", order: 1,
        choices: ["Argentina", "Portugal", "Colombia", "Brazil"],
        correctIndex: 3,
        mediaType: "photo", mediaUrl: "assets/images/places/Christ-redempteur-brezil.jpg",
        location: { city: "Rio de Janeiro", country: "Brazil", lat: -22.9519, lng: -43.2105 },
        funFact: "Christ the Redeemer stands 30 meters tall and was completed in 1931."
      },
      {
        text: "This flaming crater is known as the 'Door to Hell'. Where is it?",
        round: "photos", order: 2,
        choices: ["Turkmenistan", "Kazakhstan", "Uzbekistan", "Iran"],
        correctIndex: 0,
        mediaType: "photo", mediaUrl: "assets/images/places/laPorteEnferDarvazaTurkenmistan.png",
        location: { city: "Darvaza", country: "Turkmenistan", lat: 40.2526, lng: 58.4397 },
        funFact: "The Darvaza gas crater has been burning continuously since 1971."
      },
      {
        text: "Which country is home to this ancient temple?",
        round: "photos", order: 3,
        choices: ["Thailand", "Cambodia", "Indonesia", "Myanmar"],
        correctIndex: 2,
        mediaType: "photo", mediaUrl: "assets/images/places/TempledeBorobudurIndonesie.jpg",
        location: { city: "Magelang", country: "Indonesia", lat: -7.6079, lng: 110.2038 },
        funFact: "Borobudur is the world's largest Buddhist temple, built in the 9th century."
      },
      {
        text: "This iconic mountain is a symbol of which country?",
        round: "photos", order: 4,
        choices: ["South Korea", "Japan", "China", "Nepal"],
        correctIndex: 1,
        mediaType: "photo", mediaUrl: "assets/images/places/mont-fuji.jpg",
        location: { city: "Fujinomiya", country: "Japan", lat: 35.3606, lng: 138.7274 },
        funFact: "Mount Fuji is 3,776 meters high and last erupted in 1707."
      },
      {
        text: "This colorful town with blue and white houses is in which country?",
        round: "photos", order: 5,
        choices: ["Tunisia", "Morocco", "Greece", "Turkey"],
        correctIndex: 0,
        mediaType: "photo", mediaUrl: "assets/images/places/sidiBouTunisia.jpg",
        location: { city: "Sidi Bou Said", country: "Tunisia", lat: 36.8687, lng: 10.3497 },
        funFact: "Sidi Bou Said's blue and white color scheme was established by a French baron in 1915."
      },
      // === FOOD & CUISINE (5) ===
      {
        text: "This burrito is a traditional dish from which country?",
        round: "food", order: 1,
        choices: ["Mexico", "Spain", "Guatemala", "Cuba"],
        correctIndex: 0,
        mediaType: "photo", mediaUrl: "assets/images/dishes/burrito_mexico.jpg",
        location: { city: "Ciudad Juárez", country: "Mexico", lat: 31.6904, lng: -106.4245 },
        funFact: "The burrito is believed to have originated in Northern Mexico in the 19th century."
      },
      {
        text: "This glass noodle stir-fry dish called Japchae is from which country?",
        round: "food", order: 2,
        choices: ["Japan", "Thailand", "South Korea", "Philippines"],
        correctIndex: 2,
        mediaType: "photo", mediaUrl: "assets/images/dishes/Japchae-Korean.webp",
        location: { city: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 },
        funFact: "Japchae was originally created for a royal banquet in the 17th century."
      },
      {
        text: "Fish and chips is a beloved national dish of which country?",
        round: "food", order: 3,
        choices: ["Australia", "Ireland", "Netherlands", "United Kingdom"],
        correctIndex: 3,
        mediaType: "photo", mediaUrl: "assets/images/dishes/Fish_and_chips_UK.jpg",
        location: { city: "London", country: "United Kingdom", lat: 51.5074, lng: -0.1278 },
        funFact: "The first fish and chip shop in the UK opened in the 1860s."
      },
      {
        text: "This tagine dish with chicken and olives is from which country?",
        round: "food", order: 4,
        choices: ["Algeria", "Morocco", "Tunisia", "Libya"],
        correctIndex: 1,
        mediaType: "photo", mediaUrl: "assets/images/dishes/TajinePouletMAroc.png",
        location: { city: "Marrakech", country: "Morocco", lat: 31.6295, lng: -7.9811 },
        funFact: "The tagine is both the name of the dish and the conical clay pot it's cooked in."
      },
      {
        text: "This communal hot pot is a traditional way of eating in which country?",
        round: "food", order: 5,
        choices: ["Japan", "Vietnam", "China", "Mongolia"],
        correctIndex: 2,
        mediaType: "photo", mediaUrl: "assets/images/dishes/hotpotChina.jpg",
        location: { city: "Chongqing", country: "China", lat: 29.4316, lng: 106.9123 },
        funFact: "Hot pot has been a Chinese tradition for over 1,000 years, especially popular in Sichuan."
      },
      // === TRADITIONS & FESTIVALS (5) ===
      {
        text: "The Day of the Dead (Dia de los Muertos) is celebrated in which country?",
        round: "traditions", order: 1,
        choices: ["Spain", "Brazil", "Mexico", "Philippines"],
        correctIndex: 2,
        mediaType: "photo", mediaUrl: "assets/images/culture/DiadelosMuertos.jpg",
        location: { city: "Oaxaca", country: "Mexico", lat: 17.0732, lng: -96.7266 },
        funFact: "Day of the Dead is a celebration of life and death, with roots in Aztec tradition."
      },
      {
        text: "Diwali, the Festival of Lights, originated in which country?",
        round: "traditions", order: 2,
        choices: ["India", "Thailand", "Nepal", "Sri Lanka"],
        correctIndex: 0,
        mediaType: "photo", mediaUrl: "assets/images/culture/Diwali.jpg",
        location: { city: "Varanasi", country: "India", lat: 25.3176, lng: 83.0068 },
        funFact: "Diwali is celebrated by over 1 billion people worldwide across multiple religions."
      },
      {
        text: "The Haka is a traditional war dance of which indigenous people?",
        round: "traditions", order: 3,
        choices: ["Aboriginal Australians", "Samoan", "Hawaiian", "Maori (New Zealand)"],
        correctIndex: 3,
        mediaType: "photo", mediaUrl: "assets/images/culture/TheHaka.jpg",
        location: { city: "Wellington", country: "New Zealand", lat: -41.2865, lng: 174.7762 },
        funFact: "The All Blacks rugby team famously performs the Haka before every match."
      },
      {
        text: "Carnival with elaborate samba parades is most famous in which city?",
        round: "traditions", order: 4,
        choices: ["Venice", "Rio de Janeiro", "New Orleans", "Trinidad"],
        correctIndex: 1,
        mediaType: "photo", mediaUrl: "assets/images/culture/sambaparades.jpg",
        location: { city: "Rio de Janeiro", country: "Brazil", lat: -22.9068, lng: -43.1729 },
        funFact: "Rio Carnival attracts over 2 million people per day during celebrations."
      },
      {
        text: "The Lantern Festival marks the end of Chinese New Year in which country?",
        round: "traditions", order: 5,
        choices: ["Japan", "Vietnam", "South Korea", "China"],
        correctIndex: 3,
        mediaType: "photo", mediaUrl: "assets/images/culture/Lantern_Festival.jpg",
        location: { city: "Beijing", country: "China", lat: 39.9042, lng: 116.4074 },
        funFact: "The Lantern Festival dates back over 2,000 years to the Han Dynasty."
      },
      // === CLOTHES & FASHION (5) ===
      {
        text: "The kimono is the traditional garment of which country?",
        round: "clothes", order: 1,
        choices: ["China", "South Korea", "Japan", "Vietnam"],
        correctIndex: 2,
        mediaType: "photo", mediaUrl: "assets/images/clothes/woman-japanese-kimono.jpg",
        location: { city: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 },
        funFact: "The word kimono literally means 'thing to wear' in Japanese."
      },
      {
        text: "The colorful kente cloth is traditionally woven by which people?",
        round: "clothes", order: 2,
        choices: ["Yoruba (Nigeria)", "Maasai (Kenya)", "Zulu (South Africa)", "Ashanti (Ghana)"],
        correctIndex: 3,
        mediaType: "photo", mediaUrl: "assets/images/clothes/KentheGhana.jpg",
        location: { city: "Kumasi", country: "Ghana", lat: 6.6885, lng: -1.6244 },
        funFact: "Kente cloth patterns have specific meanings and were once reserved for royalty."
      },
      {
        text: "The sari is a traditional draped garment from which country?",
        round: "clothes", order: 3,
        choices: ["Bangladesh", "India", "Pakistan", "Sri Lanka"],
        correctIndex: 1,
        mediaType: "photo", mediaUrl: "assets/images/clothes/sar.jpeg",
        location: { city: "Varanasi", country: "India", lat: 25.3176, lng: 83.0068 },
        funFact: "The sari has been worn for over 5,000 years, making it one of the oldest garments."
      },
      {
        text: "The hanbok is the traditional clothing of which country?",
        round: "clothes", order: 4,
        choices: ["South Korea", "Japan", "Mongolia", "Thailand"],
        correctIndex: 0,
        mediaType: "photo", mediaUrl: "assets/images/clothes/hanbok.webp",
        location: { city: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 },
        funFact: "Hanbok is characterized by vibrant colors and simple lines without pockets."
      },
      {
        text: "The poncho is a traditional garment originating from which region?",
        round: "clothes", order: 5,
        choices: ["Central America", "Caribbean", "South America (Andes)", "Southern Europe"],
        correctIndex: 2,
        mediaType: "photo", mediaUrl: "assets/images/clothes/poncho.jpg",
        location: { city: "Cusco", country: "Peru", lat: -13.5319, lng: -71.9675 },
        funFact: "The poncho has been worn by indigenous peoples of the Andes for over 500 years."
      },
      // === BONUS (1) ===
      {
        text: "⭐ BONUS — Where is Ericsson's Headquarters? Drop a pin!",
        round: "bonus", order: 1,
        choices: [], correctIndex: 0,
        mediaType: "photo", mediaUrl: "assets/images/ericsson.jpg",
        location: { city: "Kista", country: "Sweden", lat: 59.4049, lng: 17.9554 },
        funFact: "Ericsson was founded in 1876 and is headquartered in Kista, Stockholm."
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
