// Game State
let peer = null;
let conn = null;
let isHost = false;
let roomCode = null;
let gameRunning = false;

// Canvas and Context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Players
let localPlayer = null;
let remotePlayer = null;

// Platforms
const platforms = [];

// Controls
const keys = {
    left: false,
    right: false,
    jump: false
};

// Room Code Functions
function generateRoomCode() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

function validateRoomCode(code) {
    return /^\d{5}$/.test(code);
}

// PeerJS Setup
function initPeer(customId = null) {
    const peerOptions = {
        debug: 2
    };
    
    if (customId) {
        peerOptions.id = customId;
    }
    
    peer = new Peer(peerOptions);
    
    peer.on('open', (id) => {
        console.log('Connected with ID:', id);
        if (isHost) {
            roomCode = generateRoomCode();
            document.getElementById('roomCode').textContent = roomCode;
            document.getElementById('roomCodeDisplay').style.display = 'block';
        }
    });
    
    peer.on('connection', (connection) => {
        if (isHost && !conn) {
            conn = connection;
            setupConnection(conn);
            startGame();
        }
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            // ID already taken, generate new one
            const newId = 'game-' + generateRoomCode();
            initPeer(newId);
        }
    });
}

function setupConnection(connection) {
    conn = connection;
    
    conn.on('open', () => {
        console.log('Connection established');
        if (!isHost) {
            startGame();
        }
    });
    
    conn.on('data', (data) => {
        handleGameData(data);
    });
    
    conn.on('close', () => {
        console.log('Connection closed');
        endGame();
    });
    
    conn.on('error', (err) => {
        console.error('Connection error:', err);
    });
}

function connectToPeer(peerId) {
    const connection = peer.connect(peerId);
    setupConnection(connection);
}

// Game Data Handling
function handleGameData(data) {
    if (data.type === 'playerUpdate') {
        if (remotePlayer) {
            remotePlayer.x = data.x;
            remotePlayer.y = data.y;
            remotePlayer.vx = data.vx;
            remotePlayer.vy = data.vy;
        }
    }
}

function sendPlayerUpdate() {
    if (conn && conn.open) {
        conn.send({
            type: 'playerUpdate',
            x: localPlayer.x,
            y: localPlayer.y,
            vx: localPlayer.vx,
            vy: localPlayer.vy
        });
    }
}

// Player Class
class Player {
    constructor(x, y, color, isLocal) {
        this.x = x;
        this.y = y;
        this.width = 40;
        this.height = 60;
        this.vx = 0;
        this.vy = 0;
        this.speed = 5;
        this.jumpForce = -15;
        this.gravity = 0.8;
        this.grounded = false;
        this.color = color;
        this.isLocal = isLocal;
    }
    
    update() {
        // Apply gravity
        this.vy += this.gravity;
        
        // Apply velocity
        this.x += this.vx;
        this.y += this.vy;
        
        // Platform collision
        this.grounded = false;
        for (const platform of platforms) {
            if (this.x < platform.x + platform.width &&
                this.x + this.width > platform.x &&
                this.y + this.height > platform.y &&
                this.y + this.height < platform.y + platform.height + this.vy + 1 &&
                this.vy >= 0) {
                this.y = platform.y - this.height;
                this.vy = 0;
                this.grounded = true;
            }
        }
        
        // Boundary collision
        if (this.x < 0) this.x = 0;
        if (this.x + this.width > canvas.width) this.x = canvas.width - this.width;
        if (this.y + this.height > canvas.height) {
            this.y = canvas.height - this.height;
            this.vy = 0;
            this.grounded = true;
        }
        
        // Friction
        this.vx *= 0.8;
    }
    
    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Draw eyes
        ctx.fillStyle = 'white';
        ctx.fillRect(this.x + 8, this.y + 10, 8, 8);
        ctx.fillRect(this.x + 24, this.y + 10, 8, 8);
        
        ctx.fillStyle = 'black';
        ctx.fillRect(this.x + 10, this.y + 12, 4, 4);
        ctx.fillRect(this.x + 26, this.y + 12, 4, 4);
    }
    
    move(direction) {
        if (direction === 'left') {
            this.vx = -this.speed;
        } else if (direction === 'right') {
            this.vx = this.speed;
        }
    }
    
    jump() {
        if (this.grounded) {
            this.vy = this.jumpForce;
            this.grounded = false;
        }
    }
}

