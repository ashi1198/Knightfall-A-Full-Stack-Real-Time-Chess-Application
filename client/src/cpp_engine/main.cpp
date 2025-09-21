#include "chess_logic.cpp" // Include the single logic file
#include <emscripten.h>

ChessEngine engine;

extern "C" {
  EMSCRIPTEN_KEEPALIVE
  void setPosition(const char* fen) {
    engine.setPosition(string(fen));
  }
  
  EMSCRIPTEN_KEEPALIVE
  void makeUserMove(const char* moveStr) {
    engine.makeMove(string(moveStr));
  }

  EMSCRIPTEN_KEEPALIVE
  const char* getBestMove() {
    string result = engine.getBestMove();
    
    static char buffer[10];
    strncpy(buffer, result.c_str(), sizeof(buffer) - 1);
    buffer[sizeof(buffer) - 1] = '\0';
    return buffer;
  }
}