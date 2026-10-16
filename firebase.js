// firebase.js — konfigurácia pre projekt Finančná liga

'use strict';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Konfigurácia Firebase projektu Technická liga
const firebaseConfig = {
  apiKey: "AIzaSyAzO9pXUOVqU3EKwoZ7Tdb8LMgOtYv5EnE",
  authDomain: "technicka-liga.firebaseapp.com",
  databaseURL: "https://technicka-liga-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "technicka-liga",
  storageBucket: "technicka-liga.firebasestorage.app",
  messagingSenderId: "91322598585",
  appId: "1:91322598585:web:2a86d3c8ce13300bbb4768",
  measurementId: "G-JB5R5XY8KJ"
};
// Inicializácia Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

window.db = db;

console.log("🔥 Firebase Tecnická liga inicializovaná, DB pripravená.");
