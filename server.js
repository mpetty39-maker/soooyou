const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve frontend static files
app.use(express.static(__dirname));

// --- WORD BANK ---
const WORD_BANK = [
  '“At least it’s Friday!”', '“Bro”', '“Can we put the air on?”', '“Dude”', '“Have you considered…”',
  '“I did that once, but…”', '“I don’t eat that…”', '“I forgot…”', '“I found a deal on this…”',
  '“I got an idea.”', '“I have one right here…”', '“I need a vacation!”', '“I’m gonna be late…”',
  '“It’s complicated.”', '“It’s freezing in here.”', '“Keep it simple.”', '“Let me tell you the dream I had.”',
  '“Let’s go all out.”', '“Let’s try something new.”', 'LOL', 'Sorry.', '“That’s Sick.”', '“This is the worst.”',
  '“What do you want to do?”', '“What’s going on?”', '“Yeah, sign me up!”', '“You can borrow mine."',
  '“I think you should....”', 'A+', 'Answers', 'Art', 'Write an Article', 'Backpack', 'Bacon', 'Big Words',
  'Books', 'Bread', 'Busy', 'Camping', 'Cars', 'Center Stage', 'Christmas', 'Clothes', 'Collector',
  'Comics', 'Competitive', 'Computer', 'Cook', 'Creative', 'Dancing', 'Sci-Fi', 'Daydreams', 'Documentary',
  'Donuts', 'Facebook', 'Faith', 'Flip Flops', 'Football', 'Fantasy Stories', 'Self-Proclaimed Geek', 'Grillin’',
  'Guitar', 'Halloween', 'Science', 'Hat', 'History', 'Hoarder', 'Math', 'Hunting', 'Ice Cream', 'Inspire',
  'Instagram', 'Investor', 'Jeep', 'Jokes', 'Kind', 'Knowledge', 'Laptop', 'Laughing', 'Leader', 'Library',
  'Heard', 'Mind on Work', 'Morning', 'Quotes Movies', 'Old Movies', 'Music', 'Neat Freak', 'Negotiator',
  'Night', 'Ninja', 'Old West', 'Open Minded', 'Paint', 'Party Time', 'Personality', 'Phone', 'Piano', 'Pirate',
  'Poetry', 'Politics', 'Has a Blog', 'Posting Memes', 'Pranks', 'Predictable', 'Professional', 'Puns',
  'Questions', 'Quiet', 'Sandals', 'School', 'Surprised', 'Shoe Shopping', 'Shorts', 'Side Lines', 'Silly',
  'Singing', 'Sleep', 'Sneak', 'Snow', 'Soda', 'Spend', 'Afraid of Spiders', 'Helpful', '“Whatever.”',
  'Realistic Squirrel', 'Strong Willed', 'Taco Bell', 'Tea', 'Thinking', 'Tough', 'Trivia', 'Trusted',
  'Unexpected', 'Unnoticed', 'Video Games', 'Watch TV', 'Water', 'Winner', 'Traveler', 'YouTube'
];

const NONE_BTN = "None of These Friends";

// Active Rooms State
const rooms = {};

io.on('connection', (socket) => {

  // Create Room
  socket.on('createRoom', ({ playerName, totalPlayers }) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    rooms[roomCode] = {
      hostId: socket.id,
      totalPlayersTarget: parseInt(totalPlayers),
      players: [playerName],
      playerSockets: { [playerName]: socket.id },
      usedWords: new Set(),
      currentRound: 1,
      currentTags: [],
      submissions: [],
      cumulativeScores: { [playerName]: 0 }
    };

    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players, target: rooms[roomCode].totalPlayersTarget });
  });

  // Join Room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      return socket.emit('errorMsg', 'Room code not found!');
    }
    if (room.players.includes(playerName)) {
      return socket.emit('errorMsg', 'Name taken! Choose another.');
    }
    if (room.players.length >= room.totalPlayersTarget) {
      return socket.emit('errorMsg', 'Room is already full!');
    }

    room.players.push(playerName);
    room.playerSockets[playerName] = socket.id;
    room.cumulativeScores[playerName] = 0;

    socket.join(code);
    socket.emit('joinSuccess');

    // Notify all in room of new player list
    io.to(code).emit('updateLobby', { players: room.players, target: room.totalPlayersTarget });

    // Auto-start round 1 when full
    if (room.players.length === room.totalPlayersTarget) {
      startRound(code);
    }
  });

  // Handle Tag Submissions
  socket.on('submitPairings', ({ roomCode, playerName, pairings }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.submissions.push({ playerName, pairings });

    if (room.submissions.length === room.players.length) {
      calculateScores(code);
    }
  });

  // Proceed to Next Round
  socket.on('nextRound', ({ roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room || socket.id !== room.hostId) return;

    if (room.currentRound < 3) {
      room.currentRound++;
      startRound(code);
    }
  });
});

