const INITIAL_RATING = 1500;
const INITIAL_RD = 200;
const MIN_RD = 30;
const Q = Math.log(10) / 400;
const C = 15;

let currentSort = { field: 'rating', order: 'desc' };
let currentTournamentDate = '';

function getPlayers() {
    const players = localStorage.getItem('glickoPlayers');
    return players ? JSON.parse(players) : {};
}

function getGames() {
    const games = localStorage.getItem('glickoGames');
    return games ? JSON.parse(games) : [];
}

function getSeasonStats() {
    const stats = localStorage.getItem('glickoSeasonStats');
    return stats ? JSON.parse(stats) : {};
}

function savePlayers(players) {
    localStorage.setItem('glickoPlayers', JSON.stringify(players));
}

function saveGames(games) {
    localStorage.setItem('glickoGames', JSON.stringify(games));
}

function saveSeasonStats(stats) {
    localStorage.setItem('glickoSeasonStats', JSON.stringify(stats));
}

function g(RD) {
    return 1 / Math.sqrt(1 + (3 * Q * Q * RD * RD) / (Math.PI * Math.PI));
}

function expectedScore(rating, opponentRating, opponentRD) {
    return 1 / (1 + Math.pow(10, (-g(opponentRD) * (rating - opponentRating)) / 400));
}

function calculateKFactor(player, opponent, result, expected) {
    let kFactor = 32;
    const surprise = Math.abs(result - expected);
    if (surprise > 0.7) {
        kFactor *= 1.5;
    } else if (surprise > 0.4) {
        kFactor *= 1.2;
    }
    if (player.rd < 100) {
        kFactor *= 0.7;
    } else if (player.rd < 150) {
        kFactor *= 0.8;
    }
    if (player.games > 30) {
        kFactor *= 0.6;
    } else if (player.games > 10) {
        kFactor *= 0.8;
    }
    return Math.min(kFactor, 50);
}

function updateRatingExact(player, opponent, result, currentTime) {
    const daysSinceLastUpdate = Math.max(
        (currentTime - player.lastUpdate) / (1000 * 60 * 60 * 24),
        0
    );
    const newRD = Math.min(
        Math.sqrt(player.rd * player.rd + C * C * daysSinceLastUpdate),
        INITIAL_RD
    );
    const E = expectedScore(player.rating, opponent.rating, newRD);
    const kFactor = calculateKFactor(player, opponent, result, E);
    const dSquared = 1 / (Q * Q * g(newRD) * g(newRD) * E * (1 - E));
    const ratingChange = kFactor * (result - E);
    const limitedRatingChange = Math.max(Math.min(ratingChange, 100), -100);
    const newRating = player.rating + limitedRatingChange;
    const newRDAfterGame = Math.max(
        Math.sqrt(1 / (1 / (newRD * newRD) + 1 / dSquared)),
        MIN_RD
    );
    const volatility = (((player.rd - newRDAfterGame) / player.rd) * 100).toFixed(1);
    return {
        rating: newRating,
        rd: Math.round(newRDAfterGame),
        ratingChange: Math.round(limitedRatingChange),
        volatility: volatility,
        expectedScore: E,
        kFactor: kFactor,
        lastUpdate: currentTime,
        _exactRating: newRating,
    };
}

function updateRatingForByeExact(player, currentTime) {
    const daysSinceLastUpdate = Math.max(
        (currentTime - player.lastUpdate) / (1000 * 60 * 60 * 24),
        0
    );
    const newRD = Math.min(
        Math.sqrt(player.rd * player.rd + C * C * daysSinceLastUpdate),
        INITIAL_RD
    );
    const ratingChange = 5;
    const newRating = player.rating + ratingChange;
    const newRDAfterGame = Math.max(newRD * 0.95, MIN_RD);
    const volatility = (((player.rd - newRDAfterGame) / player.rd) * 100).toFixed(1);
    return {
        rating: newRating,
        rd: Math.round(newRDAfterGame),
        ratingChange: ratingChange,
        volatility: volatility,
        expectedScore: 1,
        kFactor: 10,
        lastUpdate: currentTime,
        _exactRating: newRating,
    };
}

function recalculateAllRatings() {
    const players = getPlayers();
    const games = getGames();
    const seasonStats = getSeasonStats();
    Object.keys(players).forEach((playerName) => {
        players[playerName] = {
            rating: INITIAL_RATING,
            rd: INITIAL_RD,
            games: 0,
            volatility: '0.0',
            lastUpdate: 0,
            _exactRating: INITIAL_RATING,
        };
        if (!seasonStats[playerName]) {
            seasonStats[playerName] = { games: 0, tournaments: [] };
        } else {
            seasonStats[playerName] = { games: 0, tournaments: [] };
        }
    });
    const sortedGames = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
    sortedGames.forEach((game) => {
        const currentTime = new Date(game.date).getTime();
        if (game.type === 'BYE') {
            const player = players[game.player1];
            if (player) {
                const updatedPlayer = updateRatingForByeExact(player, currentTime);
                players[game.player1] = {
                    ...player,
                    ...updatedPlayer,
                    games: player.games + 1,
                    lastUpdate: currentTime,
                };
                if (seasonStats[game.player1]) {
                    seasonStats[game.player1].games++;
                    if (!seasonStats[game.player1].tournaments.includes(game.date)) {
                        seasonStats[game.player1].tournaments.push(game.date);
                    }
                }
            }
        } else {
            const player1 = players[game.player1];
            const player2 = players[game.player2];
            if (player1 && player2) {
                const resultMap = { win: 1, loss: 0, draw: 0.5 };
                const numResult1 = resultMap[game.result1];
                const numResult2 = resultMap[game.result2];
                const updatedPlayer1 = updateRatingExact(
                    player1,
                    player2,
                    numResult1,
                    currentTime
                );
                players[game.player1] = {
                    ...player1,
                    ...updatedPlayer1,
                    games: player1.games + 1,
                    lastUpdate: currentTime,
                };
                const updatedPlayer2 = updateRatingExact(
                    player2,
                    player1,
                    numResult2,
                    currentTime
                );
                players[game.player2] = {
                    ...player2,
                    ...updatedPlayer2,
                    games: player2.games + 1,
                    lastUpdate: currentTime,
                };
                if (seasonStats[game.player1]) {
                    seasonStats[game.player1].games++;
                    if (!seasonStats[game.player1].tournaments.includes(game.date)) {
                        seasonStats[game.player1].tournaments.push(game.date);
                    }
                }
                if (seasonStats[game.player2]) {
                    seasonStats[game.player2].games++;
                    if (!seasonStats[game.player2].tournaments.includes(game.date)) {
                        seasonStats[game.player2].tournaments.push(game.date);
                    }
                }
            }
        }
    });
    Object.keys(players).forEach((playerName) => {
        if (players[playerName]._exactRating !== undefined) {
            players[playerName].rating = Math.round(players[playerName]._exactRating);
            delete players[playerName]._exactRating;
        }
    });
    savePlayers(players);
    saveSeasonStats(seasonStats);
    return players;
}

