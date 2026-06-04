const PEER_PREFIX = 'fffaa-';
const SNAPSHOT_RATE_MS = 33;
const INTERPOLATION_DELAY_MS = 120;

const state = {
    mode: 'solo',
    peer: null,
    conn: null,
    roomCode: null,
    running: false,
    pointerLocked: false,
    lastNetSend: 0,
    sequence: 0,
    yaw: 0,
    pitch: 0,
    lookTouchId: null,
    lastLookTouch: null,
    keys: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        jump: false,
        sprint: false
    },
    stick: { x: 0, y: 0 }
};

let scene;
let camera;
let renderer;
let clock;
let localPlayer;
let remotePlayer;
let joystick;
let worldBounds = { x: 44, z: 44 };

const el = {
    menu: document.getElementById('mainMenu'),
    soloBtn: document.getElementById('soloBtn'),
    createRoomBtn: document.getElementById('createRoomBtn'),
    joinRoomBtn: document.getElementById('joinRoomBtn'),
    joinRoomSection: document.getElementById('joinRoomSection'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    joinBtn: document.getElementById('joinBtn'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    roomCode: document.getElementById('roomCode'),
    connectionStatus: document.getElementById('connectionStatus'),
    gameContainer: document.getElementById('gameContainer'),
    canvasWrap: document.getElementById('gameCanvas'),
    playerInfo: document.getElementById('playerInfo'),
    netInfo: document.getElementById('netInfo'),
    leaveBtn: document.getElementById('leaveBtn'),
    joystickZone: document.getElementById('joystickZone'),
    jumpBtn: document.getElementById('jumpBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn')
};

function generateRoomCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
}

function isValidCode(code) {
    return /^\d{5}$/.test(code);
}

function setStatus(text) {
    el.connectionStatus.textContent = text;
}

function setNetInfo(text) {
    el.netInfo.textContent = text;
}

function showJoinPanel() {
    el.joinRoomSection.classList.toggle('hidden');
    el.roomCodeDisplay.classList.add('hidden');
    el.roomCodeInput.focus();
}

function createPeer(id) {
    return new Peer(id, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
}

function hostRoom() {
    destroyNetwork();
    state.mode = 'host';
    state.roomCode = generateRoomCode();
    el.roomCode.textContent = state.roomCode;
    el.roomCodeDisplay.classList.remove('hidden');
    el.joinRoomSection.classList.add('hidden');
    setStatus('Создаём P2P-комнату...');

    state.peer = createPeer(PEER_PREFIX + state.roomCode);
    state.peer.on('open', () => setStatus('Ожидание второго игрока...'));
    state.peer.on('connection', (connection) => {
        if (state.conn) {
            connection.close();
            return;
        }
        setupConnection(connection);
        setStatus('Игрок подключился. Запускаем...');
        startGame('host');
    });
    state.peer.on('error', (error) => {
        setStatus(error.type === 'unavailable-id' ? 'Код занят. Создайте комнату ещё раз.' : 'Ошибка P2P: ' + error.type);
        console.error(error);
    });
}

function joinRoom() {
    const code = el.roomCodeInput.value.trim();
    if (!isValidCode(code)) {
        el.roomCode.textContent = '-----';
        el.roomCodeDisplay.classList.remove('hidden');
        setStatus('Введите ровно 5 цифр.');
        return;
    }

    destroyNetwork();
    state.mode = 'client';
    state.roomCode = code;
    el.roomCode.textContent = code;
    el.roomCodeDisplay.classList.remove('hidden');
    setStatus('Подключаемся к комнате...');

    state.peer = createPeer();
    state.peer.on('open', () => setupConnection(state.peer.connect(PEER_PREFIX + code, { reliable: true })));
    state.peer.on('error', (error) => {
        setStatus(error.type === 'peer-unavailable' ? 'Комната не найдена.' : 'Ошибка P2P: ' + error.type);
        console.error(error);
    });
}

function setupConnection(connection) {
    state.conn = connection;
    connection.on('open', () => {
        setNetInfo('p2p online');
        if (state.mode === 'client') startGame('client');
        sendNetwork({ type: 'hello', role: state.mode, version: 2 });
    });
    connection.on('data', handleNetworkMessage);
    connection.on('close', () => {
        setNetInfo('p2p closed');
        if (remotePlayer) remotePlayer.visible = false;
    });
    connection.on('error', console.error);
}

function handleNetworkMessage(message) {
    if (!message || message.type !== 'snapshot' || !remotePlayer) return;

    const sample = {
        time: performance.now(),
        sequence: message.sequence || 0,
        position: new THREE.Vector3(message.x, message.y, message.z),
        velocity: new THREE.Vector3(message.vx, message.vy, message.vz),
        yaw: message.yaw || 0,
        pitch: message.pitch || 0
    };

    const last = remotePlayer.buffer[remotePlayer.buffer.length - 1];
    if (last && sample.sequence <= last.sequence) return;

    remotePlayer.buffer.push(sample);
    if (remotePlayer.buffer.length > 20) remotePlayer.buffer.shift();
    remotePlayer.visible = true;
}

function sendNetwork(message) {
    if (state.conn && state.conn.open) state.conn.send(message);
}

function destroyNetwork() {
    if (state.conn) {
        state.conn.close();
        state.conn = null;
    }
    if (state.peer) {
        state.peer.destroy();
        state.peer = null;
    }
}

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa7d7df);
    scene.fog = new THREE.Fog(0xa7d7df, 55, 115);

    camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 180);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.canvasWrap.replaceChildren(renderer.domElement);

    clock = new THREE.Clock();
    addWorld();
    makePlayers();
    window.addEventListener('resize', resizeRenderer);
}

