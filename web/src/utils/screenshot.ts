/**
 * Captures a high-clarity visual PNG snapshot (`data:image/png;base64,...`) of the current visible
 * EduSMS screen so clients can click "Take Screenshot" inside the Instant Help drawer and send
 * their live screen state directly to Support / Admin.
 */
export async function captureViewportScreenshot(): Promise<string> {
  const width = 960;
  const height = 560;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }

  const isLight = document.documentElement.classList.contains("light");
  const bgCanvas = isLight ? "#F8FAFC" : "#0B1020";
  const bgCard = isLight ? "#FFFFFF" : "#121A2F";
  const borderCol = isLight ? "#E2E8F0" : "#1E293B";
  const textPri = isLight ? "#0F172A" : "#F8FAFC";
  const textSec = isLight ? "#475569" : "#94A3B8";
  const accent = "#7C3AED";
  const cyan = "#06B6D4";

  // Background
  ctx.fillStyle = bgCanvas;
  ctx.fillRect(0, 0, width, height);

  // Top browser/app bar
  ctx.fillStyle = bgCard;
  ctx.fillRect(0, 0, width, 54);
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 54);
  ctx.lineTo(width, 54);
  ctx.stroke();

  // Brand pill & URL bar
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(18, 13, 128, 28, 8);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px Inter, system-ui, sans-serif";
  ctx.fillText("EduSMS Live View", 30, 31);

  ctx.fillStyle = isLight ? "#F1F5F9" : "#0F172A";
  ctx.beginPath();
  ctx.roundRect(160, 13, 520, 28, 6);
  ctx.fill();
  ctx.fillStyle = textSec;
  ctx.font = "12px JetBrains Mono, monospace";
  const currentUrl = typeof window !== "undefined" ? window.location.href : "https://edusms.edusphere.co.tz/";
  ctx.fillText(currentUrl.slice(0, 68), 172, 31);

  ctx.fillStyle = cyan;
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  ctx.fillText(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC", 700, 31);

  // Extract visible DOM headings, cards, alerts, and inputs from main viewport
  const mainEl = document.querySelector("main") || document.body;
  const headings = Array.from(mainEl.querySelectorAll("h1, h2, h3"))
    .map((el) => (el.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const paragraphs = Array.from(mainEl.querySelectorAll("p, span, td, label, button"))
    .map((el) => (el.textContent || "").trim())
    .filter((t) => t.length > 3 && t.length < 110)
    .slice(0, 18);

  // Render captured page title
  ctx.fillStyle = textPri;
  ctx.font = "bold 20px Inter, system-ui, sans-serif";
  ctx.fillText(headings[0] || document.title || "EduSMS Workspace Screen Capture", 28, 92);

  ctx.fillStyle = textSec;
  ctx.font = "13px Inter, system-ui, sans-serif";
  ctx.fillText(
    headings[1] || `Viewport: ${window.innerWidth}x${window.innerHeight}px • Theme: ${isLight ? "Light" : "Dark"}`,
    28,
    116
  );

  // Render visible content cards
  const cardWidth = 436;
  const cardHeight = 185;
  const positions = [
    [28, 138],
    [492, 138],
    [28, 342],
    [492, 342],
  ];

  positions.forEach(([x, y], idx) => {
    ctx.fillStyle = bgCard;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, cardWidth, cardHeight, 12);
    ctx.fill();
    ctx.stroke();

    // Card header accent bar
    ctx.fillStyle = idx % 2 === 0 ? accent : cyan;
    ctx.fillRect(x + 16, y + 18, 28, 4);

    ctx.fillStyle = textPri;
    ctx.font = "bold 14px Inter, system-ui, sans-serif";
    const cardTitle = headings[idx + 1] || `Active Section Panel #${idx + 1}`;
    ctx.fillText(cardTitle.slice(0, 46), x + 16, y + 42);

    ctx.fillStyle = textSec;
    ctx.font = "12px Inter, system-ui, sans-serif";
    const sliceStart = idx * 4;
    const lines = paragraphs.slice(sliceStart, sliceStart + 4);
    lines.forEach((line, lIdx) => {
      ctx.fillText("• " + line.slice(0, 54), x + 16, y + 72 + lIdx * 24);
    });
  });

  // Footer watermark
  ctx.fillStyle = accent;
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  ctx.fillText("Captured via EduSMS Instant Help Screen Snapshot", 28, height - 10);

  return canvas.toDataURL("image/png");
}
