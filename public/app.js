const mode = document.querySelector("#mode");
const risk = document.querySelector("#risk");
const start = document.querySelector("#start");
const transport = document.querySelector("#transport");
const run = document.querySelector("#run");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

const euro = (money) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((money?.amountMinor ?? 0) / 100);
const city = (location) => location?.city ?? "—";
const time = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const modeLabel = { MAX_REVENUE: "Maximaler Umsatz", MAX_REVENUE_PER_HOUR: "Umsatz pro Stunde", MAX_ESTIMATED_SURPLUS: "Geschätzter Überschuss", BALANCED: "Ausgewogen", DESTINATION: "Zielmodus" };
const locationLabel = { DUSSELDORF: "Düsseldorf", COLOGNE: "Köln", HAMBURG: "Hamburg", BREMEN: "Bremen", BERLIN: "Berlin" };
const transportLabel = { WALKING: "Zu Fuß", PUBLIC_TRANSPORT: "ÖPNV", OWN_VEHICLE: "Eigenes Fahrzeug", CUSTOMER_VEHICLE: "Kundenfahrzeug", TAXI: "Taxi", RIDESHARE: "Fahrdienst" };
const legTypeLabel = { WALK: "Zu Fuß", TRAIN: "Zug", BUS: "Bus", FLIGHT: "Flug", TAXI: "Taxi", RIDESHARE: "Fahrdienst", DRIVE: "Fahrt", OPPORTUNITY_SERVICE: "Auftrag", WAIT: "Warten" };

function renderMission(mission, index) {
  const score = mission.scoreBreakdown;
  const legs = mission.legs.map((leg, legIndex) => `
    <li class="leg">
      <div class="leg-marker">${String(legIndex + 1).padStart(2, "0")}</div>
      <div class="leg-main">
        <strong>${leg.opportunityId ? "AUFTRAG" : (legTypeLabel[leg.type] ?? leg.type)}</strong>
        <span>${city(leg.origin)} → ${city(leg.destination)}</span>
        <small>${time(leg.departureTime)}–${time(leg.arrivalTime)} · ${transportLabel[leg.transportMode] ?? leg.transportMode}</small>
      </div>
      <b class="leg-money ${leg.revenue.amountMinor > 0 ? "positive" : "negative"}">${leg.revenue.amountMinor > 0 ? "+" : ""}${euro(leg.revenue)}</b>
    </li>`).join("");
  return `<article class="mission ${index === 0 ? "mission--featured" : ""}">
    <div class="mission-head"><div class="mission-ident"><span class="mission-number">ROUTE ${String(index + 1).padStart(2, "0")} · ${index === 0 ? "HAUPTROUTE" : "ALTERNATIVE"}</span><h3>${modeLabel[mission.optimizationMode] ?? mission.optimizationMode}</h3></div><span class="score"><small>GESAMTSCORE</small>${score.finalScore.toFixed(0)}</span></div>
    <div class="metrics"><div><span>UMSATZ</span><strong>${euro(score.totalRevenue)}</strong></div><div><span>FAHRKOSTEN</span><strong>${euro(score.estimatedTravelCosts)}</strong></div><div><span>GESCHÄTZTER ÜBERSCHUSS</span><strong>${euro(score.estimatedSurplus)}</strong></div><div><span>LEERFAHRT</span><strong>${score.emptyDistanceKm.toFixed(1)} km</strong></div></div>
    <ol class="legs">${legs}</ol>
  </article>`;
}

async function calculate() {
  run.disabled = true;
  status.textContent = "Missionen werden berechnet …";
  try {
    const response = await fetch(`/api/optimize?mode=${encodeURIComponent(mode.value)}&risk=${encodeURIComponent(risk.value)}&start=${encodeURIComponent(start.value)}&transport=${encodeURIComponent(transport.value)}`);
    if (!response.ok) throw new Error("Die Demo konnte nicht berechnen.");
    const data = await response.json();
    status.textContent = `${data.missions.length} Route${data.missions.length === 1 ? "" : "n"} · ${locationLabel[data.scenario.start]} · ${transportLabel[data.scenario.transportMode]} · ${modeLabel[data.preferences.optimizationMode]}`;
    results.innerHTML = data.missions.length ? data.missions.map(renderMission).join("") : `<div class="empty"><h2>Keine machbare Mission</h2><p>Mit den aktuellen Hard Constraints wurde keine passende Route gefunden.</p></div>`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Unbekannter Fehler";
    results.innerHTML = "";
  } finally {
    run.disabled = false;
  }
}

run.addEventListener("click", calculate);
calculate();