function addWorld() {
    const hemi = new THREE.HemisphereLight(0xf4feff, 0x4f6a5f, 1.05);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(18, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    scene.add(sun);

    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x6cb879, roughness: 0.88 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(92, 1, 92), groundMaterial);
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(92, 46, 0xffffff, 0xffffff);
    grid.position.y = 0.015;
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x536f68, roughness: 0.8 });
    addWall(0, 1.4, -46, 92, 2.8, 1, wallMaterial);
    addWall(0, 1.4, 46, 92, 2.8, 1, wallMaterial);
    addWall(-46, 1.4, 0, 1, 2.8, 92, wallMaterial);
    addWall(46, 1.4, 0, 1, 2.8, 92, wallMaterial);

    const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x7f7a61, roughness: 0.84 });
    addBox(-16, 0.55, -10, 8, 1.1, 5, obstacleMaterial);
    addBox(18, 0.55, 11, 10, 1.1, 6, obstacleMaterial);
    addBox(4, 0.35, -22, 12, 0.7, 4, obstacleMaterial);
}

function addWall(x, y, z, w, h, d, material) {
    addBox(x, y, z, w, h, d, material);
}

function addBox(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}

function makePlayers() {
    const localColor = state.mode === 'client' ? 0x2f8f83 : 0xd95c54;
    const remoteColor = state.mode === 'client' ? 0xd95c54 : 0x2f8f83;
    localPlayer = createPlayer(localColor, state.mode === 'client' ? 4 : -4, 0);
    localPlayer.mesh.visible = false;

    remotePlayer = createPlayer(remoteColor, state.mode === 'client' ? -4 : 4, 0);
    remotePlayer.visible = state.mode !== 'solo';
    remotePlayer.mesh.visible = remotePlayer.visible;
    remotePlayer.buffer = [];

    state.yaw = state.mode === 'client' ? Math.PI : 0;
    state.pitch = 0;
}

function createPlayer(color, x, z) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.25, 18), material);
    body.position.y = 0.78;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), material);
    head.position.y = 1.58;
    head.castShadow = true;
    group.add(head);

    const face = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.08, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.5 })
    );
    face.position.set(0, 1.62, -0.39);
    group.add(face);

    group.position.set(x, 0, z);
    scene.add(group);

    return {
        mesh: group,
        velocity: new THREE.Vector3(),
        radius: 0.42,
        eyeHeight: 1.62,
        speed: 8.5,
        sprintSpeed: 12,
        jump: 7.5,
        onGround: true,
        visible: true,
        buffer: []
    };
}

function startGame(mode) {
    state.mode = mode;
    state.running = true;
    state.lastNetSend = 0;
    state.sequence = 0;
    resetInput();

    el.menu.classList.add('hidden');
    el.gameContainer.classList.remove('hidden');
    el.playerInfo.textContent = mode === 'host' ? 'Игрок 1: хост' : mode === 'client' ? 'Игрок 2' : 'Одиночная игра';
    setNetInfo(mode === 'solo' ? 'offline' : 'p2p wait');

    initScene();
    initControls();
    requestAnimationFrame(loop);
}

function endGame() {
    state.running = false;
    destroyNetwork();
    exitPointerLock();

    if (joystick) {
        joystick.destroy();
        joystick = null;
    }
    if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
        renderer = null;
    }

    window.removeEventListener('resize', resizeRenderer);
    scene = null;
    camera = null;
    clock = null;
    localPlayer = null;
    remotePlayer = null;
    resetInput();

    el.gameContainer.classList.add('hidden');
    el.menu.classList.remove('hidden');
    setNetInfo('offline');
}

function resetInput() {
    state.keys.forward = false;
    state.keys.backward = false;
    state.keys.left = false;
    state.keys.right = false;
    state.keys.jump = false;
    state.keys.sprint = false;
    state.stick.x = 0;
    state.stick.y = 0;
    state.lookTouchId = null;
    state.lastLookTouch = null;
}