function addPlayer(name) {
    const players = getPlayers();
    const seasonStats = getSeasonStats();
    if (players[name]) {
        alert('Игрок с таким именем уже существует!');
        return false;
    }
    players[name] = {
        rating: INITIAL_RATING,
        rd: INITIAL_RD,
        games: 0,
        volatility: '0.0',
        lastUpdate: Date.now(),
    };
    seasonStats[name] = { games: 0, tournaments: [] };
    savePlayers(players);
    saveSeasonStats(seasonStats);
    return true;
}

function createGameEntry(index) {
    const gameEntry = document.createElement('div');
    gameEntry.className = 'game-entry';
    gameEntry.innerHTML = `
    <div class="game-header">
        <span class="game-number">Игра ${
            index + 1
        } <span class="game-type-badge badge-regular">ОБЫЧНАЯ</span></span>
        <button type="button" class="remove-game" onclick="removeGame(this)">× Удалить</button>
    </div>
    <div class="form-row">
        <select class="player1-select" required>
            <option value="">Выберите игрока 1</option>
        </select>
        <select class="player1-result" required>
            <option value="win">Победа</option>
            <option value="loss">Поражение</option>
            <option value="draw">Ничья</option>
        </select>
    </div>
    <div class="form-row">
        <select class="player2-select" required>
            <option value="">Выберите игрока 2</option>
        </select>
        <select class="player2-result" required>
            <option value="win">Победа</option>
            <option value="loss">Поражение</option>
            <option value="draw">Ничья</option>
        </select>
    </div>`;
    populateGameSelects(gameEntry);
    return gameEntry;
}

function createByeGameEntry(index) {
    const gameEntry = document.createElement('div');
    gameEntry.className = 'game-entry';
    gameEntry.innerHTML = `
    <div class="game-header">
        <span class="game-number">Игра ${
            index + 1
        } <span class="game-type-badge badge-bye">BYE</span></span>
        <button type="button" class="remove-game" onclick="removeGame(this)">× Удалить</button>
    </div>
    <div class="bye-section">
        <div class="bye-checkbox">
            <input type="checkbox" class="is-bye-checkbox" checked disabled>
            <label>Это BYE (игра без соперника)</label>
        </div>
        <div class="form-row">
            <select class="player1-select" required>
                <option value="">Выберите игрока</option>
            </select>
            <select class="player1-result" required disabled>
                <option value="win" selected>Победа (автоматически)</option>
            </select>
        </div>
        <div class="bye-info">
            Игрок получает автоматическую победу с минимальным изменением рейтинга (+5 очков)
        </div>
    </div>`;
    populateGameSelects(gameEntry);
    return gameEntry;
}

function populateGameSelects(gameElement) {
    const players = getPlayers();
    const player1Select = gameElement.querySelector('.player1-select');
    const player2Select = gameElement.querySelector('.player2-select');
    player1Select.innerHTML = '<option value="">Выберите игрока 1</option>';
    if (player2Select) {
        player2Select.innerHTML = '<option value="">Выберите игрока 2</option>';
    }
    Object.keys(players).forEach((name) => {
        const option1 = document.createElement('option');
        option1.value = name;
        option1.textContent = name;
        player1Select.appendChild(option1);
        if (player2Select) {
            const option2 = document.createElement('option');
            option2.value = name;
            option2.textContent = name;
            player2Select.appendChild(option2);
        }
    });
}

function removeGame(button) {
    const gameEntry = button.closest('.game-entry');
    gameEntry.remove();
    updateGameNumbers();
}

function updateGameNumbers() {
    const gameEntries = document.querySelectorAll('.game-entry');
    gameEntries.forEach((entry, index) => {
        const gameNumber = entry.querySelector('.game-number');
        const baseText = gameNumber.textContent.split(' ')[0] + ' ' + (index + 1);
        const badge = gameNumber.querySelector('.game-type-badge');
        gameNumber.innerHTML = baseText + (badge ? ' ' + badge.outerHTML : '');
    });
}

function addGameToForm(isBye = false) {
    const gamesContainer = document.getElementById('gamesContainer');
    const gameCount = gamesContainer.children.length;
    if (gameCount >= 10) {
        alert('Максимальное количество игр - 10');
        return;
    }
    const newGame = isBye ? createByeGameEntry(gameCount) : createGameEntry(gameCount);
    gamesContainer.appendChild(newGame);
}

function clearAllGames() {
    const gamesContainer = document.getElementById('gamesContainer');
    gamesContainer.innerHTML = '';
}

function isByeGame(gameElement) {
    return gameElement.querySelector('.is-bye-checkbox') !== null;
}

