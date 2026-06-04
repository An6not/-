const PEER_PREFIX = 'fffaa-';
const SNAPSHOT_RATE_MS = 33;
const INTERPOLATION_DELAY_MS = 120;

const QUALITY_SETTINGS = {
    min: {
        name: 'Минимум',
        shadows: false,
        flashlightShadow: false,
        flashlightShadowMapSize: 128,
        flashlightAngle: Math.PI / 4, // Шире конус
        ceilingLightShadows: false,
        ceilingLightShadowMapSize: 128,
        playerSegments: { sphere: 4, cylinder: 4 },
        fogDensity: 0.025,
        pixelRatio: 1,
        antialias: false,
        simpleMaterials: true,
        roomSegments: 1,
        maxLights: 4
    },
    low: {
        name: 'Низкие',
        shadows: false,
        flashlightShadow: false,
        flashlightShadowMapSize: 256,
        flashlightAngle: Math.PI / 5,
        ceilingLightShadows: false,
        ceilingLightShadowMapSize: 256,
        playerSegments: { sphere: 8, cylinder: 8 },
        fogDensity: 0.018,
        pixelRatio: 1,
        antialias: false,
        simpleMaterials: true,
        roomSegments: 1,
        maxLights: 4
    },
    med: {
        name: 'Средние',
        shadows: true,
        flashlightShadow: true,
        flashlightShadowMapSize: 512,
        flashlightAngle: Math.PI / 6,
        ceilingLightShadows: false,
        ceilingLightShadowMapSize: 256,
        playerSegments: { sphere: 16, cylinder: 12 },
        fogDensity: 0.015,
        pixelRatio: 1,
        antialias: false,
        simpleMaterials: false,
        roomSegments: 2,
        maxLights: 8
    },
    ultra: {
        name: 'Ультра',
        shadows: true,
        flashlightShadow: true,
        flashlightShadowMapSize: 1024,
        flashlightAngle: Math.PI / 7,
        ceilingLightShadows: true,
        ceilingLightShadowMapSize: 512,
        playerSegments: { sphere: 32, cylinder: 24 },
        fogDensity: 0.012,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        antialias: true,
        simpleMaterials: false,
        roomSegments: 4,
        maxLights: 12
    }
};

// Определяем тип устройства
const isMobileDevice = () => {
    return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
};

// По умолчанию: на телефоне - низкие, на ПК - ультра
let currentQuality = isMobileDevice() ? 'low' : 'ultra';

