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
        match: getValueFromRecord(record, ["match", "matchnumber", "matchnumber", "match #"]),
        round: getValueFromRecord(record, ["round", "roundname", "stage"]),
        player1: getValueFromRecord(record, ["player1", "player 1", "p1", "team1"]),
        player2: getValueFromRecord(record, ["player2", "player 2", "p2", "team2"]),
        winner: getValueFromRecord(record, ["winner", "winnername", "winningplayer"]),
        status: getValueFromRecord(record, ["status", "outcome", "result"]),
      };
    });
}

async function loadTournamentData() {
  const response = await fetch(CONFIG.RESULTS_CSV_URL, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch tournament data (${response.status})`);
  }

  const csvText = await response.text();
  return parseTournamentRows(csvText);
}

function clearResultsContainer() {
  const resultsContainer = document.getElementById("results");

  if (resultsContainer) {
    resultsContainer.innerHTML = "";
  }
}

function showLoadingState() {
  const resultsContainer = document.getElementById("results");

  if (resultsContainer) {
    resultsContainer.innerHTML = '<p class="loading-state">Loading tournament data...</p>';
  }
}

function showErrorState(message) {
  const resultsContainer = document.getElementById("results");

  if (resultsContainer) {
    resultsContainer.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }
}

function renderResults(data) {
  const resultsContainer = document.getElementById("results");
  const titleElement = document.getElementById("tournament-title");

  if (titleElement) {
    titleElement.textContent = CONFIG.TOURNAMENT_NAME;
  }

  document.title = CONFIG.TOURNAMENT_NAME;

  if (!resultsContainer) {
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    resultsContainer.innerHTML = '<p class="empty-state">No tournament data is available yet.</p>';
    return;
  }

  const matchesByRound = data.reduce((groups, match) => {
    const roundName = match.round?.trim() || "General";

    if (!groups[roundName]) {
      groups[roundName] = [];
    }

    groups[roundName].push(match);
    return groups;
  }, {});

  const roundSections = Object.entries(matchesByRound)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([roundName, matches]) => {
      const cards = matches
        .map((match) => {
          const matchNumber = match.match?.trim() || "—";
          const player1 = match.player1?.trim() || "—";
          const player2 = match.player2?.trim() || "—";
          const winner = match.winner?.trim() || "Pending";
          const status = match.status?.trim() || "Pending";

          return `
            <article class="result-card">
              <div class="card-header">
                <span class="pill">Round ${escapeHtml(roundName)}</span>
                <span class="pill">Match ${escapeHtml(matchNumber)}</span>
              </div>
              <div class="player-grid">
                <div>
                  <p class="label">Player 1</p>
                  <p class="value">${escapeHtml(player1)}</p>
                </div>
                <div>
                  <p class="label">Player 2</p>
                  <p class="value">${escapeHtml(player2)}</p>
                </div>
              </div>
              <div class="meta-grid">
                <div>
                  <p class="label">Winner</p>
                  <p class="value">${escapeHtml(winner)}</p>
                </div>
                <div>
                  <p class="label">Status</p>
                  <p class="value">${escapeHtml(status)}</p>
                </div>
              </div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="round-section">
          <h3>${escapeHtml(roundName)}</h3>
          <div class="round-cards">${cards}</div>
        </section>
      `;
    })
    .join("");

  resultsContainer.innerHTML = `
    <div class="results-intro">
      <p class="helper-text">Showing ${data.length} match${data.length === 1 ? "" : "es"} from ${CONFIG.TOURNAMENT_NAME}.</p>
    </div>
    ${roundSections}
  `;
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