function addGames(date, gamesData) {
    const players = getPlayers();
    const games = getGames();
    const seasonStats = getSeasonStats();
    const currentTime = new Date(date).getTime();
    const tempPlayers = JSON.parse(JSON.stringify(players));
    const tempSeasonStats = JSON.parse(JSON.stringify(seasonStats));
    gamesData.forEach((gameData) => {
        const { player1, player2, result1, result2, isBye } = gameData;
        if (!tempPlayers[player1]) {
            alert(`Игрок не найден: ${player1}`);
            return false;
        }
        if (!tempSeasonStats[player1]) {
            tempSeasonStats[player1] = { games: 0, tournaments: [] };
        }
        if (isBye) {
            const updatedPlayer = updateRatingForByeExact(
                tempPlayers[player1],
                currentTime
            );
            tempPlayers[player1] = {
                ...tempPlayers[player1],
                ...updatedPlayer,
                games: tempPlayers[player1].games + 1,
                lastUpdate: currentTime,
            };
            tempSeasonStats[player1].games++;
            if (!tempSeasonStats[player1].tournaments.includes(date)) {
                tempSeasonStats[player1].tournaments.push(date);
            }
            games.unshift({
                date: date,
                type: 'BYE',
                player1: player1,
                result1: 'win',
                player2: 'BYE',
                result2: 'loss',
                ratingChange1: updatedPlayer.ratingChange,
                ratingChange2: 0,
                ratingDiff: 0,
                expected1: '100.0',
                expected2: '0.0',
            });
        } else {
            if (!tempPlayers[player2]) {
                alert(`Игрок не найден: ${player2}`);
                return false;
            }
            if (!tempSeasonStats[player2]) {
                tempSeasonStats[player2] = { games: 0, tournaments: [] };
            }
            const resultMap = { win: 1, loss: 0, draw: 0.5 };
            const numResult1 = resultMap[result1];
            const numResult2 = resultMap[result2];
            const ratingDiff = Math.abs(
                tempPlayers[player1].rating - tempPlayers[player2].rating
            );
            const updatedPlayer1 = updateRatingExact(
                tempPlayers[player1],
                tempPlayers[player2],
                numResult1,
                currentTime
            );
            tempPlayers[player1] = {
                ...tempPlayers[player1],
                ...updatedPlayer1,
                games: tempPlayers[player1].games + 1,
                lastUpdate: currentTime,
            };
            const updatedPlayer2 = updateRatingExact(
                tempPlayers[player2],
                tempPlayers[player1],
                numResult2,
                currentTime
            );
            tempPlayers[player2] = {
                ...tempPlayers[player2],
                ...updatedPlayer2,
                games: tempPlayers[player2].games + 1,
                lastUpdate: currentTime,
            };
            tempSeasonStats[player1].games++;
            tempSeasonStats[player2].games++;
            if (!tempSeasonStats[player1].tournaments.includes(date)) {
                tempSeasonStats[player1].tournaments.push(date);
            }
            if (!tempSeasonStats[player2].tournaments.includes(date)) {
                tempSeasonStats[player2].tournaments.push(date);
            }
            games.unshift({
                date: date,
                type: 'Обычная',
                player1: player1,
                player2: player2,
                result1: result1,
                result2: result2,
                ratingChange1: updatedPlayer1.ratingChange,
                ratingChange2: updatedPlayer2.ratingChange,
                ratingDiff: ratingDiff,
                expected1: (updatedPlayer1.expectedScore * 100).toFixed(1),
                expected2: (updatedPlayer2.expectedScore * 100).toFixed(1),
            });
        }
    });
    savePlayers(tempPlayers);
    saveGames(games);
    saveSeasonStats(tempSeasonStats);
    return true;
}

function displayPlayerList() {
    const players = getPlayers();
    const seasonStats = getSeasonStats();
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    if (Object.keys(players).length === 0) {
        playerList.innerHTML = '<p>Нет добавленных игроков</p>';
        return;
    }
    Object.entries(players).forEach(([name, data]) => {
        const playerStats = seasonStats[name] || { games: 0, tournaments: [] };
        const tournamentsCount = Array.isArray(playerStats.tournaments)
            ? playerStats.tournaments.length
            : 0;
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        playerItem.innerHTML = `
        <span onclick="openPlayerModal('${name}')" style="cursor: pointer; flex: 1;">${name}</span>
        <div style="display: flex; gap: 5px; align-items: center;">
            <span class="games-count">${playerStats.games} игр</span>
            <span class="tournaments-count">${tournamentsCount} турниров</span>
            <div class="player-actions">
                <button class="player-action-btn edit-btn" onclick="openEditPlayerModal('${name}', event)">✏️</button>
                <button class="player-action-btn reset-btn" onclick="resetPlayerSeasonPrompt('${name}', event)">🔄</button>
                <button class="player-action-btn delete-btn" onclick="deletePlayerPrompt('${name}', event)">🗑️</button>
            </div>
        </div>
    `;
        playerList.appendChild(playerItem);
    });
}

function populatePlayerSelects() {
    const players = getPlayers();
    const gameEntries = document.querySelectorAll('.game-entry');
    gameEntries.forEach((entry) => {
        populateGameSelects(entry);
    });
    const editPlayer1Select = document.getElementById('editPlayer1Select');
    const editPlayer2Select = document.getElementById('editPlayer2Select');
    if (editPlayer1Select) {
        editPlayer1Select.innerHTML = '<option value="">Выберите игрока 1</option>';
        editPlayer2Select.innerHTML = '<option value="">Выберите игрока 2</option>';
        Object.keys(players).forEach((name) => {
            const option1 = document.createElement('option');
            option1.value = name;
            option1.textContent = name;
            editPlayer1Select.appendChild(option1);
            const option2 = document.createElement('option');
            option2.value = name;
            option2.textContent = name;
            editPlayer2Select.appendChild(option2);
        });
    }
}

function sortPlayers(players, sortBy, sortOrder) {
    const sortedPlayers = Object.entries(players);
    switch (sortBy) {
        case 'rating':
            sortedPlayers.sort((a, b) => b[1].rating - a[1].rating);
            break;
        case 'games':
            const seasonStats = getSeasonStats();
            sortedPlayers.sort((a, b) => {
                const gamesA = seasonStats[a[0]] ? seasonStats[a[0]].games : 0;
                const gamesB = seasonStats[b[0]] ? seasonStats[b[0]].games : 0;
                return gamesB - gamesA;
            });
            break;
        case 'tournaments':
            const stats = getSeasonStats();
            sortedPlayers.sort((a, b) => {
                const tournamentsA = stats[a[0]] ? stats[a[0]].tournaments.length : 0;
                const tournamentsB = stats[b[0]] ? stats[b[0]].tournaments.length : 0;
                return tournamentsB - tournamentsA;
            });
            break;
        case 'name':
            sortedPlayers.sort((a, b) => a[0].localeCompare(b[0]));
            break;
        case 'rd':
            sortedPlayers.sort((a, b) => a[1].rd - b[1].rd);
            break;
        default:
            sortedPlayers.sort((a, b) => b[1].rating - a[1].rating);
    }
    if (sortOrder === 'asc') {
        sortedPlayers.reverse();
    }
    return sortedPlayers;
}

function displayRating() {
    const players = getPlayers();
    const seasonStats = getSeasonStats();
    const ratingBody = document.getElementById('ratingBody');
    ratingBody.innerHTML = '';
    if (Object.keys(players).length === 0) {
        ratingBody.innerHTML =
            '<tr><td colspan="7" style="text-align: center;">Нет данных о рейтинге</td></tr>';
        return;
    }
    const sortBy = document.getElementById('sortBy').value;
    const sortOrder = document.getElementById('sortOrder').value;
    currentSort = { field: sortBy, order: sortOrder };
    const sortedPlayers = sortPlayers(players, sortBy, sortOrder);
    sortedPlayers.forEach(([name, data], index) => {
        const playerStats = seasonStats[name] || { games: 0, tournaments: [] };
        const tournamentsCount = Array.isArray(playerStats.tournaments)
            ? playerStats.tournaments.length
            : 0;
        const roundedRating = Math.round(data.rating);
        let lastUpdate = 'Никогда';
        if (data.lastUpdate && data.lastUpdate > 0) {
            lastUpdate = new Date(data.lastUpdate).toLocaleDateString('ru-RU');
        }
        const row = document.createElement('tr');
        row.innerHTML = `
        <td class="position-number">${index + 1}</td>
        <td><span onclick="openPlayerModal('${name}')" style="cursor: pointer; font-weight: 600;">${name}</span></td>
        <td class="rating">${roundedRating}</td>
        <td><span class="rd-value">${data.rd}</span></td>
        <td>${playerStats.games}</td>
        <td>${tournamentsCount}</td>
        <td>${lastUpdate}</td>
    `;
        ratingBody.appendChild(row);
    });
    updateSortHeaders();
}

