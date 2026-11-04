import { Chess } from "https://esm.sh/chess.js@1.4.0";

// ------------------------------------------------------------
// Configuração e estado
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const boardEl = $("board");
const historyEl = $("history");
const statusEl = $("status");
const promotionModal = $("promotion-modal");
const promotionOptions = $("promotion-options");

const PIECES = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟"
};
const PIECE_VALUES = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 20000 };
const START_TIME = 5 * 60 * 1000;

// O servidor Node também entrega o cliente Socket.IO em /socket.io/socket.io.js.
// Assim, frontend e multiplayer usam automaticamente o mesmo domínio no Render.
const socket = typeof window.io === "function"
  ? window.io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000
    })
  : null;

let game = new Chess();
let mode = "local"; // local | bot | online
let orientation = "white";
let playerColor = "white";
let selectedSquare = null;
let validMoves = [];
let lastMove = null;
let pendingPromotion = null;
let roomCode = null;
let onlineStarted = false;
let botThinking = false;
let timeWinner = null;
let localClocks = [START_TIME, START_TIME];
let lastClockAt = Date.now();
let pointerFrom = null;
let pointerHadSelection = false;
let suppressNextClick = false;

// ------------------------------------------------------------
// Utilitários
// ------------------------------------------------------------
function colorCode(color) {
  return color === "white" ? "w" : "b";
}

function currentColorName() {
  return game.turn() === "w" ? "white" : "black";
}

