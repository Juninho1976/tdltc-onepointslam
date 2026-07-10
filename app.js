function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCsv(csvText) {
  var rows = [];
  var currentRow = [];
  var currentValue = "";
  var inQuotes = false;

  for (var i = 0; i < csvText.length; i += 1) {
    var char = csvText[i];
    var nextChar = csvText[i + 1];

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
  for (var i = 0; i < aliases.length; i += 1) {
    var alias = aliases[i];
    var normalizedAlias = normalizeHeader(alias);
    if (record[normalizedAlias] !== undefined) {
      return record[normalizedAlias];
    }
  }

  return "";
}

function parseTournamentRows(csvText) {
  var rows = parseCsv(csvText);

  if (rows.length === 0) {
    return [];
  }

  var headerRow = rows[0];
  var dataRows = rows.slice(1);
  var headers = headerRow.map(function (value) {
    return normalizeHeader(value);
  });

  return dataRows
    .filter(function (row) {
      for (var i = 0; i < row.length; i += 1) {
        if (String(row[i]).trim() !== "") {
          return true;
        }
      }
      return false;
    })
    .map(function (row) {
      var record = {};
      for (var index = 0; index < headers.length; index += 1) {
        record[headers[index]] = row[index] || "";
      }
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

var hasLoadedResults = false;
var pollingIntervalId = null;
var latestRequestId = 0;
var lastRenderedRequestId = 0;

function buildDataSummary(matches) {
  if (!Array.isArray(matches)) {
    return "no data";
  }

  var rowCount = matches.length;
  var liveMatch = null;
  var nextMatch = null;

  for (var i = 0; i < matches.length; i += 1) {
    var status = normalizeStatus(matches[i].status);
    if (!liveMatch && status === "live") {
      liveMatch = matches[i];
    }
    if (!nextMatch && status === "scheduled") {
      nextMatch = matches[i];
    }
  }

  return (
    "rows=" + rowCount +
    ", live=" + (liveMatch ? liveMatch.match || "unknown" : "none") +
    ", next=" + (nextMatch ? nextMatch.match || "unknown" : "none")
  );
}

// Global handlers for uncaught errors and promise rejections so we never stay on "Loading"
window.addEventListener && window.addEventListener("unhandledrejection", function (evt) {
  try {
    console.error("Unhandled promise rejection:", evt && evt.reason);
    setStatusMessage("An unexpected error occurred. See console for details.", "status-warning");
    if (!hasLoadedResults) {
      showErrorState("Unexpected error while loading data.");
    }
  } catch (e) {
    console.error("Error in unhandledrejection handler:", e);
  }
});

window.addEventListener && window.addEventListener("error", function (evt) {
  try {
    console.error("Uncaught error:", evt && (evt.error || evt.message));
    setStatusMessage("An unexpected error occurred. See console for details.", "status-warning");
    if (!hasLoadedResults) {
      showErrorState("Unexpected error while loading data.");
    }
  } catch (e) {
    console.error("Error in error handler:", e);
  }
});

/**
 * Load tournament data CSV with diagnostics and timeout.
 * Returns a Promise that resolves to parsed rows array.
 */
function loadTournamentData(requestId) {
  return new Promise(function (resolve, reject) {
    var stage = "init";
    var startedAt = Date.now();
    var url = (typeof CONFIG !== "undefined" && CONFIG.RESULTS_CSV_URL) ? CONFIG.RESULTS_CSV_URL : null;
    console.log("[diagnostic] loadTournamentData requestId=", requestId, "started at", new Date(startedAt).toISOString());

    if (!url) {
      var err = new Error("No CSV URL configured (CONFIG.RESULTS_CSV_URL)");
      console.error(err);
      showErrorState("Configuration error: missing CSV URL.");
      return reject(err);
    }

    // Track progress to report if we stall
    var stallTimer = setTimeout(function () {
      if (requestId !== latestRequestId) {
        return;
      }
      var elapsed = Math.round((Date.now() - startedAt) / 1000);
      var msg = "Loading stalled (" + stage + ") after " + elapsed + "s";
      console.warn(msg);
      setStatusMessage(msg, "status-warning");
      if (!hasLoadedResults) {
        showErrorState("Loading stalled while fetching tournament data. Please try again.");
      }
    }, 10000);

    stage = "fetching";
    console.log("[diagnostic] Fetching CSV from:", url);
    if (requestId === latestRequestId) {
      setStatusMessage("Fetching data...");
    }

    var controller = null;
    var timerId = null;
    try {
      controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    } catch (e) {
      controller = null;
    }

    // add a cache-busting param and keep same semantics as before
    var fetchUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();

    var fetchOptions = { method: "GET" };
    if (controller && controller.signal) {
      fetchOptions.signal = controller.signal;
    }

    var fetchStart = Date.now();

    // 10s timeout
    timerId = setTimeout(function () {
      try {
        if (controller && controller.abort) {
          controller.abort();
        }
      } catch (e) {
        console.warn("Abort failed:", e);
      }
    }, 10000);

    // perform fetch
    try {
      window.fetch(fetchUrl, fetchOptions).then(function (response) {
        clearTimeout(timerId);
        stage = "received";
        var tookMs = Date.now() - fetchStart;
        console.log("[diagnostic] Fetch completed: status=", response.status, "tookMs=", tookMs);

        if (!response || !response.ok) {
          var msg = "CSV fetch returned HTTP " + (response && response.status);
          console.error(msg);
          clearTimeout(stallTimer);
          if (requestId === latestRequestId) {
            showErrorState("The tournament sheet could not be reached (HTTP " + (response && response.status) + ").");
          }
          return reject(new Error(msg));
        }

        stage = "reading";
        // read as text
        response.text().then(function (text) {
          stage = "parsing";
          console.log("[diagnostic] Received CSV length:", text ? text.length : 0);
          var parsed = [];
          try {
            parsed = parseTournamentRows(text || "");
          } catch (err) {
            console.error("CSV parse error:", err);
            clearTimeout(stallTimer);
            if (requestId === latestRequestId) {
              showErrorState("Failed to parse tournament data.");
            }
            return reject(err);
          }

          console.log("[diagnostic] Parsed rows:", parsed.length, "for requestId=", requestId);
          clearTimeout(stallTimer);
          stage = "done";
          if (requestId === latestRequestId) {
            setStatusMessage("Fetched " + parsed.length + " rows", "status-success");
          }
          return resolve({
            requestId: requestId,
            fetchedAt: fetchStart,
            completedAt: Date.now(),
            rows: parsed,
          });
        }).catch(function (err) {
          console.error("Error reading response text for requestId=", requestId, err);
          clearTimeout(stallTimer);
          if (requestId === latestRequestId) {
            showErrorState("Failed to read tournament data.");
          }
          return reject(err);
        });
      }).catch(function (err) {
        clearTimeout(timerId);
        clearTimeout(stallTimer);
        console.error("Fetch failed for requestId=", requestId, err);
        var message = (err && err.name === "AbortError") ? "Request timed out." : "Network error while fetching data.";
        if (requestId === latestRequestId) {
          showErrorState(message);
        }
        return reject(err);
      });
    } catch (err) {
      clearTimeout(timerId);
      clearTimeout(stallTimer);
      console.error("Unexpected error during fetch for requestId=", requestId, err);
      if (requestId === latestRequestId) {
        showErrorState("Unexpected error while fetching data.");
      }
      return reject(err);
    }
  });
}

function setStatusMessage(message, type) {
  var banner = document.getElementById("status-banner");
  if (!banner) {
    return;
  }

  banner.textContent = message || "";
  banner.className = type ? "status-banner " + type : "status-banner";
}

function clearStatusMessage() {
  setStatusMessage("", "");
}

function showLoadingState() {
  if (hasLoadedResults) {
    setStatusMessage("Refreshing results...");
    return;
  }

  setStatusMessage("Loading tournament data...");

  var liveMatch = document.getElementById("live-match");
  var nextMatch = document.getElementById("next-match");
  var progressSummary = document.getElementById("progress-summary");
  var draw = document.getElementById("draw");

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
  setStatusMessage(message, "status-warning");

  if (hasLoadedResults) {
    return;
  }

  var liveMatch = document.getElementById("live-match");
  var nextMatch = document.getElementById("next-match");
  var progressSummary = document.getElementById("progress-summary");
  var draw = document.getElementById("draw");

  if (liveMatch) {
    liveMatch.innerHTML = '<p class="empty-state">' + escapeHtml(message) + '</p>';
  }

  if (nextMatch) {
    nextMatch.innerHTML = '<p class="empty-state">' + escapeHtml(message) + '</p>';
  }

  if (progressSummary) {
    progressSummary.innerHTML = '<p class="empty-state">' + escapeHtml(message) + '</p>';
  }

  if (draw) {
    draw.innerHTML = '<p class="empty-state">' + escapeHtml(message) + '</p>';
  }
}

function formatRoundLabel(roundName) {
  var cleaned = String(roundName || "").trim();

  var roundLabels = {
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

  var normalized = normalizeHeader(cleaned);
  return roundLabels[normalized] || cleaned || "General";
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function renderLiveMatch(matches) {
  var container = document.getElementById("live-match");

  if (!container) {
    return;
  }

  var liveMatch = null;
  for (var i = 0; i < matches.length; i += 1) {
    if (normalizeStatus(matches[i].status) === "live") {
      liveMatch = matches[i];
      break;
    }
  }

  if (!liveMatch) {
    container.innerHTML = '<p class="empty-state">No match currently in progress.</p>';
    return;
  }

  container.innerHTML =
    '<article class="spotlight-card-inner">' +
    '  <p class="status-pill live">Live now</p>' +
    '  <p class="match-number">Match ' + escapeHtml(liveMatch.match || "—") + '</p>' +
    '  <div class="match-versus">' +
    '    <div class="player-block">' +
    '      <p class="player-label">Player 1</p>' +
    '      <p class="player-name">' + escapeHtml(liveMatch.player1 || "—") + '</p>' +
    '    </div>' +
    '    <div class="vs">VS</div>' +
    '    <div class="player-block">' +
    '      <p class="player-label">Player 2</p>' +
    '      <p class="player-name">' + escapeHtml(liveMatch.player2 || "—") + '</p>' +
    '    </div>' +
    '  </div>' +
    '</article>';
}

function renderNextMatch(matches) {
  var container = document.getElementById("next-match");

  if (!container) {
    return;
  }

  var nextMatch = null;
  for (var i = 0; i < matches.length; i += 1) {
    if (normalizeStatus(matches[i].status) === "scheduled") {
      nextMatch = matches[i];
      break;
    }
  }

  if (!nextMatch) {
    container.innerHTML = '<p class="empty-state">No upcoming match scheduled.</p>';
    return;
  }

  container.innerHTML =
    '<article class="mini-card-inner">' +
    '  <p class="status-pill">Next match</p>' +
    '  <p class="match-number">Match ' + escapeHtml(nextMatch.match || "—") + '</p>' +
    '  <div class="match-versus compact">' +
    '    <div class="player-block">' +
    '      <p class="player-label">Player 1</p>' +
    '      <p class="player-name">' + escapeHtml(nextMatch.player1 || "—") + '</p>' +
    '    </div>' +
    '    <div class="vs">VS</div>' +
    '    <div class="player-block">' +
    '      <p class="player-label">Player 2</p>' +
    '      <p class="player-name">' + escapeHtml(nextMatch.player2 || "—") + '</p>' +
    '    </div>' +
    '  </div>' +
    '</article>';
}

function renderProgressSummary(matches) {
  var container = document.getElementById("progress-summary");

  if (!container) {
    return;
  }

  var roundOrder = ["Round of 32", "Round of 16", "Quarter Finals", "Semi Finals", "Final"];
  var totals = {
    "Round of 32": 16,
    "Round of 16": 8,
    "Quarter Finals": 4,
    "Semi Finals": 2,
    Final: 1,
  };

  var summaryHtml = "";

  for (var i = 0; i < roundOrder.length; i += 1) {
    var roundLabel = roundOrder[i];
    var matchesInRound = [];

    for (var j = 0; j < matches.length; j += 1) {
      if (formatRoundLabel(matches[j].round) === roundLabel) {
        matchesInRound.push(matches[j]);
      }
    }

    var completed = 0;
    for (var k = 0; k < matchesInRound.length; k += 1) {
      var status = normalizeStatus(matchesInRound[k].status);
      if (
        status === "complete" ||
        status === "completed" ||
        status === "finished" ||
        status === "won" ||
        status === "winner" ||
        status === "final"
      ) {
        completed += 1;
      }
    }

    var total = totals[roundLabel] || matchesInRound.length || 0;
    var progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    summaryHtml +=
      '<div class="progress-item">' +
      '  <div class="progress-header">' +
      '    <span>' + escapeHtml(roundLabel) + '</span>' +
      '    <span>' + completed + ' / ' + total + ' complete</span>' +
      '  </div>' +
      '  <div class="progress-bar" aria-hidden="true">' +
      '    <div class="progress-bar-fill" style="width: ' + progress + '%"></div>' +
      '  </div>' +
      '</div>';
  }

  container.innerHTML = summaryHtml;
}

function renderTournamentDraw(matches) {
  var container = document.getElementById("draw");

  if (!container) {
    return;
  }

  var roundOrder = ["Round of 32", "Round of 16", "Quarter Finals", "Semi Finals", "Final"];
  var grouped = [];

  for (var i = 0; i < roundOrder.length; i += 1) {
    var roundLabel = roundOrder[i];
    var items = [];

    for (var j = 0; j < matches.length; j += 1) {
      if (formatRoundLabel(matches[j].round) === roundLabel) {
        items.push(matches[j]);
      }
    }

    if (items.length > 0) {
      grouped.push({ roundLabel: roundLabel, items: items });
    }
  }

  if (grouped.length === 0) {
    container.innerHTML = '<p class="empty-state">No tournament draw available yet.</p>';
    return;
  }

  var sectionsHtml = "";

  for (var g = 0; g < grouped.length; g += 1) {
    var group = grouped[g];
    var cardsHtml = "";

    for (var m = 0; m < group.items.length; m += 1) {
      var match = group.items[m];
      var status = normalizeStatus(match.status);
      var isLive = status === "live";
      var isCompleted =
        status === "complete" ||
        status === "completed" ||
        status === "finished" ||
        status === "won" ||
        status === "winner" ||
        status === "final";
      var cardClass = "draw-card" + (isLive ? " live-card" : "") + (isCompleted ? " muted-card" : "");

      cardsHtml +=
        '<article class="' + cardClass + '">' +
        '  <div class="draw-card-top">' +
        '    <span class="match-chip">Match ' + escapeHtml(match.match || "—") + '</span>' +
        '    <span class="status-chip">' + escapeHtml((match.status || "Scheduled").trim() || "Scheduled") + '</span>' +
        '  </div>' +
        '  <div class="draw-player-row">' +
        '    <p class="draw-player">' + escapeHtml(match.player1 || "—") + '</p>' +
        '    <p class="draw-vs">VS</p>' +
        '    <p class="draw-player">' + escapeHtml(match.player2 || "—") + '</p>' +
        '  </div>' +
        '  <div class="draw-meta">' +
        '    <p><span class="meta-label">Winner</span> ' + escapeHtml(match.winner || "Pending") + '</p>' +
        '    <p><span class="meta-label">Status</span> ' + escapeHtml(match.status || "Scheduled") + '</p>' +
        '  </div>' +
        '</article>';
    }

    sectionsHtml +=
      '<section class="draw-group">' +
      '  <h3>' + escapeHtml(group.roundLabel) + '</h3>' +
      '  <div class="draw-cards">' + cardsHtml + '</div>' +
      '</section>';
  }

  container.innerHTML = sectionsHtml;
}

function renderResults(data, requestId, fetchedAt) {
  console.log("[diagnostic] renderResults requestId=", requestId, "fetchedAt=", new Date(fetchedAt).toISOString(), "rows=", data.length, "summary=", buildDataSummary(data));
  var titleElement = document.getElementById("tournament-title");
  if (titleElement) {
    titleElement.textContent = CONFIG.TOURNAMENT_NAME;
  }

  document.title = CONFIG.TOURNAMENT_NAME;

  if (!Array.isArray(data) || data.length === 0) {
    console.log("[diagnostic] renderResults no data for requestId=", requestId);
    if (!hasLoadedResults) {
      showErrorState("No tournament data is available yet.");
    }
    return;
  }

  if (requestId < lastRenderedRequestId) {
    console.warn("[diagnostic] renderResults ignoring stale requestId=", requestId, "lastRenderedRequestId=", lastRenderedRequestId);
    return;
  }

  console.log("[diagnostic] Rendering results: rows=", data.length, "requestId=", requestId);

  renderLiveMatch(data);
  renderNextMatch(data);
  renderProgressSummary(data);
  renderTournamentDraw(data);

  console.log("[diagnostic] Finished rendering results for requestId=", requestId);

  lastRenderedRequestId = requestId;
  hasLoadedResults = true;

  var now = new Date();
  var timeLabel = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  setStatusMessage("Last updated: " + timeLabel, "status-success");
}

function refreshTournamentData() {
  if (!hasLoadedResults) {
    showLoadingState();
  } else {
    setStatusMessage("Refreshing results...");
  }

  latestRequestId += 1;
  var requestId = latestRequestId;
  var requestStart = Date.now();
  console.log("[diagnostic] refreshTournamentData: starting loadTournamentData requestId=", requestId, "at", new Date(requestStart).toISOString());
  loadTournamentData(requestId).then(function (result) {
    console.log("[diagnostic] refreshTournamentData: loadTournamentData resolved requestId=", result.requestId, "rows=", (result.rows && result.rows.length) || 0, "elapsedMs=", Date.now() - requestStart);
    if (result.requestId !== latestRequestId) {
      console.warn("[diagnostic] Ignoring stale response requestId=", result.requestId, "latestRequestId=", latestRequestId);
      return;
    }
    try {
      renderResults(result.rows, result.requestId, result.fetchedAt);
    } catch (err) {
      console.error("Error during renderResults:", err);
      showErrorState("Rendering error. See console for details.");
    }
  }).catch(function (error) {
    console.error("Failed to load tournament data for requestId=", requestId, error);
    if (requestId !== latestRequestId) {
      console.warn("[diagnostic] Ignoring stale error for requestId=", requestId, "latestRequestId=", latestRequestId);
      return;
    }
    if (!hasLoadedResults) {
      showErrorState("Unable to refresh tournament data. Please try again.");
    } else {
      setStatusMessage("Unable to refresh tournament data. Retaining current results.", "status-warning");
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  showLoadingState();
  refreshTournamentData();

  if (CONFIG.REFRESH_INTERVAL_MS > 0) {
    if (pollingIntervalId) {
      window.clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
    pollingIntervalId = window.setInterval(refreshTournamentData, CONFIG.REFRESH_INTERVAL_MS);
    console.log("[diagnostic] Polling interval started, id=", pollingIntervalId, "intervalMs=", CONFIG.REFRESH_INTERVAL_MS);
  }
});
