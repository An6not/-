// Game State
let peer = null;
let conn = null;
let isHost = false;
let roomCode = null;
let gameRunning = false;
let connectionRetries = 0;
let maxRetries = 3;

// Three.js
let scene, camera, renderer;
let localPlayerMesh, remotePlayerMesh;
let platforms = [];

// Controls
let joystick = null;
let joystickData = { x: 0, y: 0 };
let keys = {
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

// PeerJS Setup with improved error handling
function initPeer(customId = null) {
    connectionRetries = 0;
    
    const peerOptions = {
        debug: 1
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
        if (err.type === 'unavailable-id' && connectionRetries < maxRetries) {
            connectionRetries++;
            const newId = 'game-' + generateRoomCode() + '-' + Date.now();
            initPeer(newId);
        } else if (err.type === 'peer-unavailable') {
            alert('Игрок не найден. Проверьте код комнаты.');
        } else {
            alert('Ошибка соединения: ' + err.message);
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
        if (gameRunning) {
            alert('Соединение разорвано');
            endGame();
        }
    });
    
    conn.on('error', (err) => {
        console.error('Connection error:', err);
    });
}

function connectToPeer(peerId) {
    const connection = peer.connect(peerId, {
        reliable: true
    });
    setupConnection(connection);
}

// Game Data Handling
function handleGameData(data) {
    if (data.type === 'playerUpdate' && remotePlayerMesh) {
        remotePlayerMesh.position.x = data.x;
        remotePlayerMesh.position.y = data.y;
        remotePlayerMesh.userData.vx = data.vx;
        remotePlayerMesh.userData.vy = data.vy;
    }
}

function sendPlayerUpdate() {
    if (conn && conn.open && localPlayerMesh) {
        conn.send({
            type: 'playerUpdate',
            x: localPlayerMesh.position.x,
            y: localPlayerMesh.position.y,
            vx: localPlayerMesh.userData.vx,
            vy: localPlayerMesh.userData.vy
        });
    }
}

// Three.js Setup
function initThreeJS() {
    const container = document.getElementById('gameCanvas');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    
    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 20);
    camera.lookAt(0, 0, 0);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Create platforms
    createPlatforms();
    
    // Create players
    createPlayers();
    
    // Handle resize
    window.addEventListener('resize', onWindowResize);
}

function createPlatforms() {
    // Ground
    const groundGeometry = new THREE.BoxGeometry(30, 1, 10);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.position.set(0, -5, 0);
    ground.receiveShadow = true;
    ground.userData = { isPlatform: true, width: 30, height: 1 };
    scene.add(ground);
    platforms.push(ground);
    
    // Floating platforms
    const platformPositions = [
        { x: -8, y: 0, z: 0, w: 6, h: 0.5 },
        { x: 8, y: 2, z: 0, w: 6, h: 0.5 },
        { x: 0, y: 4, z: 0, w: 8, h: 0.5 },
        { x: -10, y: 7, z: 0, w: 5, h: 0.5 },
        { x: 10, y: 7, z: 0, w: 5, h: 0.5 }
    ];
    
    platformPositions.forEach(pos => {
        const geometry = new THREE.BoxGeometry(pos.w, pos.h, 4);
        const material = new THREE.MeshLambertMaterial({ color: 0x228B22 });
        const platform = new THREE.Mesh(geometry, material);
        platform.position.set(pos.x, pos.y, pos.z);
        platform.receiveShadow = true;
        platform.castShadow = true;
        platform.userData = { isPlatform: true, width: pos.w, height: pos.h };
        scene.add(platform);
        platforms.push(platform);
    });
}

