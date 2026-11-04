//Runs the chess engine off the main thread so the UI never freezes while it thinks.
import { getBestMove } from "./chessEngine.js";

self.onmessage = (e) => {
  const { id, fen, level, history } = e.data;
  try {
    const move = getBestMove(fen, level, history || []);
    self.postMessage({ id, move });
  } catch (err) {
    self.postMessage({
      id,
      error: String(err && err.message ? err.message : err),
    });
  }
};