function startRound(roomCode) {
  const room = rooms[roomCode];
  room.submissions = [];
  
  // Dynamic tag counts based on player count
  let numTags;
  if (room.players.length === 3) {
    numTags = 4;
  } else if (room.players.length === 4) {
    numTags = 5;
  } else {
    numTags = 6;
  }
  
  room.currentTags = [];

  while (room.currentTags.length < numTags) {
    const randomWord = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
    if (!room.usedWords.has(randomWord)) {
      room.usedWords.add(randomWord);
      room.currentTags.push(randomWord);
    }
  }

  io.to(roomCode).emit('startRound', {
    round: room.currentRound,
    tags: room.currentTags,
    players: room.players
  });
}

function calculateScores(roomCode) {
  const room = rooms[roomCode];
  const allColumns = [...room.players, NONE_BTN];

  // Initialize count matrix
  let matrix = {};
  room.currentTags.forEach((_, tIdx) => {
    matrix[tIdx] = {};
    allColumns.forEach(col => matrix[tIdx][col] = 0);
  });

  // Fill matrix with player votes
  room.submissions.forEach(sub => {
    Object.entries(sub.pairings).forEach(([tIdx, name]) => {
      matrix[tIdx][name] = (matrix[tIdx][name] || 0) + 1;
    });
  });

  let roundScores = {};
  room.players.forEach(p => roundScores[p] = 0);

  // Determine top-voted choices for each tag (including NONE_BTN)
  let tagWinners = {};
  room.currentTags.forEach((_, tIdx) => {
    let maxCount = 0;

    // Find highest vote count across all columns (players + "None")
    allColumns.forEach(col => {
      if (matrix[tIdx][col] > maxCount) maxCount = matrix[tIdx][col];
    });

    tagWinners[tIdx] = [];
    // Only count as a winner if 2 or more people agreed (plurality rule)
    if (maxCount > 1) {
      allColumns.forEach(col => {
        if (matrix[tIdx][col] === maxCount) {
          tagWinners[tIdx].push(col);
        }
      });
    }
  });

  // Calculate points and perfect-round bonuses
  let bonuses = {};
  room.submissions.forEach(sub => {
    let pName = sub.playerName;
    let correctCount = 0;

    room.currentTags.forEach((_, tIdx) => {
      let chosen = sub.pairings[tIdx];
      // Check if player's choice matches any top-voted option (player OR "None of These Friends")
      if (tagWinners[tIdx].includes(chosen)) {
        roundScores[pName] += 1;
        correctCount++;
      }
    });

    // Perfect sweep bonus (+2)
    if (correctCount === room.currentTags.length) {
      roundScores[pName] += 2;
      bonuses[pName] = true;
    }
  });

  // Accumulate total game scores
  room.players.forEach(p => {
    room.cumulativeScores[p] = (room.cumulativeScores[p] || 0) + roundScores[p];
  });

  io.to(roomCode).emit('roundResults', {
    round: room.currentRound,
    tags: room.currentTags,
    submissions: room.submissions,
    matrix: matrix,
    roundScores: roundScores,
    cumulativeScores: room.cumulativeScores,
    bonuses: bonuses
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));