// Platform Class
class Platform {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }
    
    draw() {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Grass on top
        ctx.fillStyle = '#228B22';
        ctx.fillRect(this.x, this.y, this.width, 10);
    }
}

// Initialize Game
function initGame() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Create platforms
    platforms.length = 0;
    
    // Ground
    platforms.push(new Platform(0, canvas.height - 50, canvas.width, 50));
    
    // Floating platforms
    platforms.push(new Platform(100, canvas.height - 200, 200, 30));
    platforms.push(new Platform(canvas.width - 300, canvas.height - 300, 200, 30));
    platforms.push(new Platform(canvas.width / 2 - 100, canvas.height - 400, 200, 30));
    platforms.push(new Platform(50, canvas.height - 500, 150, 30));
    platforms.push(new Platform(canvas.width - 200, canvas.height - 500, 150, 30));
    
    // Create players
    const playerY = canvas.height - 150;
    if (isHost) {
        localPlayer = new Player(100, playerY, '#FF6B6B', true);
        remotePlayer = new Player(canvas.width - 150, playerY, '#4ECDC4', false);
    } else {
        localPlayer = new Player(canvas.width - 150, playerY, '#4ECDC4', true);
        remotePlayer = new Player(100, playerY, '#FF6B6B', false);
    }
}

// Game Loop
function gameLoop() {
    if (!gameRunning) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw platforms
    for (const platform of platforms) {
        platform.draw();
    }
    
    // Update and draw local player
    if (localPlayer) {
        if (keys.left) localPlayer.move('left');
        if (keys.right) localPlayer.move('right');
        if (keys.jump) localPlayer.jump();
        
        localPlayer.update();
        localPlayer.draw();
        
        // Send update to peer
        sendPlayerUpdate();
    }
    
    // Draw remote player
    if (remotePlayer) {
        remotePlayer.draw();
    }
    
    requestAnimationFrame(gameLoop);
}

// Start Game
function startGame() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
    
    initGame();
    gameRunning = true;
    
    document.getElementById('playerInfo').textContent = isHost ? 'Игрок 1 (Хост)' : 'Игрок 2';
    
    gameLoop();
}

// End Game
function endGame() {
    gameRunning = false;
    
    if (conn) {
        conn.close();
        conn = null;
    }
    
    if (peer) {
        peer.destroy();
        peer = null;
    }
    
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'block';
    document.getElementById('roomCodeDisplay').style.display = 'none';
    document.getElementById('joinRoomSection').style.display = 'none';
    
    isHost = false;
    roomCode = null;
    localPlayer = null;
    remotePlayer = null;
}

// Event Listeners
document.getElementById('createRoomBtn').addEventListener('click', () => {
    isHost = true;
    initPeer();
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
    document.getElementById('joinRoomSection').style.display = 'block';
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const code = document.getElementById('roomCodeInput').value;
    
    if (!validateRoomCode(code)) {
        alert('Введите 5-значный код комнаты');
        return;
    }
    
    isHost = false;
    const peerId = 'game-' + code;
    initPeer();
    
    peer.on('open', () => {
        connectToPeer(peerId);
    });
});

document.getElementById('leaveBtn').addEventListener('click', endGame);

// Keyboard Controls (PC)
document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') keys.jump = true;
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') keys.jump = false;
});

// Touch Controls (Mobile)
document.getElementById('leftBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.left = true;
});

document.getElementById('leftBtn').addEventListener('touchend', () => {
    keys.left = false;
});

document.getElementById('rightBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.right = true;
});

document.getElementById('rightBtn').addEventListener('touchend', () => {
    keys.right = false;
});

document.getElementById('jumpBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.jump = true;
});

document.getElementById('jumpBtn').addEventListener('touchend', () => {
    keys.jump = false;
});

// Window resize
window.addEventListener('resize', () => {
    if (gameRunning) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Recreate platforms
        platforms.length = 0;
        platforms.push(new Platform(0, canvas.height - 50, canvas.width, 50));
        platforms.push(new Platform(100, canvas.height - 200, 200, 30));
        platforms.push(new Platform(canvas.width - 300, canvas.height - 300, 200, 30));
        platforms.push(new Platform(canvas.width / 2 - 100, canvas.height - 400, 200, 30));
        platforms.push(new Platform(50, canvas.height - 500, 150, 30));
        platforms.push(new Platform(canvas.width - 200, canvas.height - 500, 150, 30));
    }
});