function isFinished() {
  return game.isGameOver() || timeWinner !== null;
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateStatus(message) {
  statusEl.textContent = message;
}

function canInteract() {
  if (isFinished() || botThinking) return false;
  if (mode === "online") return onlineStarted && currentColorName() === playerColor;
  if (mode === "bot") return game.turn() === "w";
  return true;
}

function getCoordinates(square) {
  return {
    row: 8 - Number(square[1]),
    col: square.charCodeAt(0) - 97
  };
}

function squareName(row, col) {
  return String.fromCharCode(97 + col) + (8 - row);
}

function orderedSquares() {
  const rows = orientation === "white"
    ? [7, 6, 5, 4, 3, 2, 1, 0]
    : [0, 1, 2, 3, 4, 5, 6, 7];
  const cols = orientation === "white"
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [7, 6, 5, 4, 3, 2, 1, 0];
  const squares = [];
  for (const row of rows) {
    for (const col of cols) squares.push(squareName(row, col));
  }
  return squares;
}

function addCoordinate(squareEl, className, value) {
  const label = document.createElement("span");
  label.className = `coord ${className}`;
  label.textContent = value;
  squareEl.appendChild(label);
}

// ------------------------------------------------------------
// Renderização do tabuleiro e histórico
// ------------------------------------------------------------
function renderBoard() {
  boardEl.innerHTML = "";
  const destinations = new Set(validMoves.map((move) => move.to));

  for (const square of orderedSquares()) {
    const { row, col } = getCoordinates(square);
    const piece = game.get(square);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
    cell.dataset.square = square;
    cell.setAttribute("aria-label", `${square}${piece ? `, ${piece.color === "w" ? "peça branca" : "peça preta"}` : ", casa vazia"}`);

    if (piece) cell.classList.add(piece.color === "w" ? "white-piece" : "black-piece");
    if (selectedSquare === square) cell.classList.add("selected");
    if (destinations.has(square)) cell.classList.add(game.get(square) ? "capture" : "valid");
    if (lastMove && (lastMove.from === square || lastMove.to === square)) cell.classList.add("last-move");

    if (piece) {
      const pieceNode = document.createElement("span");
      pieceNode.className = "piece";
      pieceNode.textContent = PIECES[piece.color + piece.type];
      cell.appendChild(pieceNode);
    }

    if (orientation === "white") {
      if (col === 0) addCoordinate(cell, "rank", String(8 - row));
      if (row === 7) addCoordinate(cell, "file", String.fromCharCode(97 + col));
    } else {
      if (col === 7) addCoordinate(cell, "rank", String(8 - row));
      if (row === 0) addCoordinate(cell, "file", String.fromCharCode(97 + col));
    }

    boardEl.appendChild(cell);
  }
}

function renderHistory() {
  historyEl.innerHTML = "";
  const moves = game.history();
  if (moves.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "As jogadas aparecerão aqui.";
    historyEl.appendChild(empty);
    return;
  }

  for (let index = 0; index < moves.length; index += 2) {
    const row = document.createElement("div");
    row.className = "history-row";
    const number = document.createElement("span");
    const white = document.createElement("span");
    const black = document.createElement("span");
    number.className = "history-number";
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    white.textContent = moves[index] || "";
    black.textContent = moves[index + 1] || "";
    row.append(number, white, black);
    historyEl.appendChild(row);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
}

function renderClocks(clocks = localClocks) {
  if (mode === "online") return;
  const myIndex = playerColor === "white" ? 0 : 1;
  const opponentIndex = 1 - myIndex;
  $("player-clock").textContent = formatTime(clocks[myIndex]);
  $("opponent-clock").textContent = formatTime(clocks[opponentIndex]);
  $("player-clock").classList.toggle("active", !isFinished() && currentColorName() === playerColor);
  $("opponent-clock").classList.toggle("active", !isFinished() && currentColorName() !== playerColor);
}

function renderOnlineClocks(clocks) {
  const myIndex = playerColor === "white" ? 0 : 1;
  $("player-clock").textContent = formatTime(clocks[myIndex]);
  $("opponent-clock").textContent = formatTime(clocks[1 - myIndex]);
  $("player-clock").classList.toggle("active", onlineStarted && currentColorName() === playerColor);
  $("opponent-clock").classList.toggle("active", onlineStarted && currentColorName() !== playerColor);
}

function renderAll() {
  renderBoard();
  renderHistory();
  updateGameStatus();
  if (mode !== "online") renderClocks();
}

// ------------------------------------------------------------
// Estado da partida
// ------------------------------------------------------------
function updateGameStatus() {
  if (timeWinner) {
    updateStatus(timeWinner === playerColor ? "Você venceu por tempo!" : "Você perdeu por tempo!");
    return;
  }
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "pretas" : "brancas";
    updateStatus(`Xeque-mate! As ${winner} venceram.`);
    return;
  }
  if (game.isStalemate()) {
    updateStatus("Empate por afogamento.");
    return;
  }
  if (game.isDraw()) {
    updateStatus("Partida empatada.");
    return;
  }
  if (game.isCheck()) {
    updateStatus(`Xeque! ${currentColorName() === "white" ? "Brancas" : "Pretas"} devem responder.`);
    return;
  }
  if (mode === "online") {
    if (!onlineStarted) {
      updateStatus("Aguardando os dois jogadores na sala.");
    } else {
      updateStatus(canInteract() ? "Sua vez de jogar!" : "Aguardando a jogada do adversário.");
    }
    return;
  }
  if (mode === "bot") {
    updateStatus(game.turn() === "w" ? "Sua vez — você joga de brancas." : "Vez do computador — pretas.");
    return;
  }
  updateStatus(game.turn() === "w" ? "Vez das brancas." : "Vez das pretas.");
}

function selectSquare(square) {
  if (!canInteract()) return false;
  const piece = game.get(square);
  if (!piece || piece.color !== game.turn()) return false;
  selectedSquare = square;
  validMoves = game.moves({ square, verbose: true });
  renderBoard();
  return true;
}

function handleSquare(square) {
  if (!canInteract()) return;

  const piece = game.get(square);
  if (!selectedSquare) {
    selectSquare(square);
    return;
  }

  if (selectedSquare === square) {
    selectedSquare = null;
    validMoves = [];
    renderBoard();
    return;
  }

  const selectedMove = validMoves.find((move) => move.to === square);
  if (selectedMove) {
    if (selectedMove.promotion) {
      openPromotion(selectedSquare, square);
      return;
    }
    submitMove(selectedSquare, square, "q");
    return;
  }

  if (piece && piece.color === game.turn()) {
    selectSquare(square);
    return;
  }

  selectedSquare = null;
  validMoves = [];
  renderBoard();
}

// ------------------------------------------------------------
// Clique, toque e arrastar/soltar via Pointer Events
// ------------------------------------------------------------
boardEl.addEventListener("pointerdown", (event) => {
  const cell = event.target.closest(".square");
  if (!cell) return;
  suppressNextClick = false;
  const square = cell.dataset.square;
  const piece = game.get(square);
  pointerHadSelection = Boolean(selectedSquare);

  if (selectedSquare && piece && piece.color === game.turn() && square !== selectedSquare && canInteract()) {
    selectSquare(square);
    pointerFrom = square;
    pointerHadSelection = false;
  } else if (selectedSquare) {
    pointerFrom = selectedSquare;
  } else {
    pointerFrom = selectSquare(square) ? square : null;
    pointerHadSelection = false;
  }
});

window.addEventListener("pointerup", (event) => {
  if (!pointerFrom) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".square");
  const targetSquare = target?.dataset.square;
  const from = pointerFrom;

  if (targetSquare && targetSquare !== from) {
    handleSquare(targetSquare);
  } else if (targetSquare === from && pointerHadSelection) {
    handleSquare(targetSquare);
  }

  pointerFrom = null;
  pointerHadSelection = false;
  suppressNextClick = true;
});