function initControls() {
    if (!joystick && window.nipplejs) {
        joystick = nipplejs.create({
            zone: el.joystickZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: '#ffffff',
            size: 118,
            multitouch: true,
            maxNumberOfNipples: 1
        });

        joystick.on('move', (_, data) => {
            if (!data.vector) return;
            state.stick.x = data.vector.x;
            state.stick.y = data.vector.y;
        });
        joystick.on('end', () => {
            state.stick.x = 0;
            state.stick.y = 0;
        });
    }
}

function updateLocalPlayer(dt) {
    const move = getMoveInput();
    const speed = state.keys.sprint ? localPlayer.sprintSpeed : localPlayer.speed;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);

    const worldX = move.x * cos - move.z * sin;
    const worldZ = move.x * sin + move.z * cos;

    localPlayer.velocity.x = worldX * speed;
    localPlayer.velocity.z = worldZ * speed;
    localPlayer.velocity.y -= 22 * dt;

    if (state.keys.jump && localPlayer.onGround) {
        localPlayer.velocity.y = localPlayer.jump;
        localPlayer.onGround = false;
    }

    localPlayer.mesh.position.x += localPlayer.velocity.x * dt;
    localPlayer.mesh.position.y += localPlayer.velocity.y * dt;
    localPlayer.mesh.position.z += localPlayer.velocity.z * dt;

    collideArena(localPlayer);
    localPlayer.mesh.rotation.y = state.yaw;
}

function getMoveInput() {
    let x = 0;
    let z = 0;

    if (state.keys.left) x -= 1;
    if (state.keys.right) x += 1;
    if (state.keys.forward) z -= 1;
    if (state.keys.backward) z += 1;

    if (Math.abs(state.stick.x) > 0.04 || Math.abs(state.stick.y) > 0.04) {
        x += state.stick.x;
        z -= state.stick.y;
    }

    const length = Math.hypot(x, z);
    if (length > 1) {
        x /= length;
        z /= length;
    }
    return { x, z };
}

function collideArena(player) {
    const p = player.mesh.position;
    p.x = THREE.MathUtils.clamp(p.x, -worldBounds.x, worldBounds.x);
    p.z = THREE.MathUtils.clamp(p.z, -worldBounds.z, worldBounds.z);

    if (p.y <= 0) {
        p.y = 0;
        player.velocity.y = 0;
        player.onGround = true;
    } else {
        player.onGround = false;
    }
}

function updateCamera() {
    const p = localPlayer.mesh.position;
    camera.position.set(p.x, p.y + localPlayer.eyeHeight, p.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = state.yaw;
    camera.rotation.x = state.pitch;
}

function updateRemotePlayer(now) {
    if (!remotePlayer || !remotePlayer.visible) return;
    remotePlayer.mesh.visible = true;

    const buffer = remotePlayer.buffer;
    if (buffer.length === 0) return;

    const renderTime = now - INTERPOLATION_DELAY_MS;
    while (buffer.length >= 2 && buffer[1].time <= renderTime) buffer.shift();

    let targetPosition;
    let targetYaw;

    if (buffer.length >= 2 && buffer[0].time <= renderTime && buffer[1].time >= renderTime) {
        const a = buffer[0];
        const b = buffer[1];
        const t = THREE.MathUtils.clamp((renderTime - a.time) / (b.time - a.time || 1), 0, 1);
        targetPosition = a.position.clone().lerp(b.position, smoothstep(t));
        targetYaw = lerpAngle(a.yaw, b.yaw, t);
    } else {
        const latest = buffer[buffer.length - 1];
        const dt = Math.min((renderTime - latest.time) / 1000, 0.12);
        targetPosition = latest.position.clone().addScaledVector(latest.velocity, Math.max(0, dt));
        targetYaw = latest.yaw;
    }

    remotePlayer.mesh.position.lerp(targetPosition, 0.42);
    remotePlayer.mesh.rotation.y = lerpAngle(remotePlayer.mesh.rotation.y, targetYaw, 0.35);
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function lerpAngle(a, b, t) {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * t;
}

function sendPlayerSnapshot(now) {
    if (state.mode === 'solo' || now - state.lastNetSend < SNAPSHOT_RATE_MS) return;
    state.lastNetSend = now;
    state.sequence += 1;
    sendNetwork({
        type: 'snapshot',
        sequence: state.sequence,
        x: localPlayer.mesh.position.x,
        y: localPlayer.mesh.position.y,
        z: localPlayer.mesh.position.z,
        vx: localPlayer.velocity.x,
        vy: localPlayer.velocity.y,
        vz: localPlayer.velocity.z,
        yaw: state.yaw,
        pitch: state.pitch
    });
}

function loop(now) {
    if (!state.running) return;
    const dt = Math.min(clock.getDelta(), 0.033);

    updateLocalPlayer(dt);
    updateCamera();
    updateRemotePlayer(now);
    sendPlayerSnapshot(now);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

function resizeRenderer() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(console.warn);
    } else {
        document.exitFullscreen().catch(console.warn);
    }
}

function requestPointerLock() {
    if (!state.running || isTouchDevice()) return;
    renderer.domElement.requestPointerLock?.();
}

function exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
}

