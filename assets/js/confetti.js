// A short burst of confetti for finishing a quiz. Skipped for people who ask
// their system to reduce motion.

const COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff",
  "#5f27cd", "#00d2d3", "#ff9f43", "#10ac84", "#ee5a24",
  "#c8d6e5", "#ffd32a", "#ff3838", "#3ae374", "#17c0eb",
];
const SHAPES = ["square", "circle", "strip"];

export function launchConfetti(count = 150, parent = document.body) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return 0;
  }

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("div");
    piece.className = `confetti ${SHAPES[Math.floor(Math.random() * SHAPES.length)]}`;
    piece.style.backgroundColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.top = `${-20 - Math.random() * 20}px`;
    piece.style.animationDuration = `${2 + Math.random() * 3}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.setAttribute("aria-hidden", "true");
    parent.append(piece);
    setTimeout(() => piece.remove(), 6000);
  }
  return count;
}