window.addEventListener("pointercancel", () => {
  pointerFrom = null;
  pointerHadSelection = false;
});

boardEl.addEventListener("click", (event) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  const cell = event.target.closest(".square");
  if (cell) handleSquare(cell.dataset.square);
});

// ------------------------------------------------------------
// Promoção de peão
// ------------------------------------------------------------
function openPromotion(from, to) {
  pendingPromotion = { from, to };
  const piece = game.get(from);
  const prefix = piece?.color || "w";
  const promotionSymbols = {
    q: PIECES[prefix + "q"],
    r: PIECES[prefix + "r"],
    b: PIECES[prefix + "b"],
    n: PIECES[prefix + "n"]
  };
  promotionOptions.querySelectorAll("button").forEach((button) => {
    button.textContent = promotionSymbols[button.dataset.piece];
  });
  promotionModal.classList.remove("hidden");
}

promotionOptions.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => {
    if (!pendingPromotion) return;
    const move = pendingPromotion;
    pendingPromotion = null;
    promotionModal.classList.add("hidden");
    submitMove(move.from, move.to, button.dataset.piece);
  });
});

$("cancel-promotion").addEventListener("click", () => {
  pendingPromotion = null;
  promotionModal.classList.add("hidden");
});

// ------------------------------------------------------------
// Execução de jogadas
// ------------------------------------------------------------
function submitMove(from, to, promotion = "q") {
  if (mode === "online") {
    if (!socket || !onlineStarted) return;
    socket.emit("make-move", { from, to, promotion }, (response) => {
      if (!response?.success) updateStatus(response?.message || "Não foi possível enviar a jogada.");
    });
    selectedSquare = null;
    validMoves = [];
    renderBoard();
    return;
  }

  try {
    const move = game.move({ from, to, promotion });
    if (!move) return;
    lastMove = { from: move.from, to: move.to };
    selectedSquare = null;
    validMoves = [];
    renderAll();

    if (mode === "bot" && !game.isGameOver()) scheduleBotMove();
  } catch (error) {
    console.warn("Jogada inválida:", error);
  }
}

// ------------------------------------------------------------
// IA local: minimax com poda alpha-beta, nível introdutório
// ------------------------------------------------------------
function evaluatePosition(chess) {
  if (chess.isCheckmate()) return chess.turn() === "w" ? -100000 : 100000;
  if (chess.isDraw()) return 0;

  let score = 0;
  const state = chess.board();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = state[row][col];
      if (!piece) continue;
      const sign = piece.color === "w" ? 1 : -1;
      const centerDistance = Math.abs(3.5 - row) + Math.abs(3.5 - col);
      const centralBonus = piece.type === "k" ? 0 : Math.round((7 - centerDistance) * 3);
      const advanceBonus = piece.type === "p"
        ? (piece.color === "w" ? 6 - row : row - 1) * 5
        : 0;
      score += sign * (PIECE_VALUES[piece.type] + centralBonus + advanceBonus);
    }
  }
  return score;
}

