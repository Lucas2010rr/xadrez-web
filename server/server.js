import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "socket.io";
import { Chess } from "chess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // A conexão do site e do Socket.IO usa o mesmo domínio.
  // Os valores abaixo mantêm conexões estáveis e detectam clientes desconectados.
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e6
});

const PORT = Number(process.env.PORT) || 3000;
const INITIAL_TIME_MS = 5 * 60 * 1000;
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;
const rooms = new Map();

app.disable("x-powered-by");
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    ok: true,
    service: "xadrez-web",
    activeRooms: rooms.size
  });
});

function makeRoomCode() {
  let code;
  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function colorIndex(color) {
  return color === "white" ? 0 : 1;
}

function colorToMove(room) {
  return room.game.turn() === "w" ? "white" : "black";
}

function clockSnapshot(room, now = Date.now()) {
  const clocks = [...room.clocks];
  if (room.started && !room.game.isGameOver()) {
    const index = colorIndex(colorToMove(room));
    clocks[index] = Math.max(0, clocks[index] - (now - room.lastTick));
  }
  return clocks;
}

function roomState(room) {
  return {
    code: room.code,
    fen: room.game.fen(),
    pgn: room.game.pgn(),
    history: room.game.history(),
    turn: room.game.turn(),
    clocks: clockSnapshot(room),
    started: room.started,
    players: {
      white: Boolean(room.players.white),
      black: Boolean(room.players.black)
    },
    lastMove: room.lastMove,
    result: room.result,
    status: room.game.isCheckmate()
      ? "checkmate"
      : room.game.isStalemate()
        ? "stalemate"
        : room.game.isDraw()
          ? "draw"
          : room.game.isCheck()
            ? "check"
            : "playing"
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit("game-state", roomState(room));
}

// Consolida o tempo do jogador da vez. Retorna true quando o tempo acabou.
function settleClock(room, now = Date.now()) {
  if (!room.started || room.game.isGameOver()) return false;

  const activeColor = colorToMove(room);
  const index = colorIndex(activeColor);
  room.clocks[index] = Math.max(0, room.clocks[index] - (now - room.lastTick));
  room.lastTick = now;

  if (room.clocks[index] > 0) return false;

  room.started = false;
  room.result = {
    reason: "timeout",
    winner: activeColor === "white" ? "black" : "white"
  };

  io.to(room.code).emit("game-over", room.result);
  broadcastRoom(room);
  return true;
}

function pauseRoom(room) {
  if (room.started) settleClock(room);
  room.started = false;
  room.lastTick = Date.now();
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    game: new Chess(),
    players: { white: null, black: null },
    clocks: [INITIAL_TIME_MS, INITIAL_TIME_MS],
    lastTick: Date.now(),
    lastMove: null,
    started: false,
    result: null,
    lastActivity: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function sendAck(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

io.on("connection", (socket) => {
  socket.on("create-room", (callback) => {
    if (socket.data.roomCode) {
      sendAck(callback, { success: false, message: "Você já está em uma sala." });
      return;
    }

    const room = createRoom();
    room.players.white = socket.id;
    socket.data.roomCode = room.code;
    socket.data.color = "white";
    socket.join(room.code);

    sendAck(callback, { success: true, code: room.code, color: "white" });
    broadcastRoom(room);
  });

  socket.on("join-room", (rawCode, callback) => {
    const code = String(rawCode || "").trim().toUpperCase();

    if (!/^[A-F0-9]{6}$/.test(code)) {
      sendAck(callback, { success: false, message: "Código de sala inválido." });
      return;
    }

    if (socket.data.roomCode) {
      sendAck(callback, { success: false, message: "Você já está em uma sala." });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      sendAck(callback, { success: false, message: "Sala não encontrada ou servidor reiniciado." });
      return;
    }

    if (room.game.isGameOver() || room.result?.reason === "timeout") {
      sendAck(callback, { success: false, message: "Esta partida já terminou. Crie uma nova sala." });
      return;
    }

    if (room.players.white && room.players.black) {
      sendAck(callback, { success: false, message: "Esta sala já está cheia." });
      return;
    }

    const color = room.players.white ? "black" : "white";
    room.players[color] = socket.id;
    room.lastActivity = Date.now();
    room.lastTick = Date.now();
    room.started = Boolean(room.players.white && room.players.black);

    socket.data.roomCode = code;
    socket.data.color = color;
    socket.join(code);

    sendAck(callback, { success: true, code, color });
    broadcastRoom(room);
  });

  socket.on("leave-room", (callback) => {
    const code = socket.data.roomCode;
    const color = socket.data.color;
    const room = rooms.get(code);

    if (room && color && room.players[color] === socket.id) {
      pauseRoom(room);
      room.players[color] = null;
      room.lastActivity = Date.now();
      socket.leave(code);
      io.to(code).emit("opponent-disconnected");

      if (!room.players.white && !room.players.black) {
        rooms.delete(code);
      } else {
        broadcastRoom(room);
      }
    }

    delete socket.data.roomCode;
    delete socket.data.color;
    sendAck(callback, { success: true });
  });

  socket.on("make-move", (data, callback) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || !room.started) {
      sendAck(callback, { success: false, message: "A partida não está ativa." });
      return;
    }

    if (settleClock(room)) {
      sendAck(callback, { success: false, message: "Seu tempo acabou." });
      return;
    }

    const color = socket.data.color;
    if (!color || room.players[color] !== socket.id || color !== colorToMove(room)) {
      sendAck(callback, { success: false, message: "Não é sua vez de jogar." });
      return;
    }

    const from = data?.from;
    const to = data?.to;
    const promotion = data?.promotion || "q";
    const validSquare = /^[a-h][1-8]$/;

    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !validSquare.test(from) ||
      !validSquare.test(to) ||
      !["q", "r", "b", "n"].includes(promotion)
    ) {
      sendAck(callback, { success: false, message: "Dados de jogada inválidos." });
      return;
    }

    try {
      const move = room.game.move({ from, to, promotion });
      room.lastMove = { from: move.from, to: move.to };
      room.lastTick = Date.now();
      room.lastActivity = Date.now();

      if (room.game.isGameOver()) {
        room.started = false;
        room.result = {
          reason: room.game.isCheckmate() ? "checkmate" : "draw",
          winner: room.game.isCheckmate()
            ? (room.game.turn() === "w" ? "black" : "white")
            : null
        };
      }

      sendAck(callback, { success: true, san: move.san });
      broadcastRoom(room);
    } catch {
      sendAck(callback, { success: false, message: "Jogada ilegal." });
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const color = socket.data.color;
    const room = rooms.get(code);
    if (!room) return;

    pauseRoom(room);

    if (color && room.players[color] === socket.id) {
      room.players[color] = null;
    }

    room.lastActivity = Date.now();
    io.to(code).emit("opponent-disconnected");

    if (!room.players.white && !room.players.black) {
      rooms.delete(code);
    } else {
      broadcastRoom(room);
    }
  });
});

// Atualiza os relógios e remove salas vazias antigas.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.started && !room.game.isGameOver()) {
      if (!settleClock(room, now)) {
        io.to(code).emit("clock-update", { clocks: clockSnapshot(room, now) });
      }
    }

    const noPlayers = !room.players.white && !room.players.black;
    if (noPlayers && now - room.lastActivity > ROOM_IDLE_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 500);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Xadrez Web disponível na porta ${PORT}`);
});
