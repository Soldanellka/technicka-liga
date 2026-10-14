// firebase.js — konfigurácia pre projekt Finančná liga

'use strict';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Konfigurácia Firebase projektu Finančná liga
const firebaseConfig = {
  apiKey: "AIzaSyB-eoRSUGEQh8hBbVLq3D32sFCZ6tHiPWg",
  authDomain: "financna-liga.firebaseapp.com",
  databaseURL: "https://financna-liga-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "financna-liga",
  storageBucket: "financna-liga.appspot.com",
  messagingSenderId: "709763303594",
  appId: "1:709763303594:web:d990dee3bc29f65a00a8d3",
  measurementId: "G-Y4469KN94M"
};

// Inicializácia Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

window.db = db;

console.log("🔥 Firebase Finančná liga inicializovaná, DB pripravená.");