const state = {
    mode: 'solo',
    peer: null,
    conn: null,
    roomCode: null,
    running: false,
    pointerLocked: false,
    flashlightOn: true,
    lastNetSend: 0,
    sequence: 0,
    walkTime: 0,
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
let flashlight;
let flashlightTarget;
let flashlightPosition = new THREE.Vector3();
let flashlightDirection = new THREE.Vector3(0, 0, -1);
let flashlightFlicker = 0;
let worldBounds = { x: 58, z: 58 };

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
    flashlightBtn: document.getElementById('flashlightBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    qualityMin: document.getElementById('qualityMin'),
    qualityLow: document.getElementById('qualityLow'),
    qualityMed: document.getElementById('qualityMed'),
    qualityUltra: document.getElementById('qualityUltra'),
    autoQualityBtn: document.getElementById('autoQualityBtn')
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
    const q = QUALITY_SETTINGS[currentQuality];
    
    scene = new THREE.Scene();
    // Более темный фон, чтобы фонарик выглядел ярче
    scene.background = new THREE.Color(0x7a8b92);
    scene.fog = new THREE.Fog(0x7a8b92, 40, 100);

    camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 200);

    renderer = new THREE.WebGLRenderer({ antialias: q.antialias });
    renderer.setPixelRatio(q.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = q.shadows ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    // Отключаем автообновление теней для оптимизации
    if (q.simpleMaterials) {
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = true;
    }
    el.canvasWrap.replaceChildren(renderer.domElement);

    clock = new THREE.Clock();
    addWorld();
    createFlashlight();
    makePlayers();
    window.addEventListener('resize', resizeRenderer);
}

function addWorld() {
    const q = QUALITY_SETTINGS[currentQuality];
    const hemi = new THREE.HemisphereLight(0xbfd8df, 0x35413c, 0.28);
    scene.add(hemi);

    let wallMaterial, floorMaterial, ceilingMaterial, trimMaterial;
    if (q.simpleMaterials) {
        wallMaterial = new THREE.MeshLambertMaterial({ color: 0x7a8a82 });
        floorMaterial = new THREE.MeshLambertMaterial({ color: 0x5a6860 });
        ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0x6a7870 });
        trimMaterial = new THREE.MeshLambertMaterial({ color: 0x9aaba2 });
    } else {
        wallMaterial = new THREE.MeshStandardMaterial({ color: 0x7a8a82, roughness: 0.88, metalness: 0.02 });
        floorMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6860, roughness: 0.94 });
        ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x6a7870, roughness: 0.84 });
        trimMaterial = new THREE.MeshStandardMaterial({ color: 0x9aaba2, roughness: 0.86 });
    }

    // 1 этаж (нижний)
    const floor1 = new THREE.Mesh(new THREE.BoxGeometry(120, 1, 120), floorMaterial);
    floor1.position.y = -0.5;
    floor1.receiveShadow = q.shadows;
    scene.add(floor1);

    // Перекрытие между этажами - аккуратный проем посередине (20x20)
    // Левая часть
    const floorLeft = new THREE.Mesh(new THREE.BoxGeometry(50, 1, 120), floorMaterial);
    floorLeft.position.set(-35, 5.5, 0);
    floorLeft.receiveShadow = q.shadows;
    scene.add(floorLeft);

    // Правая часть
    const floorRight = new THREE.Mesh(new THREE.BoxGeometry(50, 1, 120), floorMaterial);
    floorRight.position.set(35, 5.5, 0);
    floorRight.receiveShadow = q.shadows;
    scene.add(floorRight);

    // Верхняя часть проема
    const floorTop = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 50), floorMaterial);
    floorTop.position.set(0, 5.5, -35);
    floorTop.receiveShadow = q.shadows;
    scene.add(floorTop);

    // Нижняя часть проема
    const floorBottom = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 50), floorMaterial);
    floorBottom.position.set(0, 5.5, 35);
    floorBottom.receiveShadow = q.shadows;
    scene.add(floorBottom);
    
    // Потолок 2 этажа
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(120, 1, 120), ceilingMaterial);
    ceiling.position.y = 11.5;
    ceiling.receiveShadow = q.shadows;
    scene.add(ceiling);

    // Наружные стены
    addRoomWall(0, 6, -60, 120, 12, 1, wallMaterial);
    addRoomWall(0, 6, 60, 120, 12, 1, wallMaterial);
    addRoomWall(-60, 6, 0, 1, 12, 120, wallMaterial);
    addRoomWall(60, 6, 0, 1, 12, 120, wallMaterial);

    // Внутренние стены - аккуратная, симметричная структура
    // Центральная стена по оси Z (вертикально)
    addRoomWall(0, 3, 0, 8, 6, 0.6, wallMaterial); // 1 этаж, центр
    addRoomWall(0, 9, 0, 8, 6, 0.6, wallMaterial); // 2 этаж, центр
    
    // Угловые комнаты
    // Верхний левый угол
    addRoomWall(-30, 3, -30, 40, 6, 0.4, wallMaterial);
    addRoomWall(-30, 9, -30, 40, 6, 0.4, wallMaterial);
    // Верхний правый угол
    addRoomWall(30, 3, -30, 40, 6, 0.4, wallMaterial);
    addRoomWall(30, 9, -30, 40, 6, 0.4, wallMaterial);
    // Нижний левый угол
    addRoomWall(-30, 3, 30, 40, 6, 0.4, wallMaterial);
    addRoomWall(-30, 9, 30, 40, 6, 0.4, wallMaterial);
    // Нижний правый угол
    addRoomWall(30, 3, 30, 40, 6, 0.4, wallMaterial);
    addRoomWall(30, 9, 30, 40, 6, 0.4, wallMaterial);
    
    // Дверные проемы (отсутствие стен в нужных местах)
    addRoomWall(-35, 3, 0, 30, 6, 0.4, wallMaterial); // Левая часть стены
    addRoomWall(5, 3, 0, 30, 6, 0.4, wallMaterial); // Правая часть стены
    addRoomWall(-35, 9, 0, 30, 6, 0.4, wallMaterial); // 2 этаж
    addRoomWall(5, 9, 0, 30, 6, 0.4, wallMaterial);

    // Платформы для подъема - аккуратные, с обеих сторон проема
    const platformMat = q.simpleMaterials ? new THREE.MeshLambertMaterial({ color: 0x9aaba2 }) : new THREE.MeshStandardMaterial({ color: 0x9aaba2, roughness: 0.88 });
    
    // Левая лестница/платформы
    for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(12, 0.6, 10), platformMat);
        p.position.set(-18, 1.5 + i * 2, 0);
        p.castShadow = p.receiveShadow = q.shadows;
        scene.add(p);
    }

    // Правая лестница/платформы
    for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(12, 0.6, 10), platformMat);
        p.position.set(18, 1.5 + i * 2, 0);
        p.castShadow = p.receiveShadow = q.shadows;
        scene.add(p);
    }

    // Оптимизируем сетку - только на Ультра
    if (!q.simpleMaterials) {
        const grid = new THREE.GridHelper(118, 59, 0xffffff, 0xffffff);
        grid.position.y = 0.015;
        grid.material.opacity = 0.07;
        grid.material.transparent = true;
        scene.add(grid);
    }

    // Лампы - оптимизируем расположение
    addCeilingLight(-25, 4.7, -25); // 1 этаж
    addCeilingLight(25, 4.7, -25);
    addCeilingLight(-25, 4.7, 25);
    addCeilingLight(25, 4.7, 25);
    addCeilingLight(0, 4.7, 0);
    addCeilingLight(-25, 10.7, -25); // 2 этаж
    addCeilingLight(25, 10.7, -25);
    addCeilingLight(-25, 10.7, 25);
    addCeilingLight(25, 10.7, 25);
    addCeilingLight(0, 10.7, 0);
}