function isTouchDevice() {
    return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
}

function lookBy(deltaX, deltaY, multiplier = 1) {
    state.yaw -= deltaX * 0.0026 * multiplier;
    state.pitch -= deltaY * 0.0022 * multiplier;
    state.pitch = THREE.MathUtils.clamp(state.pitch, -1.35, 1.35);
}

function bindEvents() {
    el.soloBtn.addEventListener('click', () => startGame('solo'));
    el.createRoomBtn.addEventListener('click', hostRoom);
    el.joinRoomBtn.addEventListener('click', showJoinPanel);
    el.joinBtn.addEventListener('click', joinRoom);
    el.leaveBtn.addEventListener('click', endGame);
    el.fullscreenBtn.addEventListener('click', toggleFullscreen);

    el.roomCodeInput.addEventListener('input', () => {
        el.roomCodeInput.value = el.roomCodeInput.value.replace(/\D/g, '').slice(0, 5);
    });

    document.addEventListener('keydown', (event) => setKey(event, true));
    document.addEventListener('keyup', (event) => setKey(event, false));

    document.addEventListener('pointerlockchange', () => {
        state.pointerLocked = document.pointerLockElement === renderer?.domElement;
    });
    document.addEventListener('mousemove', (event) => {
        if (state.pointerLocked) lookBy(event.movementX, event.movementY);
    });

    el.gameContainer.addEventListener('pointerdown', (event) => {
        if (!state.running) return;
        if (event.target.closest('#hud') || event.target.closest('#mobileControls') || event.target.closest('#joystickZone')) return;
        requestPointerLock();
    });

    el.gameContainer.addEventListener('touchstart', handleLookTouchStart, { passive: false });
    el.gameContainer.addEventListener('touchmove', handleLookTouchMove, { passive: false });
    el.gameContainer.addEventListener('touchend', handleLookTouchEnd, { passive: false });
    el.gameContainer.addEventListener('touchcancel', handleLookTouchEnd, { passive: false });

    bindHoldButton(el.jumpBtn, (pressed) => {
        state.keys.jump = pressed;
    });
}

function bindHoldButton(button, onChange) {
    button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        onChange(true);
        button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointerup', (event) => {
        event.preventDefault();
        onChange(false);
    });
    button.addEventListener('pointercancel', () => onChange(false));
    button.addEventListener('lostpointercapture', () => onChange(false));
}

function handleLookTouchStart(event) {
    if (!state.running) return;
    for (const touch of event.changedTouches) {
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target?.closest('#hud') || target?.closest('#mobileControls') || target?.closest('#joystickZone')) continue;
        if (touch.clientX > window.innerWidth * 0.38 && state.lookTouchId === null) {
            state.lookTouchId = touch.identifier;
            state.lastLookTouch = { x: touch.clientX, y: touch.clientY };
            event.preventDefault();
            break;
        }
    }
}

function handleLookTouchMove(event) {
    if (state.lookTouchId === null) return;
    for (const touch of event.changedTouches) {
        if (touch.identifier !== state.lookTouchId) continue;
        const dx = touch.clientX - state.lastLookTouch.x;
        const dy = touch.clientY - state.lastLookTouch.y;
        state.lastLookTouch = { x: touch.clientX, y: touch.clientY };
        lookBy(dx, dy, 1.45);
        event.preventDefault();
        break;
    }
}

function handleLookTouchEnd(event) {
    if (state.lookTouchId === null) return;
    for (const touch of event.changedTouches) {
        if (touch.identifier === state.lookTouchId) {
            state.lookTouchId = null;
            state.lastLookTouch = null;
            event.preventDefault();
            break;
        }
    }
}

function setKey(event, pressed) {
    const code = event.code;
    if (code === 'KeyW' || code === 'ArrowUp') state.keys.forward = pressed;
    if (code === 'KeyS' || code === 'ArrowDown') state.keys.backward = pressed;
    if (code === 'KeyA' || code === 'ArrowLeft') state.keys.left = pressed;
    if (code === 'KeyD' || code === 'ArrowRight') state.keys.right = pressed;
    if (code === 'Space') {
        state.keys.jump = pressed;
        event.preventDefault();
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') state.keys.sprint = pressed;
}

bindEvents();
