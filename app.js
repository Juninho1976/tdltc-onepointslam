function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCsv(csvText) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }

      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getValueFromRecord(record, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (record[normalizedAlias] !== undefined) {
      return record[normalizedAlias];
    }
  }

  return "";
}

function parseTournamentRows(csvText) {
  const rows = parseCsv(csvText);

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((value) => normalizeHeader(value));

  return dataRows
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => {
      const record = {};

      headers.forEach((header, index) => {
        record[header] = row[index] || "";
      });

      return {
        match: getValueFromRecord(record, ["match", "matchnumber", "match #"]),
        round: getValueFromRecord(record, ["round", "roundname", "stage"]),
        player1: getValueFromRecord(record, ["player1", "player 1", "p1", "team1"]),
        player2: getValueFromRecord(record, ["player2", "player 2", "p2", "team2"]),
        winner: getValueFromRecord(record, ["winner", "winnername", "winningplayer"]),
        status: getValueFromRecord(record, ["status", "outcome", "result"]),
      };
    });
}

async function loadTournamentData() {
  const cacheBustingUrl = `${CONFIG.RESULTS_CSV_URL}${CONFIG.RESULTS_CSV_URL.includes("?") ? "&" : "?"}t=${Date.now()}`;

  const response = await fetch(cacheBustingUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch tournament data (${response.status})`);
  }

  const csvText = await response.text();
  return parseTournamentRows(csvText);
}

function showLoadingState() {
  const liveMatch = document.getElementById("live-match");
  const nextMatch = document.getElementById("next-match");
  const progressSummary = document.getElementById("progress-summary");
  const draw = document.getElementById("draw");

  if (liveMatch) {
    liveMatch.innerHTML = '<p class="loading-state">Loading live scoreboard...</p>';
  }

  if (nextMatch) {
    nextMatch.innerHTML = '<p class="loading-state">Loading next match...</p>';
  }

  if (progressSummary) {
    progressSummary.innerHTML = '<p class="loading-state">Loading progress...</p>';
  }

  if (draw) {
    draw.innerHTML = '<p class="loading-state">Loading tournament draw...</p>';
  }
}

function showErrorState(message) {
  const liveMatch = document.getElementById("live-match");
  const nextMatch = document.getElementById("next-match");
  const progressSummary = document.getElementById("progress-summary");
  const draw = document.getElementById("draw");

  if (liveMatch) {
    liveMatch.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }

  if (nextMatch) {
    nextMatch.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }

  if (progressSummary) {
    progressSummary.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }

  if (draw) {
    draw.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }
}

function formatRoundLabel(roundName) {
  const cleaned = String(roundName || "").trim();

  const roundLabels = {
    r32: "Round of 32",
    roundof32: "Round of 32",
    r16: "Round of 16",
    roundof16: "Round of 16",
    qf: "Quarter Finals",
    quarterfinals: "Quarter Finals",
    sf: "Semi Finals",
    semifinals: "Semi Finals",
    f: "Final",
    final: "Final",
  };

  const normalized = normalizeHeader(cleaned);
  return roundLabels[normalized] || cleaned || "General";
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function renderLiveMatch(matches) {
  const container = document.getElementById("live-match");

  if (!container) {
    return;
  }

  const liveMatch = matches.find((match) => normalizeStatus(match.status) === "live");

  if (!liveMatch) {
    container.innerHTML = '<p class="empty-state">No match currently in progress.</p>';
    return;
  }

  container.innerHTML = `
    <article class="spotlight-card-inner">
      <p class="status-pill live">Live now</p>
      <p class="match-number">Match ${escapeHtml(liveMatch.match || "—")}</p>
      <div class="match-versus">
        <div class="player-block">
          <p class="player-label">Player 1</p>
          <p class="player-name">${escapeHtml(liveMatch.player1 || "—")}</p>
        </div>
        <div class="vs">VS</div>
        <div class="player-block">
          <p class="player-label">Player 2</p>
          <p class="player-name">${escapeHtml(liveMatch.player2 || "—")}</p>
        </div>
      </div>
    </article>
  `;
}

function renderNextMatch(matches) {
  const container = document.getElementById("next-match");

  if (!container) {
    return;
  }

  const nextMatch = matches.find((match) => normalizeStatus(match.status) === "scheduled");

  if (!nextMatch) {
    container.innerHTML = '<p class="empty-state">No upcoming match scheduled.</p>';
    return;
  }

  container.innerHTML = `
    <article class="mini-card-inner">
      <p class="status-pill">Next match</p>
      <p class="match-number">Match ${escapeHtml(nextMatch.match || "—")}</p>
      <div class="match-versus compact">
        <div class="player-block">
          <p class="player-label">Player 1</p>
          <p class="player-name">${escapeHtml(nextMatch.player1 || "—")}</p>
        </div>
        <div class="vs">VS</div>
        <div class="player-block">
          <p class="player-label">Player 2</p>
          <p class="player-name">${escapeHtml(nextMatch.player2 || "—")}</p>
        </div>
      </div>
    </article>
  `;
}

function renderProgressSummary(matches) {
  const container = document.getElementById("progress-summary");

  if (!container) {
    return;
  }

  const roundOrder = ["Round of 32", "Round of 16", "Quarter Finals", "Semi Finals", "Final"];
  const totals = {
    "Round of 32": 16,
    "Round of 16": 8,
    "Quarter Finals": 4,
    "Semi Finals": 2,
    Final: 1,
  };

  const summary = roundOrder.map((roundLabel) => {
    const matchesInRound = matches.filter((match) => formatRoundLabel(match.round) === roundLabel);
    const completed = matchesInRound.filter((match) => {
      const status = normalizeStatus(match.status);
      return status === "complete" || status === "completed" || status === "finished" || status === "won" || status === "winner" || status === "final";
    }).length;

    const total = totals[roundLabel] || matchesInRound.length || 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return `
      <div class="progress-item">
        <div class="progress-header">
          <span>${escapeHtml(roundLabel)}</span>
          <span>${completed} / ${total} complete</span>
        </div>
        <div class="progress-bar" aria-hidden="true">
          <div class="progress-bar-fill" style="width: ${progress}%"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = summary.join("");
}

function renderTournamentDraw(matches) {
  const container = document.getElementById("draw");

  if (!container) {
    return;
  }

  const roundOrder = ["Round of 32", "Round of 16", "Quarter Finals", "Semi Finals", "Final"];
  const grouped = roundOrder.map((roundLabel) => {
    const items = matches.filter((match) => formatRoundLabel(match.round) === roundLabel);
    return { roundLabel, items };
  }).filter((group) => group.items.length > 0);

  if (grouped.length === 0) {
    container.innerHTML = '<p class="empty-state">No tournament draw available yet.</p>';
    return;
  }

  const sections = grouped.map((group) => {
    const cards = group.items
      .map((match) => {
        const status = normalizeStatus(match.status);
        const isLive = status === "live";
        const isCompleted = status === "complete" || status === "completed" || status === "finished" || status === "won" || status === "winner" || status === "final";
        const cardClass = `draw-card${isLive ? " live-card" : ""}${isCompleted ? " muted-card" : ""}`;

        return `
          <article class="${cardClass}">
            <div class="draw-card-top">
              <span class="match-chip">Match ${escapeHtml(match.match || "—")}</span>
              <span class="status-chip">${escapeHtml((match.status || "Scheduled").trim() || "Scheduled")}</span>
            </div>
            <div class="draw-player-row">
              <p class="draw-player">${escapeHtml(match.player1 || "—")}</p>
              <p class="draw-vs">VS</p>
              <p class="draw-player">${escapeHtml(match.player2 || "—")}</p>
            </div>
            <div class="draw-meta">
              <p><span class="meta-label">Winner</span> ${escapeHtml(match.winner || "Pending")}</p>
              <p><span class="meta-label">Status</span> ${escapeHtml(match.status || "Scheduled")}</p>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <section class="draw-group">
        <h3>${escapeHtml(group.roundLabel)}</h3>
        <div class="draw-cards">${cards}</div>
      </section>
    `;
  });

  container.innerHTML = sections.join("");
}

function renderResults(data) {
  const titleElement = document.getElementById("tournament-title");
  if (titleElement) {
    titleElement.textContent = CONFIG.TOURNAMENT_NAME;
  }

  document.title = CONFIG.TOURNAMENT_NAME;

  if (!Array.isArray(data) || data.length === 0) {
    showErrorState("No tournament data is available yet.");
    return;
  }

  renderLiveMatch(data);
  renderNextMatch(data);
  renderProgressSummary(data);
  renderTournamentDraw(data);
}

async function refreshTournamentData() {
  try {
    const tournamentData = await loadTournamentData();
    renderResults(tournamentData);
  } catch (error) {
    console.error("Failed to load tournament data:", error);
    showErrorState("The tournament sheet could not be reached right now. Please try again soon.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  showLoadingState();
  refreshTournamentData();

  if (CONFIG.REFRESH_INTERVAL_MS > 0) {
    window.setInterval(refreshTournamentData, CONFIG.REFRESH_INTERVAL_MS);
  }
});
