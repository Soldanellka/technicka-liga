// ===============================================
//  THEME TOGGLE – plne kompatibilné s dynamickými
//  komponentmi a eventom "componentsLoaded"
// ===============================================

function initThemeToggle() {
  const btn = document.getElementById("themeToggleBtn");
  const icon = document.getElementById("themeIcon");

  if (!btn) {
    console.warn("⚠️ themeToggleBtn sa nenašiel – header ešte nemusí byť načítaný");
    return;
  }

  // kliknutie na tlačidlo
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";

    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);

    // prepnutie ikonky
    if (icon) {
      icon.src = next === "dark"
        ? "/assets/icons/sun.svg"
        : "/assets/icons/moon.svg";
    }
  });

  // načítanie uloženého režimu pri štarte
  const saved = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);

  // nastavíme ikonku podľa uloženého režimu
  if (icon) {
    icon.src = saved === "dark"
      ? "/assets/icons/sun.svg"
      : "/assets/icons/moon.svg";
  }
}

// čakáme, kým load-components.js načíta všetky komponenty
document.addEventListener("componentsLoaded", initThemeToggle);
