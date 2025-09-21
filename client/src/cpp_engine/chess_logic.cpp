#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <cstdint>
#include <unordered_map>
#include <random>
#include <fstream>
#include <limits>

using namespace std;

// --- Helper Tools ---
#define set_bit(bitboard, square) ((bitboard) |= (1ULL << (square)))
#define get_bit(bitboard, square) ((bitboard) & (1ULL << (square)))
#define pop_bit(bitboard, square) ((bitboard) &= ~(1ULL << (square)))

enum Square {
    a8, b8, c8, d8, e8, f8, g8, h8, a7, b7, c7, d7, e7, f7, g7, h7,
    a6, b6, c6, d6, e6, f6, g6, h6, a5, b5, c5, d5, e5, f5, g5, h5,
    a4, b4, c4, d4, e4, f4, g4, h4, a3, b3, c3, d3, e3, f3, g3, h3,
    a2, b2, c2, d2, e2, f2, g2, h2, a1, b1, c1, d1, e1, f1, g1, h1, no_sq
};

int pieceToIndex(char piece) {
    switch (piece) {
        case 'P': return 0; case 'N': return 1; case 'B': return 2; case 'R': return 3; case 'Q': return 4; case 'K': return 5;
        case 'p': return 6; case 'n': return 7; case 'b': return 8; case 'r': return 9; case 'q': return 10; case 'k': return 11;
        default: return -1;
    }
}

// A structure to hold detailed move information
struct Move {
    int from;
    int to;
    int promotion = 0;
};

// --- Class Definition ---
class ChessEngine {
public:
    ChessEngine();
    void setPosition(const string& fen);
    string getBestMove(int depth);

private:
    uint64_t bitboards[12];
    uint64_t occupancies[3];
    char activeTurn;
    string castlingRights;
    int enPassantSquare;
    int halfmoveClock;
    int fullmoveNumber;

    int search(int depth, int alpha, int beta, bool isMaximizingPlayer);
    int evaluate();
    vector<Move> generateMoves();
    void makeMove(const Move& move);
    void unmakeMove();

    vector<vector<vector<uint64_t>>> zobristTable;
    unordered_map<uint64_t, string> openingBook;
    void initZobrist();
    uint64_t calculateHash();
    void loadOpeningBook();
};

// --- Constructor and Implementations ---
ChessEngine::ChessEngine() {
    initZobrist();
    loadOpeningBook();
}

void ChessEngine::setPosition(const string& fen) {
    for (int i = 0; i < 12; ++i) { bitboards[i] = 0ULL; }
    for (int i = 0; i < 3; ++i) { occupancies[i] = 0ULL; }
    
    istringstream iss(fen);
    string boardStr, turnStr, castlingStr, enPassantStr, halfmoveStr, fullmoveStr;
    iss >> boardStr >> turnStr >> castlingStr >> enPassantStr >> halfmoveStr >> fullmoveStr;

    activeTurn = turnStr[0];
    castlingRights = castlingStr;
    halfmoveClock = stoi(halfmoveStr);
    fullmoveNumber = stoi(fullmoveStr);
    
    int rank = 7; int file = 0;
    for (char c : boardStr) {
        if (c == '/') { rank--; file = 0; } 
        else if (isdigit(c)) { file += c - '0'; } 
        else {
            int piece = pieceToIndex(c);
            int square = rank * 8 + file;
            set_bit(bitboards[piece], square);
            file++;
        }
    }
    occupancies[0] = bitboards[0] | bitboards[1] | bitboards[2] | bitboards[3] | bitboards[4] | bitboards[5];
    occupancies[1] = bitboards[6] | bitboards[7] | bitboards[8] | bitboards[9] | bitboards[10] | bitboards[11];
    occupancies[2] = occupancies[0] | occupancies[1];
}

string ChessEngine::getBestMove(int depth) {
    uint64_t currentHash = calculateHash();
    if (openingBook.count(currentHash)) {
        return openingBook.at(currentHash);
    }
    
    // TODO: Implement the main search call that uses the search() function.
    return "a2a3"; // Placeholder
}

int ChessEngine::search(int depth, int alpha, int beta, bool isMaximizingPlayer) {
    // TODO: Implement your Alpha-Beta Pruning search function here.
    return 0; // Placeholder
}

int ChessEngine::evaluate() {
    // TODO: Implement your evaluation function here (material, position, etc.).
    return 0; // Placeholder
}

vector<Move> ChessEngine::generateMoves() {
    // TODO: Implement your move generator here (based on bitboards).
    return {}; // Placeholder
}

void ChessEngine::makeMove(const Move& move) {
    // TODO: Implement the logic to update bitboards for a move.
}

void ChessEngine::unmakeMove() {
    // TODO: Implement the logic to undo a move on the bitboards.
}

// --- Zobrist and Book Loading ---
void ChessEngine::initZobrist() {
    zobristTable.resize(8, vector<vector<uint64_t>>(8, vector<uint64_t>(12)));
    mt19937_64 rng(12345);
    uniform_int_distribution<uint64_t> dist;
    for (int i=0; i<8; ++i) for (int j=0; j<8; ++j) for (int k=0; k<12; ++k) zobristTable[i][j][k] = dist(rng);
}

uint64_t ChessEngine::calculateHash() {
    uint64_t hash = 0;
    for (int p = 0; p < 12; ++p) {
        uint64_t bb = bitboards[p];
        while (bb) {
            int sq = __builtin_ctzll(bb);
            hash ^= zobristTable[sq/8][sq%8][p];
            pop_bit(bb, sq);
        }
    }
    return hash;
}

void ChessEngine::loadOpeningBook() {
    ifstream bookFile("opening_book.txt");
    string line;
    if (!bookFile.is_open()) return;
    while (getline(bookFile, line)) {
        if (line.empty() || line[0] == '#') continue;
        stringstream ss(line);
        string hashStr, moveStr;
        if (getline(ss, hashStr, ',') && getline(ss, moveStr)) {
            openingBook[stoull(hashStr)] = moveStr;
        }
    }
    bookFile.close();
}