function updateSortHeaders() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach((header) => {
        header.classList.remove('sort-asc', 'sort-desc');
        if (header.dataset.sort === currentSort.field) {
            header.classList.add(`sort-${currentSort.order}`);
        }
    });
}

function setupSorting() {
    document.querySelectorAll('th[data-sort]').forEach((header) => {
        header.addEventListener('click', () => {
            const field = header.dataset.sort;
            let order = 'desc';
            if (currentSort.field === field) {
                order = currentSort.order === 'desc' ? 'asc' : 'desc';
            }
            document.getElementById('sortBy').value = field;
            document.getElementById('sortOrder').value = order;
            displayRating();
        });
    });
    document.getElementById('sortBy').addEventListener('change', displayRating);
    document.getElementById('sortOrder').addEventListener('change', displayRating);
}

function displayHistory() {
    const games = getGames();
    const historyBody = document.getElementById('historyBody');
    historyBody.innerHTML = '';
    if (games.length === 0) {
        historyBody.innerHTML =
            '<tr><td colspan="8" style="text-align: center;">Нет истории игр</td></tr>';
        return;
    }
    games.forEach((game, index) => {
        const row = document.createElement('tr');
        const typeClass = game.type === 'BYE' ? 'warning-text' : '';
        const typeBadge = game.type === 'BYE' ? 'badge-bye' : 'badge-regular';
        const result1Class =
            game.result1 === 'win'
                ? 'positive'
                : game.result1 === 'loss'
                ? 'negative'
                : '';
        const result2Class =
            game.result2 === 'win'
                ? 'positive'
                : game.result2 === 'loss'
                ? 'negative'
                : '';
        const change1 =
            game.ratingChange1 > 0 ? `+${game.ratingChange1}` : game.ratingChange1;
        const change2 =
            game.ratingChange2 > 0 ? `+${game.ratingChange2}` : game.ratingChange2;
        const change1Class =
            game.ratingChange1 > 0
                ? 'positive'
                : game.ratingChange1 < 0
                ? 'negative'
                : '';
        const change2Class =
            game.ratingChange2 > 0
                ? 'positive'
                : game.ratingChange2 < 0
                ? 'negative'
                : '';
        row.innerHTML = `
        <td>${game.date}</td>
        <td><span class="${typeClass} game-type-badge ${typeBadge}">${
            game.type
        }</span></td>
        <td><span onclick="openPlayerModal('${game.player1}')" style="cursor: pointer;">${
            game.player1
        }</span></td>
        <td class="${result1Class}">${getResultText(game.result1)}</td>
        <td>${
            game.player2
                ? `<span onclick="openPlayerModal('${game.player2}')" style="cursor: pointer;">${game.player2}</span>`
                : '-'
        }</td>
        <td class="${result2Class}">${getResultText(game.result2)}</td>
        <td>
            <span class="${change1Class}">${game.player1}: ${change1}</span>
            ${
                game.player2
                    ? `<br><span class="${change2Class}">${game.player2}: ${change2}</span>`
                    : ''
            }
        </td>
        <td>
            <div class="history-actions">
                <button class="game-action-btn edit-btn" onclick="openEditGameModal(${index})">✏️</button>
                <button class="game-action-btn delete-btn" onclick="deleteGame(${index})">🗑️</button>
            </div>
        </td>
    `;
        historyBody.appendChild(row);
    });
}