function addRoomWall(x, y, z, w, h, d, material) {
    const q = QUALITY_SETTINGS[currentQuality];
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    wall.position.set(x, y, z);
    wall.castShadow = q.shadows;
    wall.receiveShadow = q.shadows;
    scene.add(wall);
}

function addCeilingLight(x, y, z) {
    const q = QUALITY_SETTINGS[currentQuality];
    const light = new THREE.PointLight(0xfff2c7, q.simpleMaterials ? 1.0 : 0.85, q.simpleMaterials ? 50 : 42, 2);
    light.position.set(x, y, z);
    light.castShadow = q.ceilingLightShadows;
    if (q.ceilingLightShadows) {
        light.shadow.mapSize.set(q.ceilingLightShadowMapSize, q.ceilingLightShadowMapSize);
        light.shadow.bias = -0.0001; // Уменьшаем артефакты теней
    }
    scene.add(light);

    // Лампочки - визуально только на Ультра, чтобы не тратить ресурсы на Низких
    if (!q.simpleMaterials) {
        const bulbSegments = 12;
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, bulbSegments, bulbSegments),
            new THREE.MeshBasicMaterial({ color: 0xfff2c7 })
        );
        bulb.position.copy(light.position);
        scene.add(bulb);
    }
}

function createFlashlight() {
    const q = QUALITY_SETTINGS[currentQuality];
    flashlightTarget = new THREE.Object3D();
    scene.add(flashlightTarget);

    const intensity = q.simpleMaterials ? 4.5 : 3.8; // Ярче на низких настройках
    flashlight = new THREE.SpotLight(0xfff1bd, intensity, 40, q.flashlightAngle, q.simpleMaterials ? 0.5 : 0.4, 1.3);
    flashlight.castShadow = q.flashlightShadow;
    if (q.flashlightShadow) {
        flashlight.shadow.mapSize.set(q.flashlightShadowMapSize, q.flashlightShadowMapSize);
    }
    flashlight.target = flashlightTarget;
    scene.add(flashlight);
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
    const q = QUALITY_SETTINGS[currentQuality];
    const group = new THREE.Group();
    
    let material, darkMaterial, trimMaterial;
    if (q.simpleMaterials) {
        material = new THREE.MeshLambertMaterial({ color });
        darkMaterial = new THREE.MeshLambertMaterial({ color: 0x111820 });
        trimMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    } else {
        material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.02 });
        darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.55 });
        trimMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
    }

    const segs = q.playerSegments;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.25, segs.cylinder), material);
    body.position.y = 0.78;
    body.castShadow = q.shadows;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, segs.sphere, segs.sphere), material);
    head.position.y = 1.58;
    head.castShadow = q.shadows;
    group.add(head);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.22, Math.max(8, segs.cylinder / 2)), material);
    neck.position.y = 1.28;
    neck.castShadow = q.shadows;
    group.add(neck);

    const face = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.12, 0.05),
        darkMaterial
    );
    face.position.set(0, 1.62, -0.39);
    group.add(face);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.05), trimMaterial);
    chest.position.set(0, 0.98, -0.42);
    group.add(chest);

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.2), material);
    leftArm.position.set(-0.54, 0.84, -0.02);
    leftArm.rotation.z = 0.14;
    leftArm.castShadow = q.shadows;
    group.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.54;
    rightArm.rotation.z = -0.14;
    group.add(rightArm);

    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.24), material);
    leftLeg.position.set(-0.18, 0.28, 0);
    leftLeg.castShadow = q.shadows;
    group.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.18;
    group.add(rightLeg);

    group.position.set(x, 0, z);
    scene.add(group);

    return {
        mesh: group,
        parts: { leftArm, rightArm, leftLeg, rightLeg },
        velocity: new THREE.Vector3(),
        radius: 0.42,
        eyeHeight: 1.62,
        speed: 5.4,
        sprintSpeed: 7.3,
        jump: 6.8,
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
    flashlight = null;
    flashlightTarget = null;
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

    const worldX = move.x * cos + move.z * sin;
    const worldZ = -move.x * sin + move.z * cos;
    const horizontalSpeed = Math.hypot(worldX, worldZ) * speed;

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
    animatePlayer(localPlayer, horizontalSpeed, dt);
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
    const v = player.velocity;
    p.x = THREE.MathUtils.clamp(p.x, -worldBounds.x, worldBounds.x);
    p.z = THREE.MathUtils.clamp(p.z, -worldBounds.z, worldBounds.z);

    // Определяем, находится ли игрок в области проема между этажами
    const inHoleX = Math.abs(p.x) < 10; // +/- 10 от центра
    const inHoleZ = Math.abs(p.z) < 7; // +/- 7 от центра
    const inHole = inHoleX && inHoleZ;

    let onGround = false;

    // Проверка пола 1 этажа
    if (p.y <= 0) {
        p.y = 0;
        v.y = 0;
        onGround = true;
    } 
    // Проверка пола 2 этажа (только если не в проеме)
    else if (p.y <= 6 && p.y > 0 && !inHole) {
        if (v.y <= 0) {
            p.y = 6;
            v.y = 0;
            onGround = true;
        }
    } 
    // Проверка платформ
    else {
        const platforms = [
            // Левая лестница
            { x: -18, y: 1.5, z: 0, w: 12, h: 0.6, d: 10 },
            { x: -18, y: 3.5, z: 0, w: 12, h: 0.6, d: 10 },
            { x: -18, y: 5.5, z: 0, w: 12, h: 0.6, d: 10 },
            // Правая лестница
            { x: 18, y: 1.5, z: 0, w: 12, h: 0.6, d: 10 },
            { x: 18, y: 3.5, z: 0, w: 12, h: 0.6, d: 10 },
            { x: 18, y: 5.5, z: 0, w: 12, h: 0.6, d: 10 }
        ];
        
        for (let plat of platforms) {
            const platTop = plat.y + plat.h / 2;
            if (Math.abs(p.x - plat.x) < plat.w / 2 &&
                Math.abs(p.z - plat.z) < plat.d / 2 &&
                p.y <= platTop + 0.15 && p.y > plat.y && v.y <= 0) {
                p.y = platTop;
                v.y = 0;
                onGround = true;
                break;
            }
        }
    }
    
    // Проверка потолка
    if (p.y >= 11) {
        p.y = 11;
        v.y = 0;
        onGround = true;
    }

    player.onGround = onGround;

    // Ограничение максимальной высоты прыжка
    if (p.y > 12) {
        p.y = 12;
        v.y = -2;
    }
}