function minimax(chess, depth, alpha, beta) {
  if (depth === 0 || chess.isGameOver()) return evaluatePosition(chess);

  const moves = chess.moves({ verbose: true });
  const maximizing = chess.turn() === "w";

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    best = Math.min(best, minimax(chess, depth - 1, alpha, beta));
    chess.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function chooseBotMove() {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;
  let bestScore = Infinity;
  let bestMoves = [];

  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    const score = minimax(game, 2, -Infinity, Infinity);
    game.undo();

    if (score < bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function scheduleBotMove() {
  botThinking = true;
  updateStatus("O computador está pensando...");
  setTimeout(() => {
    if (mode !== "bot" || isFinished()) {
      botThinking = false;
      return;
    }
    const move = chooseBotMove();
    if (move && !isFinished()) {
      const played = game.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      if (played) lastMove = { from: played.from, to: played.to };
    }
    botThinking = false;
    renderAll();
  }, 120);
}

// ------------------------------------------------------------
// Relógio local e relógio online
// ------------------------------------------------------------
function updateLocalClock() {
  const now = Date.now();
  const elapsed = now - lastClockAt;
  lastClockAt = now;
  if (mode === "online" || isFinished()) return;

  const index = game.turn() === "w" ? 0 : 1;
  localClocks[index] = Math.max(0, localClocks[index] - elapsed);

  if (localClocks[index] <= 0) {
    timeWinner = index === 0 ? "black" : "white";
    botThinking = false;
    selectedSquare = null;
    validMoves = [];
    updateGameStatus();
    renderBoard();
  }
  renderClocks();
}
setInterval(updateLocalClock, 200);

// ------------------------------------------------------------
// Modos e reinicialização
// ------------------------------------------------------------
function resetGame(nextMode = "local") {
  mode = nextMode;
  game = new Chess();
  orientation = nextMode === "online" && playerColor === "black" ? "black" : "white";
  selectedSquare = null;
  validMoves = [];
  lastMove = null;
  pendingPromotion = null;
  botThinking = false;
  timeWinner = null;
  localClocks = [START_TIME, START_TIME];
  lastClockAt = Date.now();
  onlineStarted = false;
  promotionModal.classList.add("hidden");
  renderAll();
  if (mode === "online") {
    $("player-clock").textContent = "05:00";
    $("opponent-clock").textContent = "05:00";
  }
}

function setPlayerLabels() {
  if (mode === "bot") {
    $("player-name").textContent = "Você";
    $("player-detail").textContent = "Peças brancas";
    $("opponent-name").textContent = "Computador";
    $("opponent-detail").textContent = "IA local · peças pretas";
    $("player-avatar").textContent = "♙";
    $("opponent-avatar").textContent = "♟";
  } else if (mode === "online") {
    $("player-name").textContent = playerColor === "white" ? "Você · Brancas" : "Você · Pretas";
    $("player-detail").textContent = playerColor === "white" ? "Peças brancas" : "Peças pretas";
    $("opponent-name").textContent = "Adversário";
    $("opponent-detail").textContent = playerColor === "white" ? "Peças pretas" : "Peças brancas";
    $("player-avatar").textContent = playerColor === "white" ? "♙" : "♟";
    $("opponent-avatar").textContent = playerColor === "white" ? "♟" : "♙";
  } else {
    $("player-name").textContent = "Jogador 1";
    $("player-detail").textContent = "Peças brancas";
    $("opponent-name").textContent = "Jogador 2";
    $("opponent-detail").textContent = "Peças pretas";
    $("player-avatar").textContent = "♙";
    $("opponent-avatar").textContent = "♟";
  }
}

function startLocalMode(nextMode) {
  if (roomCode && socket) socket.emit("leave-room");
  roomCode = null;
  playerColor = "white";
  $("room-info").textContent = nextMode === "bot"
    ? "Partida local contra o computador."
    : "Partida local para duas pessoas no mesmo dispositivo.";
  $("copy-room-button").classList.add("hidden");
  resetGame(nextMode);
  setPlayerLabels();
  updateGameStatus();
}

$("bot-button").addEventListener("click", () => startLocalMode("bot"));
$("local-button").addEventListener("click", () => startLocalMode("local"));
$("new-game-button").addEventListener("click", () => startLocalMode(mode === "bot" ? "bot" : "local"));

$("flip-button").addEventListener("click", () => {
  orientation = orientation === "white" ? "black" : "white";
  renderBoard();
});

$("undo-button").addEventListener("click", () => {
  if (mode === "online") {
    updateStatus("Não é possível desfazer jogadas em uma sala online.");
    return;
  }
  if (botThinking) return;
  if (mode === "bot") {
    if (game.history().length >= 2) {
      game.undo();
      game.undo();
    } else if (game.history().length === 1) {
      game.undo();
    }
  } else {
    game.undo();
  }
  timeWinner = null;
  lastMove = null;
  selectedSquare = null;
  validMoves = [];
  lastClockAt = Date.now();
  renderAll();
});

// ------------------------------------------------------------
// Multiplayer Socket.IO
// ------------------------------------------------------------
function setConnectionLabel(label, connected = false) {
  $("connection-label").textContent = label;
  $("connection-dot").classList.toggle("online", connected);
}

function setMultiplayerAvailability(enabled) {
  $("create-button").disabled = !enabled;
  $("join-button").disabled = !enabled;
  if (!enabled) {
    $("room-info").textContent = "Não foi possível carregar o cliente Socket.IO. Atualize a página.";
  }
}

setMultiplayerAvailability(Boolean(socket));
if (socket) {
  setConnectionLabel("Conectando ao servidor…");
  socket.on("connect", () => {
    setConnectionLabel("Servidor conectado", true);

    // Se a rede cair e voltar, tenta recuperar a vaga da sala automaticamente.
    if (roomCode) {
      const codeToRejoin = roomCode;
      socket.emit("join-room", codeToRejoin, (result) => {
        if (result?.success) {
          playerColor = result.color;
          orientation = playerColor === "black" ? "black" : "white";
          setPlayerLabels();
          updateStatus("Conexão restabelecida. Sincronizando a partida...");
        } else {
          roomCode = null;
          onlineStarted = false;
          $("copy-room-button").classList.add("hidden");
          $("room-info").textContent = result?.message || "A sala não está mais disponível. Crie outra partida.";
          updateStatus("Não foi possível recuperar a sala. Crie uma nova partida online.");
        }
      });
    }
  });
  socket.on("disconnect", () => setConnectionLabel("Reconectando ao servidor…"));
  socket.on("connect_error", () => setConnectionLabel("Conectando…"));

  socket.on("game-state", (state) => {
    if (!roomCode || state.code !== roomCode) return;
    const synchronized = new Chess();
    try {
      for (const san of state.history || []) synchronized.move(san);
      if (state.history?.length === 0 && state.fen) synchronized.load(state.fen);
      game = synchronized;
    } catch {
      try { game.load(state.fen); } catch { /* mantém o estado anterior */ }
    }

    onlineStarted = Boolean(state.started);
    lastMove = state.lastMove || null;
    if (state.result?.reason === "timeout") timeWinner = state.result.winner;
    renderBoard();
    renderHistory();
    renderOnlineClocks(state.clocks || [START_TIME, START_TIME]);
    updateGameStatus();

    if (state.status === "checkmate" && state.result?.winner) {
      updateStatus(state.result.winner === playerColor ? "Xeque-mate! Você venceu." : "Xeque-mate! Você perdeu.");
    } else if (state.status === "draw" || state.status === "stalemate") {
      updateStatus("Partida empatada.");
    } else if (!state.started && !game.isGameOver() && !timeWinner) {
      updateStatus(state.players?.white && state.players?.black
        ? "Partida pausada. Um jogador desconectou."
        : "Aguardando o segundo jogador entrar na sala.");
    } else if (state.started) {
      updateStatus(currentColorName() === playerColor ? "Sua vez de jogar!" : "Aguardando a jogada do adversário.");
    }
  });

  socket.on("clock-update", ({ clocks }) => {
    if (mode === "online" && Array.isArray(clocks)) renderOnlineClocks(clocks);
  });

  socket.on("game-over", (result) => {
    if (result?.reason === "timeout") {
      timeWinner = result.winner;
      onlineStarted = false;
      updateGameStatus();
      renderBoard();
    }
  });

  socket.on("opponent-disconnected", () => {
    onlineStarted = false;
    updateStatus("O adversário desconectou. A partida foi pausada.");
  });
}

function enterOnlineRoom(result, roomLabel) {
  roomCode = result.code;
  playerColor = result.color;
  resetGame("online");
  setPlayerLabels();
  $("room-info").textContent = roomLabel;
  $("copy-room-button").classList.remove("hidden");
  updateStatus(playerColor === "white"
    ? "Você joga com as brancas. Aguardando o adversário."
    : "Você joga com as pretas. A partida começará quando os dois estiverem conectados.");
}

$("create-button").addEventListener("click", () => {
  if (!socket) return;
  socket.emit("create-room", (result) => {
    if (!result?.success) {
      updateStatus(result?.message || "Não foi possível criar a sala.");
      return;
    }
    enterOnlineRoom(result, `Sala ${result.code} criada. Compartilhe o código com seu adversário.`);
  });
});

$("join-button").addEventListener("click", () => {
  if (!socket) return;
  const code = $("room-code").value.trim().toUpperCase();
  if (!code) {
    updateStatus("Digite o código da sala.");
    return;
  }
  socket.emit("join-room", code, (result) => {
    if (!result?.success) {
      updateStatus(result?.message || "Não foi possível entrar na sala.");
      return;
    }
    enterOnlineRoom(result, `Você entrou na sala ${result.code}. Compartilhe o link se necessário.`);
  });
});

$("copy-room-button").addEventListener("click", async () => {
  if (!roomCode) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("room", roomCode);
  const text = `${roomCode}\n${shareUrl.toString()}`;
  try {
    await navigator.clipboard.writeText(text);
    $("room-info").textContent = `Código e link da sala ${roomCode} copiados.`;
  } catch {
    $("room-info").textContent = `Código: ${roomCode} · Link: ${shareUrl.toString()}`;
  }
});

// Preenche o código quando alguém abre um link compartilhado.
const sharedRoomCode = new URLSearchParams(window.location.search).get("room");
if (sharedRoomCode) $("room-code").value = sharedRoomCode.toUpperCase().slice(0, 6);

// Estado inicial
resetGame("local");
setPlayerLabels();
if (!socket) setConnectionLabel("Modo local");
