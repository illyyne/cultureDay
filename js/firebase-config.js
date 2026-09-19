// ⚠️ Replace with your Firebase project config from console.firebase.google.com
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
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