function createPlayers() {
    // Player geometry
    const playerGeometry = new THREE.BoxGeometry(1, 2, 1);
    
    // Local player
    const localMaterial = new THREE.MeshLambertMaterial({ color: isHost ? 0xFF6B6B : 0x4ECDC4 });
    localPlayerMesh = new THREE.Mesh(playerGeometry, localMaterial);
    localPlayerMesh.position.set(isHost ? -10 : 10, 0, 0);
    localPlayerMesh.castShadow = true;
    localPlayerMesh.userData = {
        vx: 0,
        vy: 0,
        speed: 0.15,
        jumpForce: 0.35,
        gravity: 0.015,
        grounded: false,
        width: 1,
        height: 2
    };
    scene.add(localPlayerMesh);
    
    // Remote player
    const remoteMaterial = new THREE.MeshLambertMaterial({ color: isHost ? 0x4ECDC4 : 0xFF6B6B });
    remotePlayerMesh = new THREE.Mesh(playerGeometry, remoteMaterial);
    remotePlayerMesh.position.set(isHost ? 10 : -10, 0, 0);
    remotePlayerMesh.castShadow = true;
    remotePlayerMesh.userData = {
        vx: 0,
        vy: 0,
        width: 1,
        height: 2
    };
    scene.add(remotePlayerMesh);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Player physics
function updatePlayer(player) {
    const data = player.userData;
    
    // Apply gravity
    data.vy -= data.gravity;
    
    // Apply velocity
    player.position.x += data.vx;
    player.position.y += data.vy;
    
    // Platform collision
    data.grounded = false;
    
    for (const platform of platforms) {
        const pData = platform.userData;
        const pX = platform.position.x;
        const pY = platform.position.y;
        
        // Check collision
        if (player.position.x > pX - pData.width/2 - data.width/2 &&
            player.position.x < pX + pData.width/2 + data.width/2 &&
            player.position.y - data.height/2 > pY - pData.height/2 &&
            player.position.y - data.height/2 < pY + pData.height/2 + data.vy + 0.1 &&
            data.vy <= 0) {
            
            player.position.y = pY + pData.height/2 + data.height/2;
            data.vy = 0;
            data.grounded = true;
        }
    }
    
    // Boundary collision
    if (player.position.x < -15) player.position.x = -15;
    if (player.position.x > 15) player.position.x = 15;
    if (player.position.y < -5) {
        player.position.y = -5;
        data.vy = 0;
        data.grounded = true;
    }
    
    // Friction
    data.vx *= 0.85;
}

function movePlayer(direction) {
    if (localPlayerMesh) {
        if (direction === 'left') {
            localPlayerMesh.userData.vx = -localPlayerMesh.userData.speed;
        } else if (direction === 'right') {
            localPlayerMesh.userData.vx = localPlayerMesh.userData.speed;
        }
    }
}

function jumpPlayer() {
    if (localPlayerMesh && localPlayerMesh.userData.grounded) {
        localPlayerMesh.userData.vy = localPlayerMesh.userData.jumpForce;
        localPlayerMesh.userData.grounded = false;
    }
}

// Game Loop
function gameLoop() {
    if (!gameRunning) return;
    
    // Update local player
    if (localPlayerMesh) {
        // Keyboard controls
        if (keys.left) movePlayer('left');
        if (keys.right) movePlayer('right');
        if (keys.jump) jumpPlayer();
        
        // Joystick controls
        if (joystickData.x !== 0) {
            localPlayerMesh.userData.vx = joystickData.x * localPlayerMesh.userData.speed;
        }
        
        updatePlayer(localPlayerMesh);
        
        // Send update to peer
        sendPlayerUpdate();
    }
    
    // Update camera to follow local player
    if (localPlayerMesh) {
        camera.position.x = localPlayerMesh.position.x * 0.3;
        camera.lookAt(localPlayerMesh.position.x * 0.3, 0, 0);
    }
    
    renderer.render(scene, camera);
    requestAnimationFrame(gameLoop);
}

// Initialize Joystick
function initJoystick() {
    const zone = document.getElementById('joystickZone');
    
    joystick = nipplejs.create({
        zone: zone,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'rgba(255, 255, 255, 0.8)',
        size: 120
    });
    
    joystick.on('move', (evt, data) => {
        if (data.vector) {
            joystickData.x = data.vector.x;
            joystickData.y = data.vector.y;
        }
    });
    
    joystick.on('end', () => {
        joystickData.x = 0;
        joystickData.y = 0;
    });
}

// Fullscreen
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log('Fullscreen error:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// Start Game
function startGame() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
    
    initThreeJS();
    initJoystick();
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
    
    if (joystick) {
        joystick.destroy();
        joystick = null;
    }
    
    if (renderer) {
        renderer.dispose();
        renderer = null;
    }
    
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'block';
    document.getElementById('roomCodeDisplay').style.display = 'none';
    document.getElementById('joinRoomSection').style.display = 'none';
    
    // Clear scene
    while(scene && scene.children.length > 0) {
        scene.remove(scene.children[0]);
    }
    
    isHost = false;
    roomCode = null;
    localPlayerMesh = null;
    remotePlayerMesh = null;
    platforms = [];
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
document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

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

// Touch Controls (Mobile) - Multitouch support
document.getElementById('jumpBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.jump = true;
});

document.getElementById('jumpBtn').addEventListener('touchend', (e) => {
    e.preventDefault();
    keys.jump = false;
});

// Prevent default touch behaviors to enable multitouch
document.addEventListener('touchmove', (e) => {
    if (e.target.closest('#joystickZone') || e.target.closest('#mobileControls')) {
        e.preventDefault();
    }
}, { passive: false });