function updateCamera() {
    const p = localPlayer.mesh.position;
    const moving = Math.hypot(localPlayer.velocity.x, localPlayer.velocity.z);
    if (localPlayer.onGround && moving > 0.2) {
        state.walkTime += moving * 0.011;
    } else {
        state.walkTime *= 0.9;
    }

    const bobPower = localPlayer.onGround ? THREE.MathUtils.clamp(moving / localPlayer.sprintSpeed, 0, 1) : 0;
    const bobY = Math.sin(state.walkTime * 7) * 0.018 * bobPower;
    const bobX = Math.sin(state.walkTime * 3.5) * 0.01 * bobPower;

    camera.position.set(p.x + bobX, p.y + localPlayer.eyeHeight + bobY, p.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = state.yaw;
    camera.rotation.x = state.pitch + Math.sin(state.walkTime * 7 + 0.8) * 0.0025 * bobPower;
}

function updateFlashlight(dt) {
    if (!flashlight || !flashlightTarget || !camera) return;

    const desiredDirection = new THREE.Vector3();
    camera.getWorldDirection(desiredDirection);

    const moving = Math.hypot(localPlayer.velocity.x, localPlayer.velocity.z);
    const bobPower = localPlayer.onGround ? THREE.MathUtils.clamp(moving / localPlayer.sprintSpeed, 0, 1) : 0;
    const bobY = Math.sin(state.walkTime * 7) * 0.022 * bobPower;
    const bobX = Math.sin(state.walkTime * 3.5) * 0.012 * bobPower;

    const desiredPosition = camera.position.clone()
        .add(new THREE.Vector3(0, -0.18, 0))
        .addScaledVector(desiredDirection, 0.18)
        .add(new THREE.Vector3(bobX, bobY, 0));

    const posAlpha = 1 - Math.pow(0.0003, dt); // Более быстрая интерполяция позиции
    const dirAlpha = 1 - Math.pow(0.0015, dt); // Более быстрая интерполяция направления
    flashlightPosition.lerp(desiredPosition, posAlpha);
    flashlightDirection.lerp(desiredDirection, dirAlpha).normalize();

    // Мерцание фонарика
    flashlightFlicker += dt * 12;
    const flickerAmount = (Math.sin(flashlightFlicker) * 0.5 + Math.sin(flashlightFlicker * 1.7) * 0.3 + Math.sin(flashlightFlicker * 0.9) * 0.2) * 0.08;
    
    flashlight.position.copy(flashlightPosition);
    flashlightTarget.position.copy(flashlightPosition).addScaledVector(flashlightDirection, 20);
    const baseIntensity = 3.8;
    flashlight.intensity = state.flashlightOn ? (baseIntensity + baseIntensity * flickerAmount) : 0;
    
    // Небольшое покачивание конуса фонарика
    flashlight.penumbra = 0.4 + Math.sin(flashlightFlicker * 2.1) * 0.02;
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
        remotePlayer.velocity.copy(a.velocity).lerp(b.velocity, t);
    } else {
        const latest = buffer[buffer.length - 1];
        const dt = Math.min((renderTime - latest.time) / 1000, 0.12);
        targetPosition = latest.position.clone().addScaledVector(latest.velocity, Math.max(0, dt));
        targetYaw = latest.yaw;
        remotePlayer.velocity.copy(latest.velocity);
    }

    remotePlayer.mesh.position.lerp(targetPosition, 0.42);
    remotePlayer.mesh.rotation.y = lerpAngle(remotePlayer.mesh.rotation.y, targetYaw, 0.35);
    animatePlayer(remotePlayer, remotePlayer.velocity.length(), 1 / 60);
}

