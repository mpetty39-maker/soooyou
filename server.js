const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve frontend static files from the same directory
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
  'Books', 'Bread', 'Busy', 'Camping', 'Cars', 'Center Stage', 'Christmas', 'Clothes', 'Coffee', 'Collector',
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
  socket.on('createRoom', ({ hostName, playerCount }) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const targetCount = parseInt(playerCount, 10);
    
    rooms[roomCode] = {
      hostId: socket.id,
      targetPlayerCount: targetCount,
      players: [hostName],
      playerSockets: { [hostName]: socket.id },
      usedWords: new Set(),
      currentRound: 1,
      currentTags: [],
      submissions: [],
      cumulativeScores: { [hostName]: 0 }
    };

    socket.join(roomCode);
    socket.emit('roomCreated', { 
      roomCode: roomCode, 
      players: rooms[roomCode].players, 
      targetPlayerCount: targetCount 
    });
  });

  // Join Room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = (roomCode || '').toUpperCase();
    const room = rooms[code];

    if (!room) {
      return socket.emit('errorMessage', 'Room code not found!');
    }
    if (room.players.includes(playerName)) {
      return socket.emit('errorMessage', 'Name taken! Choose another.');
    }
    if (room.players.length >= room.targetPlayerCount) {
      return socket.emit('errorMessage', 'Room is already full!');
    }

    room.players.push(playerName);
    room.playerSockets[playerName] = socket.id;
    room.cumulativeScores[playerName] = 0;

    socket.join(code);
    socket.emit('joinSuccess', { roomCode: code, players: room.players });

    // Notify everyone in room of updated player list
    io.to(code).emit('playerJoined', { 
      players: room.players, 
      targetPlayerCount: room.targetPlayerCount 
    });

    // Auto-start game when lobby hits target count
    if (room.players.length === room.targetPlayerCount) {
      startRound(code);
    }
  });

  // Handle Tag Submissions
  socket.on('submitPairings', ({ roomCode, playerName, pairings }) => {
    const code = (roomCode || '').toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.submissions.push({ playerName, pairings });

    if (room.submissions.length === room.players.length) {
      calculateScores(code);
    }
  });

  // Proceed to Next Round
  socket.on('nextRound', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase();
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
  
  // Tag counts scale based on total player count
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

  let matrix = {};
  room.currentTags.forEach((_, tIdx) => {
    matrix[tIdx] = {};
    allColumns.forEach(col => matrix[tIdx][col] = 0);
  });

  room.submissions.forEach(sub => {
    Object.entries(sub.pairings).forEach(([tIdx, name]) => {
      matrix[tIdx][name] = (matrix[tIdx][name] || 0) + 1;
    });
  });

  let roundScores = {};
  room.players.forEach(p => roundScores[p] = 0);

  let tagWinners = {};
  room.currentTags.forEach((_, tIdx) => {
    let maxCount = 0;
    allColumns.forEach(col => {
      if (matrix[tIdx][col] > maxCount) maxCount = matrix[tIdx][col];
    });

    tagWinners[tIdx] = [];
    if (maxCount > 1) {
      allColumns.forEach(col => {
        if (matrix[tIdx][col] === maxCount) tagWinners[tIdx].push(col);
      });
    }
  });

  let bonuses = {};
  room.submissions.forEach(sub => {
    let pName = sub.playerName;
    let correctCount = 0;

    room.currentTags.forEach((_, tIdx) => {
      let chosen = sub.pairings[tIdx];
      if (tagWinners[tIdx].includes(chosen)) {
        roundScores[pName] += 1;
        correctCount++;
      }
    });

    if (correctCount === room.currentTags.length) {
      roundScores[pName] += 2;
      bonuses[pName] = true;
    }
  });

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