function getResultText(result) {
    const resultMap = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
    return resultMap[result] || result;
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach((tab) => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-button').forEach((button) => {
        button.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');
}

function displayWinChart(playerName, wins, losses, draws, totalGames) {
    const statsTab = document.getElementById('stats-tab');
    const oldChart = document.getElementById('winStatsChart');
    if (oldChart) oldChart.remove();
    if (totalGames === 0) {
        const noGamesMsg = document.createElement('div');
        noGamesMsg.className = 'no-tournaments';
        noGamesMsg.style.textAlign = 'center';
        noGamesMsg.style.margin = '20px 0';
        noGamesMsg.textContent = 'Нет данных об играх';
        statsTab.insertBefore(
            noGamesMsg,
            document.querySelector('.season-reset-section')
        );
        return;
    }
    const winPercent = Math.round((wins / totalGames) * 100);
    const lossPercent = Math.round((losses / totalGames) * 100);
    const drawPercent = Math.round((draws / totalGames) * 100);
    const winStatsContainer = document.createElement('div');
    winStatsContainer.id = 'winStatsChart';
    winStatsContainer.className = 'win-stats';
    winStatsContainer.innerHTML = `
        <div class="win-chart-container">
            <div class="win-chart" style="--win-percent: ${winPercent}; --loss-percent: ${lossPercent}; --draw-percent: ${drawPercent};">
                <div class="win-chart-inner">
                    <div class="win-chart-total">${totalGames}</div>
                    <div class="win-chart-label">всего игр</div>
                </div>
            </div>
        </div>
        <div class="win-legend">
            <div class="legend-item">
                <div class="legend-color win"></div>
                <div class="legend-info">
                    <span>Победы</span>
                    <div>
                        <span class="legend-value">${wins}</span>
                        <span class="legend-percent">(${winPercent}%)</span>
                    </div>
                </div>
            </div>
            <div class="legend-item">
                <div class="legend-color loss"></div>
                <div class="legend-info">
                    <span>Поражения</span>
                    <div>
                        <span class="legend-value">${losses}</span>
                        <span class="legend-percent">(${lossPercent}%)</span>
                    </div>
                </div>
            </div>
            <div class="legend-item">
                <div class="legend-color draw"></div>
                <div class="legend-info">
                    <span>Ничьи</span>
                    <div>
                        <span class="legend-value">${draws}</span>
                        <span class="legend-percent">(${drawPercent}%)</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    const playerStats = document.querySelector('.player-stats');
    statsTab.insertBefore(winStatsContainer, playerStats.nextSibling);
}

function openPlayerModal(playerName) {
    const players = getPlayers();
    const games = getGames();
    const seasonStats = getSeasonStats();
    const player = players[playerName];
    if (!player) return;
    const playerStats = seasonStats[playerName] || { games: 0, tournaments: [] };
    const tournamentsCount = Array.isArray(playerStats.tournaments)
        ? playerStats.tournaments.length
        : 0;
    const avgGamesPerTournament =
        tournamentsCount > 0 ? (playerStats.games / tournamentsCount).toFixed(1) : 0;
    const roundedRating = Math.round(player.rating);
    document.getElementById('modalPlayerName').textContent = playerName;
    document.getElementById('modalPlayerRating').textContent = roundedRating;
    document.getElementById('modalPlayerRD').textContent = player.rd;
    document.getElementById('modalTotalGames').textContent = playerStats.games;
    document.getElementById('modalTournamentsCount').textContent = tournamentsCount;
    document.getElementById('modalAvgGamesPerTournament').textContent =
        avgGamesPerTournament;
    const playerGames = games.filter(
        (game) => game.player1 === playerName || game.player2 === playerName
    );
    let wins = 0,
        losses = 0,
        draws = 0,
        totalPlayerGames = 0;
    playerGames.forEach((game) => {
        if (game.player1 === playerName) {
            totalPlayerGames++;
            if (game.result1 === 'win') wins++;
            else if (game.result1 === 'loss') losses++;
            else if (game.result1 === 'draw') draws++;
        } else if (game.player2 === playerName) {
            totalPlayerGames++;
            if (game.result2 === 'win') wins++;
            else if (game.result2 === 'loss') losses++;
            else if (game.result2 === 'draw') draws++;
        }
    });
    document.getElementById('modalTotalGames').textContent = totalPlayerGames;
    document.getElementById('resetGamesCount').textContent = playerStats.games;
    document.getElementById('resetTournamentsCount').textContent = tournamentsCount;
    displayWinChart(playerName, wins, losses, draws, totalPlayerGames);
    displayTournamentStats(playerName, games);
    displayOpponentStats(playerName, games);
    document.getElementById('playerModal').style.display = 'flex';
}

function displayTournamentStats(playerName, games) {
    const tournamentStatsContainer = document.getElementById('tournamentStats');
    tournamentStatsContainer.innerHTML = '';
    const tournaments = {};
    games.forEach((game) => {
        if (game.player1 === playerName || game.player2 === playerName) {
            const date = game.date;
            if (!tournaments[date]) tournaments[date] = [];
            tournaments[date].push(game);
        }
    });
    if (Object.keys(tournaments).length === 0) {
        tournamentStatsContainer.innerHTML =
            '<div class="no-tournaments">Нет данных о турнирах</div>';
        return;
    }
    const sortedTournaments = Object.entries(tournaments).sort(
        (a, b) => new Date(b[0]) - new Date(a[0])
    );
    sortedTournaments.forEach(([date, tournamentGames]) => {
        const tournamentRow = document.createElement('div');
        tournamentRow.className = 'tournament-row';
        tournamentRow.onclick = () => openTournamentModal(date);
        let wins = 0,
            losses = 0,
            draws = 0,
            ratingChange = 0;
        tournamentGames.forEach((game) => {
            if (game.player1 === playerName) {
                if (game.result1 === 'win') wins++;
                else if (game.result1 === 'loss') losses++;
                else if (game.result1 === 'draw') draws++;
                ratingChange += game.ratingChange1 || 0;
            } else if (game.player2 === playerName) {
                if (game.result2 === 'win') wins++;
                else if (game.result2 === 'loss') losses++;
                else if (game.result2 === 'draw') draws++;
                ratingChange += game.ratingChange2 || 0;
            }
        });
        const totalGames = wins + losses + draws;
        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
        tournamentRow.innerHTML = `
        <div class="tournament-header">
            <span>Турнир ${date}</span>
            <span>${totalGames} игр</span>
        </div>
        <div class="tournament-games">
            <div class="game-result">
                <div class="result-item">
                    <div class="result-value win-result">${wins}</div>
                    <div class="result-label">Побед</div>
                </div>
                <div class="result-item">
                    <div class="result-value loss-result">${losses}</div>
                    <div class="result-label">Поражений</div>
                </div>
                <div class="result-item">
                    <div class="result-value draw-result">${draws}</div>
                    <div class="result-label">Ничьих</div>
                </div>
                <div class="result-item">
                    <div class="result-value ${
                        ratingChange >= 0 ? 'win-result' : 'loss-result'
                    }">${ratingChange > 0 ? '+' : ''}${ratingChange}</div>
                    <div class="result-label">Изменение рейтинга</div>
                </div>
                <div class="result-item">
                    <div class="result-value">${winRate}%</div>
                    <div class="result-label">Процент побед</div>
                </div>
            </div>
        </div>
    `;
        tournamentStatsContainer.appendChild(tournamentRow);
    });
}

function displayOpponentStats(playerName, games) {
    const opponentStatsContainer = document.getElementById('opponentStats');
    opponentStatsContainer.innerHTML = '';
    const opponentStats = {};
    games.forEach((game) => {
        let opponent, result;
        if (game.player1 === playerName) {
            opponent = game.player2;
            result = game.result1;
        } else if (game.player2 === playerName) {
            opponent = game.player1;
            result = game.result2;
        } else return;
        if (opponent === 'BYE') return;
        if (!opponentStats[opponent])
            opponentStats[opponent] = { wins: 0, losses: 0, draws: 0 };
        if (result === 'win') opponentStats[opponent].wins++;
        else if (result === 'loss') opponentStats[opponent].losses++;
        else if (result === 'draw') opponentStats[opponent].draws++;
    });
    if (Object.keys(opponentStats).length === 0) {
        opponentStatsContainer.innerHTML =
            '<div class="no-opponents">Нет данных о играх с другими игроками</div>';
        return;
    }
    Object.entries(opponentStats).forEach(([opponent, stats]) => {
        const totalGames = stats.wins + stats.losses + stats.draws;
        const row = document.createElement('div');
        row.className = 'opponent-row';
        row.innerHTML = `
        <div class="opponent-name">${opponent}</div>
        <div class="opponent-record">
            <div class="record-item">
                <div class="record-value win-record">${stats.wins}</div>
                <div class="record-label">Побед</div>
            </div>
            <div class="record-item">
                <div class="record-value loss-record">${stats.losses}</div>
                <div class="record-label">Поражений</div>
            </div>
            <div class="record-item">
                <div class="record-value draw-record">${stats.draws}</div>
                <div class="record-label">Ничьих</div>
            </div>
            <div class="record-item">
                <div class="record-value">${totalGames}</div>
                <div class="record-label">Всего</div>
            </div>
        </div>
    `;
        opponentStatsContainer.appendChild(row);
    });
}

function openTournamentModal(date) {
    const games = getGames();
    const tournamentGames = games.filter((game) => game.date === date);
    currentTournamentDate = date;
    document.getElementById('tournamentModalTitle').textContent = `Турнир ${date}`;
    document.getElementById('editTournamentDate').value = date;
    const gamesList = document.getElementById('tournamentGamesList');
    gamesList.innerHTML = '';
    if (tournamentGames.length === 0) {
        gamesList.innerHTML = '<div class="no-tournaments">Нет игр в этом турнире</div>';
    } else {
        tournamentGames.forEach((game, index) => {
            const gameItem = document.createElement('div');
            gameItem.className = 'tournament-game-item';
            const globalIndex = games.findIndex((g) => g === game);
            if (game.type === 'BYE') {
                gameItem.innerHTML = `
                    <div class="tournament-game-players">
                        <span><strong>${game.player1}</strong> vs BYE</span>
                    </div>
                    <div class="tournament-game-result">
                        <span class="positive">Победа ${game.player1}</span>
                    </div>
                    <div class="tournament-game-actions">
                        <button class="game-action-btn edit-btn" onclick="openEditGameModal(${globalIndex})">✏️</button>
                        <button class="game-action-btn delete-btn" onclick="deleteGameFromTournament(${globalIndex})">🗑️</button>
                    </div>
                `;
            } else {
                const result1Class =
                    game.result1 === 'win'
                        ? 'positive'
                        : game.result1 === 'loss'
                        ? 'negative'
                        : '';
                const result2Class =
                    game.result2 === 'win'
                        ? 'positive'
                        : game.result2 === 'loss'
                        ? 'negative'
                        : '';
                gameItem.innerHTML = `
                    <div class="tournament-game-players">
                        <span><strong>${game.player1}</strong> vs <strong>${
                    game.player2
                }</strong></span>
                    </div>
                    <div class="tournament-game-result">
                        <span class="${result1Class}">${getResultText(
                    game.result1
                )}</span>
                        <span> - </span>
                        <span class="${result2Class}">${getResultText(
                    game.result2
                )}</span>
                    </div>
                    <div class="tournament-game-actions">
                        <button class="game-action-btn edit-btn" onclick="openEditGameModal(${globalIndex})">✏️</button>
                        <button class="game-action-btn delete-btn" onclick="deleteGameFromTournament(${globalIndex})">🗑️</button>
                    </div>
                `;
            }
            gamesList.appendChild(gameItem);
        });
    }
    document.getElementById('tournamentModal').style.display = 'flex';
}

function closeTournamentModal() {
    document.getElementById('tournamentModal').style.display = 'none';
    currentTournamentDate = '';
}

function updateTournamentDate() {
    const oldDate = currentTournamentDate;
    const newDate = document.getElementById('editTournamentDate').value;
    if (!newDate) {
        alert('Пожалуйста, введите дату');
        return;
    }
    if (oldDate === newDate) {
        alert('Дата не изменилась');
        return;
    }
    const games = getGames();
    let updated = false;
    games.forEach((game) => {
        if (game.date === oldDate) {
            game.date = newDate;
            updated = true;
        }
    });
    if (updated) {
        saveGames(games);
        recalculateAllRatings();
        displayRating();
        displayHistory();
        displayPlayerList();
        closeTournamentModal();
        alert(`Дата турнира изменена с ${oldDate} на ${newDate}`);
    }
}

function deleteGameFromTournament(globalIndex) {
    if (!confirm('Вы уверены, что хотите удалить эту игру?')) return;
    const games = getGames();
    if (globalIndex >= 0 && globalIndex < games.length) {
        const gameToDelete = games[globalIndex];
        games.splice(globalIndex, 1);
        saveGames(games);
        recalculateAllRatings();
        if (currentTournamentDate) openTournamentModal(currentTournamentDate);
        const modalPlayerName = document.getElementById('modalPlayerName').textContent;
        if (
            document.getElementById('playerModal').style.display === 'flex' &&
            (modalPlayerName === gameToDelete.player1 ||
                modalPlayerName === gameToDelete.player2)
        ) {
            openPlayerModal(modalPlayerName);
        }
        displayRating();
        displayHistory();
        displayPlayerList();
        alert('Игра удалена');
    }
}

function recalculateTournament() {
    if (!currentTournamentDate) return;
    if (
        confirm(
            `Пересчитать все рейтинги для турнира ${currentTournamentDate}? Это может занять некоторое время.`
        )
    ) {
        recalculateAllRatings();
        closeTournamentModal();
        alert('Турнир пересчитан');
    }
}

function deleteTournament() {
    if (!currentTournamentDate) return;
    if (
        confirm(
            `Вы уверены, что хотите удалить весь турнир ${currentTournamentDate}? Это действие нельзя отменить.`
        )
    ) {
        const games = getGames();
        const updatedGames = games.filter((game) => game.date !== currentTournamentDate);
        saveGames(updatedGames);
        recalculateAllRatings();
        closeTournamentModal();
        displayRating();
        displayHistory();
        displayPlayerList();
        alert(`Турнир ${currentTournamentDate} удален`);
    }
}

function closePlayerModal() {
    document.getElementById('playerModal').style.display = 'none';
}

function resetPlayerSeasonPrompt(playerName, event) {
    if (event) event.stopPropagation();
    if (
        !confirm(
            `Сбросить сезонную статистику игрока "${playerName}"? Это обнулит количество игр и турниров для награждения.`
        )
    )
        return;
    resetPlayerSeason(playerName);
}

function resetPlayerSeason(playerName = null) {
    if (!playerName) playerName = document.getElementById('modalPlayerName').textContent;
    const seasonStats = getSeasonStats();
    if (seasonStats[playerName]) seasonStats[playerName] = { games: 0, tournaments: [] };
    saveSeasonStats(seasonStats);
    displayPlayerList();
    displayRating();
    if (document.getElementById('playerModal').style.display === 'flex')
        openPlayerModal(playerName);
    alert(`Сезонная статистика игрока "${playerName}" сброшена`);
}

function resetSeason() {
    if (
        !confirm(
            'Сбросить сезонную статистику для всех игроков? Это обнулит количество игр и турниров для награждения в конце сезона.'
        )
    )
        return;
    const seasonStats = getSeasonStats();
    Object.keys(seasonStats).forEach((playerName) => {
        seasonStats[playerName] = { games: 0, tournaments: [] };
    });
    saveSeasonStats(seasonStats);
    displayPlayerList();
    displayRating();
    alert('Сезонная статистика для всех игроков сброшена');
}

function openEditGameModal(gameIndex) {
    const games = getGames();
    const game = games[gameIndex];
    if (!game) return;
    document.getElementById('editGameIndex').value = gameIndex;
    document.getElementById('editGameDate').value = game.date;
    const player1Select = document.getElementById('editPlayer1Select');
    const player2Select = document.getElementById('editPlayer2Select');
    const player1Result = document.getElementById('editPlayer1Result');
    const player2Result = document.getElementById('editPlayer2Result');
    player1Select.value = game.player1;
    player1Result.value = game.result1;
    if (game.type === 'BYE') {
        player2Select.value = '';
        player2Result.value = 'loss';
        player2Select.disabled = true;
        player2Result.disabled = true;
    } else {
        player2Select.value = game.player2;
        player2Result.value = game.result2;
        player2Select.disabled = false;
        player2Result.disabled = false;
    }
    if (document.getElementById('tournamentModal').style.display === 'flex') {
        document.getElementById('tournamentModal').style.display = 'none';
    }
    const editModal = document.getElementById('editGameModal');
    editModal.style.display = 'flex';
    editModal.style.zIndex = '1002';
}

function closeEditGameModal() {
    const editModal = document.getElementById('editGameModal');
    editModal.style.display = 'none';
    editModal.style.zIndex = '1001';
    if (currentTournamentDate)
        setTimeout(() => openTournamentModal(currentTournamentDate), 100);
}

function openEditPlayerModal(playerName, event) {
    if (event) event.stopPropagation();
    const players = getPlayers();
    const player = players[playerName];
    if (!player) return;
    const roundedRating = Math.round(player.rating);
    document.getElementById('editPlayerOriginalName').value = playerName;
    document.getElementById('editPlayerName').value = playerName;
    document.getElementById('editPlayerRating').value = roundedRating;
    document.getElementById('editPlayerRD').value = player.rd;
    document.getElementById('editPlayerModal').style.display = 'flex';
}

function closeEditPlayerModal() {
    document.getElementById('editPlayerModal').style.display = 'none';
}

function deleteGame(gameIndex) {
    if (
        !confirm(
            'Вы уверены, что хотите удалить эту игру? Это повлияет на рейтинги игроков.'
        )
    )
        return;
    const games = getGames();
    const gameToDelete = games[gameIndex];
    games.splice(gameIndex, 1);
    saveGames(games);
    recalculateAllRatings();
    const modalPlayerName = document.getElementById('modalPlayerName').textContent;
    if (
        document.getElementById('playerModal').style.display === 'flex' &&
        (modalPlayerName === gameToDelete.player1 ||
            modalPlayerName === gameToDelete.player2)
    ) {
        openPlayerModal(modalPlayerName);
    }
    displayRating();
    displayHistory();
    displayPlayerList();
    alert('Игра удалена. Все рейтинги пересчитаны.');
}

function deletePlayerPrompt(playerName, event) {
    if (event) event.stopPropagation();
    if (
        !confirm(
            `Вы уверены, что хотите удалить игрока "${playerName}"? Это также удалит все игры с его участием.`
        )
    )
        return;
    deletePlayer(playerName);
}

function deletePlayer(playerName = null) {
    if (!playerName) playerName = document.getElementById('editPlayerOriginalName').value;
    const players = getPlayers();
    const games = getGames();
    const seasonStats = getSeasonStats();
    delete players[playerName];
    delete seasonStats[playerName];
    const updatedGames = games.filter(
        (game) => game.player1 !== playerName && game.player2 !== playerName
    );
    savePlayers(players);
    saveGames(updatedGames);
    saveSeasonStats(seasonStats);
    recalculateAllRatings();
    displayRating();
    displayHistory();
    displayPlayerList();
    closeEditPlayerModal();
    alert(`Игрок "${playerName}" удален. Все рейтинги пересчитаны.`);
}

document.getElementById('editGameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const gameIndex = parseInt(document.getElementById('editGameIndex').value);
    const date = document.getElementById('editGameDate').value;
    const player1 = document.getElementById('editPlayer1Select').value;
    const player2 = document.getElementById('editPlayer2Select').value;
    const result1 = document.getElementById('editPlayer1Result').value;
    const result2 = document.getElementById('editPlayer2Result').value;
    if (!date || !player1) {
        alert('Пожалуйста, заполните все обязательные поля');
        return;
    }
    const games = getGames();
    if (player2) {
        if (player1 === player2) {
            alert('Нельзя выбрать одного и того же игрока дважды');
            return;
        }
        if (
            (result1 === 'win' && result2 === 'win') ||
            (result1 === 'loss' && result2 === 'loss')
        ) {
            alert(
                'Некорректные результаты: оба игрока не могут одновременно победить или проиграть'
            );
            return;
        }
        games[gameIndex] = {
            ...games[gameIndex],
            date: date,
            type: 'Обычная',
            player1: player1,
            player2: player2,
            result1: result1,
            result2: result2,
        };
    } else {
        games[gameIndex] = {
            ...games[gameIndex],
            date: date,
            type: 'BYE',
            player1: player1,
            result1: 'win',
            player2: 'BYE',
            result2: 'loss',
        };
    }
    saveGames(games);
    recalculateAllRatings();
    displayRating();
    displayHistory();
    displayPlayerList();
    closeEditGameModal();
    alert('Игра обновлена. Все рейтинги пересчитаны.');
});

document.getElementById('editPlayerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const originalName = document.getElementById('editPlayerOriginalName').value;
    const newName = document.getElementById('editPlayerName').value.trim();
    const rating = parseInt(document.getElementById('editPlayerRating').value);
    const rd = parseInt(document.getElementById('editPlayerRD').value);
    if (!newName) {
        alert('Пожалуйста, введите имя игрока');
        return;
    }
    if (rd < 30 || rd > 350) {
        alert('RD должен быть в диапазоне от 30 до 350');
        return;
    }
    const players = getPlayers();
    const games = getGames();
    const seasonStats = getSeasonStats();
    if (originalName !== newName) {
        if (players[newName]) {
            alert('Игрок с таким именем уже существует');
            return;
        }
        games.forEach((game) => {
            if (game.player1 === originalName) game.player1 = newName;
            if (game.player2 === originalName) game.player2 = newName;
        });
        players[newName] = players[originalName];
        seasonStats[newName] = seasonStats[originalName] || { games: 0, tournaments: [] };
        delete players[originalName];
        delete seasonStats[originalName];
    }
    players[newName].rating = rating;
    players[newName].rd = rd;
    savePlayers(players);
    saveGames(games);
    saveSeasonStats(seasonStats);
    displayRating();
    displayHistory();
    displayPlayerList();
    closeEditPlayerModal();
    alert('Профиль игрока обновлен');
});

document.getElementById('exportData').addEventListener('click', function () {
    const players = getPlayers();
    const games = getGames();
    const seasonStats = getSeasonStats();
    const playersForExport = { ...players };
    Object.keys(playersForExport).forEach((playerName) => {
        playersForExport[playerName]._exactRating = playersForExport[playerName].rating;
    });
    const data = {
        players: playersForExport,
        games,
        seasonStats,
        exportDate: new Date().toISOString(),
    };
    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glicko_data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('importData').addEventListener('click', function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.players && data.games) {
                    Object.keys(data.players).forEach((playerName) => {
                        if (data.players[playerName]._exactRating !== undefined) {
                            data.players[playerName].rating =
                                data.players[playerName]._exactRating;
                        }
                    });
                    savePlayers(data.players);
                    saveGames(data.games);
                    if (data.seasonStats) {
                        saveSeasonStats(data.seasonStats);
                    } else {
                        const seasonStats = {};
                        Object.keys(data.players).forEach((playerName) => {
                            seasonStats[playerName] = { games: 0, tournaments: [] };
                        });
                        saveSeasonStats(seasonStats);
                    }
                    displayPlayerList();
                    populatePlayerSelects();
                    displayRating();
                    displayHistory();
                    alert('Данные успешно импортированы!');
                } else {
                    alert('Некорректный формат файла');
                }
            } catch (error) {
                alert('Ошибка при чтении файла: ' + error.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
});

document.getElementById('resetData').addEventListener('click', function () {
    if (
        confirm(
            'Вы уверены, что хотите сбросить ВСЕ данные? Это действие нельзя отменить.'
        )
    ) {
        localStorage.removeItem('glickoPlayers');
        localStorage.removeItem('glickoGames');
        localStorage.removeItem('glickoSeasonStats');
        displayPlayerList();
        populatePlayerSelects();
        displayRating();
        displayHistory();
        clearAllGames();
        alert('Все данные сброшены');
    }
});

document.getElementById('addPlayerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const playerName = document.getElementById('playerName').value.trim();
    if (!playerName) {
        alert('Пожалуйста, введите имя игрока');
        return;
    }
    if (addPlayer(playerName)) {
        displayPlayerList();
        populatePlayerSelects();
        displayRating();
        document.getElementById('addPlayerForm').reset();
        alert(`Игрок "${playerName}" успешно добавлен!`);
    }
});

document
    .getElementById('addGameBtn')
    .addEventListener('click', () => addGameToForm(false));
document
    .getElementById('addByeGameBtn')
    .addEventListener('click', () => addGameToForm(true));
document.getElementById('clearGamesBtn').addEventListener('click', clearAllGames);

document.getElementById('gamesForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const date = document.getElementById('gameDate').value;
    if (!date) {
        alert('Пожалуйста, введите дату игр');
        return;
    }
    const gameEntries = document.querySelectorAll('.game-entry');
    if (gameEntries.length === 0) {
        alert('Пожалуйста, добавьте хотя бы одну игру');
        return;
    }
    const gamesData = [];
    let hasErrors = false;
    gameEntries.forEach((entry, index) => {
        const player1Select = entry.querySelector('.player1-select');
        const player2Select = entry.querySelector('.player2-select');
        const player1Result = entry.querySelector('.player1-result');
        const player1 = player1Select.value;
        const result1 = player1Result.value;
        if (!player1) {
            alert(`В игре ${index + 1} не выбран игрок`);
            hasErrors = true;
            return;
        }
        if (isByeGame(entry)) {
            gamesData.push({ player1, result1: 'win', isBye: true });
        } else {
            const player2 = player2Select.value;
            const result2 = entry.querySelector('.player2-result').value;
            if (!player2) {
                alert(`В игре ${index + 1} не выбран второй игрок`);
                hasErrors = true;
                return;
            }
            if (player1 === player2) {
                alert(`В игре ${index + 1} выбран один и тот же игрок дважды`);
                hasErrors = true;
                return;
            }
            if (
                (result1 === 'win' && result2 === 'win') ||
                (result1 === 'loss' && result2 === 'loss')
            ) {
                alert(
                    `В игре ${
                        index + 1
                    } некорректные результаты: оба игрока не могут одновременно победить или проиграть`
                );
                hasErrors = true;
                return;
            }
            gamesData.push({ player1, player2, result1, result2, isBye: false });
        }
    });
    if (hasErrors) return;
    if (addGames(date, gamesData)) {
        displayPlayerList();
        displayRating();
        displayHistory();
        clearAllGames();
        alert(`Успешно добавлено ${gamesData.length} игр!`);
    }
});

document.getElementById('playerModal').addEventListener('click', function (e) {
    if (e.target === this) closePlayerModal();
});

document.getElementById('editGameModal').addEventListener('click', function (e) {
    if (e.target === this) closeEditGameModal();
});

document.getElementById('editPlayerModal').addEventListener('click', function (e) {
    if (e.target === this) closeEditPlayerModal();
});

document.getElementById('tournamentModal').addEventListener('click', function (e) {
    if (e.target === this) closeTournamentModal();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (document.getElementById('editGameModal').style.display === 'flex')
            closeEditGameModal();
        else if (document.getElementById('tournamentModal').style.display === 'flex')
            closeTournamentModal();
        else if (document.getElementById('playerModal').style.display === 'flex')
            closePlayerModal();
        else if (document.getElementById('editPlayerModal').style.display === 'flex')
            closeEditPlayerModal();
    }
});

function adaptTablesForMobile() {
    if (window.innerWidth <= 768) {
        const ratingCells = document.querySelectorAll('#ratingBody td');
        const ratingLabels = [
            'Место',
            'Игрок',
            'Рейтинг',
            'RD',
            'Игр в сезоне',
            'Турниров',
            'Последнее обновление',
        ];
        ratingCells.forEach((cell, index) => {
            const labelIndex = index % ratingLabels.length;
            cell.setAttribute('data-label', ratingLabels[labelIndex]);
        });
        const historyCells = document.querySelectorAll('#historyBody td');
        const historyLabels = [
            'Дата',
            'Тип',
            'Игрок 1',
            'Результат',
            'Игрок 2',
            'Результат',
            'Изменения рейтинга',
            'Действия',
        ];
        historyCells.forEach((cell, index) => {
            const labelIndex = index % historyLabels.length;
            cell.setAttribute('data-label', historyLabels[labelIndex]);
        });
    }
}

window.addEventListener('resize', adaptTablesForMobile);

document.addEventListener('DOMContentLoaded', function () {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('gameDate').value = today;
    const seasonStats = getSeasonStats();
    if (Object.keys(seasonStats).length === 0) {
        const players = getPlayers();
        Object.keys(players).forEach((playerName) => {
            seasonStats[playerName] = { games: 0, tournaments: [] };
        });
        saveSeasonStats(seasonStats);
    }
    displayPlayerList();
    populatePlayerSelects();
    displayRating();
    displayHistory();
    setupSorting();
    addGameToForm(false);
    document.getElementById('resetSeasonBtn').addEventListener('click', resetSeason);
    adaptTablesForMobile();
});
