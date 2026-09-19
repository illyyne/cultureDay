const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD0oRt2NfiALaJL7eyyRvP0sSvHCOtwV0M",
  authDomain: "culture-day-quiz.firebaseapp.com",
  databaseURL: "https://culture-day-quiz-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "culture-day-quiz",
  storageBucket: "culture-day-quiz.firebasestorage.app",
  messagingSenderId: "374486150988",
  appId: "1:374486150988:web:f3d322f5c268d0b3e1e9e9"
};

firebase.initializeApp(FIREBASE_CONFIG);

const db = firebase.database();
const auth = firebase.auth();
const storage = firebase.storage ? firebase.storage() : null;

let serverTimeOffset = 0;
db.ref('.info/serverTimeOffset').on('value', snap => {
  serverTimeOffset = snap.val() || 0;
});

function getServerTime() {
  return Date.now() + serverTimeOffset;
}

async function signInAnonymously() {
  try {
    const result = await auth.signInAnonymously();
    return result.user.uid;
  } catch (err) {
    console.error('Auth failed:', err);
    return null;
  }
}