function animatePlayer(player, speed, dt) {
    if (!player.parts) return;
    const moving = speed > 0.15;
    player.walkTime = (player.walkTime || 0) + (moving ? speed * dt * 4.5 : dt * 2);
    const swing = moving ? Math.sin(player.walkTime) * 0.42 : 0;
    player.parts.leftArm.rotation.x = swing;
    player.parts.rightArm.rotation.x = -swing;
    player.parts.leftLeg.rotation.x = -swing * 0.72;
    player.parts.rightLeg.rotation.x = swing * 0.72;
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
    updateFlashlight(dt);
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

function toggleFlashlight() {
    state.flashlightOn = !state.flashlightOn;
    el.flashlightBtn?.classList.toggle('active', state.flashlightOn);
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
    state.yaw -= deltaX * 0.0024 * multiplier;
    state.pitch -= deltaY * 0.0022 * multiplier;
    state.pitch = THREE.MathUtils.clamp(state.pitch, -1.35, 1.35);
}

function bindEvents() {
    // Безопасно добавляем события, только если элементы существуют
    if (el.qualityMin) el.qualityMin.addEventListener('click', () => setQuality('min'));
    if (el.qualityLow) el.qualityLow.addEventListener('click', () => setQuality('low'));
    if (el.qualityMed) el.qualityMed.addEventListener('click', () => setQuality('med'));
    if (el.qualityUltra) el.qualityUltra.addEventListener('click', () => setQuality('ultra'));
    if (el.autoQualityBtn) el.autoQualityBtn.addEventListener('click', autoSetQuality);
    
    if (el.soloBtn) el.soloBtn.addEventListener('click', () => startGame('solo'));
    if (el.createRoomBtn) el.createRoomBtn.addEventListener('click', hostRoom);
    if (el.joinRoomBtn) el.joinRoomBtn.addEventListener('click', showJoinPanel);
    if (el.joinBtn) el.joinBtn.addEventListener('click', joinRoom);
    if (el.leaveBtn) el.leaveBtn.addEventListener('click', endGame);
    if (el.fullscreenBtn) el.fullscreenBtn.addEventListener('click', toggleFullscreen);
    if (el.flashlightBtn) el.flashlightBtn.addEventListener('click', toggleFlashlight);

    if (el.roomCodeInput) {
        el.roomCodeInput.addEventListener('input', () => {
            el.roomCodeInput.value = el.roomCodeInput.value.replace(/\D/g, '').slice(0, 5);
        });
    }
}

function setQuality(quality) {
    currentQuality = quality;
    if (el.qualityMin) el.qualityMin.classList.toggle('active', quality === 'min');
    if (el.qualityLow) el.qualityLow.classList.toggle('active', quality === 'low');
    if (el.qualityMed) el.qualityMed.classList.toggle('active', quality === 'med');
    if (el.qualityUltra) el.qualityUltra.classList.toggle('active', quality === 'ultra');
}

function autoSetQuality() {
    // Улучшенная оценка производительности
    if (isMobileDevice()) {
        setQuality('low');
    } else {
        // Определяем по количеству ядер и устройству
        const cores = navigator.hardwareConcurrency || 4;
        if (cores >= 8) {
            setQuality('ultra');
        } else if (cores >= 5) {
            setQuality('med');
        } else {
            setQuality('low');
        }
    }
    
    if (el.autoQualityBtn) {
        el.autoQualityBtn.textContent = 'Авто-настройка применена!';
        setTimeout(() => {
            el.autoQualityBtn.textContent = 'Авто-настройка (60 FPS)';
        }, 2000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    // Инициализируем активную кнопку качества при загрузке
    setQuality(currentQuality);

    document.addEventListener('keydown', (event) => setKey(event, true));
    document.addEventListener('keyup', (event) => setKey(event, false));

    document.addEventListener('pointerlockchange', () => {
        state.pointerLocked = document.pointerLockElement === renderer?.domElement;
    });
    document.addEventListener('mousemove', (event) => {
        if (state.pointerLocked) lookBy(event.movementX, event.movementY);
    });

    if (el.gameContainer) {
        el.gameContainer.addEventListener('pointerdown', (event) => {
            if (!state.running) return;
            if (event.target.closest('#hud') || event.target.closest('#mobileControls') || event.target.closest('#joystickZone')) return;
            requestPointerLock();
        });

        el.gameContainer.addEventListener('touchstart', handleLookTouchStart, { passive: false });
        el.gameContainer.addEventListener('touchmove', handleLookTouchMove, { passive: false });
        el.gameContainer.addEventListener('touchend', handleLookTouchEnd, { passive: false });
        el.gameContainer.addEventListener('touchcancel', handleLookTouchEnd, { passive: false });
    }

    if (el.jumpBtn) {
        bindHoldButton(el.jumpBtn, (pressed) => {
            state.keys.jump = pressed;
        });
    }
});

function bindHoldButton(button, onChange) {
    if (!button) return;
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
    if (code === 'KeyF' && pressed && !event.repeat) toggleFlashlight();
    if (code === 'ShiftLeft' || code === 'ShiftRight') state.keys.sprint = pressed;
}

bindEvents();
