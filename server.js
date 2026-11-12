const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'web', req.url === '/' ? 'index.html' : req.url);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("404 Файл не найден");
        } else {
            let contentType = 'text/html';
            if (req.url.endsWith('.json')) contentType = 'application/json';
            else if (req.url.endsWith('.js')) contentType = 'application/javascript';
            else if (req.url.endsWith('.css')) contentType = 'text/css';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

const wss = new WebSocketServer({ server });
const connectedPeers = new Map();

const USERS_DB_PATH = path.join(__dirname, 'users_db.json');
const ROOMS_DB_PATH = path.join(__dirname, 'rooms_db.json');

function loadAllUsers() {
    try {
        if (fs.existsSync(USERS_DB_PATH)) {
            const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
            const arr = JSON.parse(data);
            return new Map(arr);
        }
    } catch (e) {}
    return new Map();
}

function saveAllUsers() {
    try {
        const arr = Array.from(allKnownUsers.entries());
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) {}
}

const allKnownUsers = loadAllUsers();

function loadRooms() {
    const defaultRooms = new Map();
    
    // Общий чат
    defaultRooms.set('general', {
        id: 'general',
        name: 'Общий чат',
        description: 'Главный общий канал для всех пользователей',
        avatar: '',
        channelType: 'text',
        allowedTags: [], 
        tagPermissions: {}, // { 'Посетитель': { canWrite: false, cd: 0, bans: {} }, 'Участник': { canWrite: true, cd: 0, bans: {} } }
        adminUuid: null,
        members: []
    });

    // Спец-группа для посетителей
    defaultRooms.set('visitors_lobby', {
        id: 'visitors_lobby',
        name: 'Лобби посетителей',
        description: 'Специальный канал для общения посетителей',
        avatar: '',
        channelType: 'text',
        allowedTags: ['Админ', 'HostAdmin (№1)', 'Участник', 'Посетитель'],
        tagPermissions: {},
        adminUuid: null,
        members: []
    });

    try {
        if (fs.existsSync(ROOMS_DB_PATH)) {
            const data = fs.readFileSync(ROOMS_DB_PATH, 'utf8');
            const arr = JSON.parse(data);
            const map = new Map();
            arr.forEach(([id, r]) => {
                map.set(id, {
                    id: r.id,
                    name: r.name,
                    description: r.description || '',
                    avatar: r.avatar || '',
                    channelType: r.channelType || 'text',
                    allowedTags: r.allowedTags || [],
                    tagPermissions: r.tagPermissions || {},
                    adminUuid: r.adminUuid,
                    members: r.members || []
                });
            });
            if (!map.has('general')) {
                map.set('general', defaultRooms.get('general'));
            }
            if (!map.has('visitors_lobby')) {
                map.set('visitors_lobby', defaultRooms.get('visitors_lobby'));
            }
            return map;
        }
    } catch (e) {}
    return defaultRooms;
}

function saveRooms() {
    try {
        const serializableMap = Array.from(rooms.entries()).map(([id, r]) => [
            id,
            {
                id: r.id,
                name: r.name,
                description: r.description,
                avatar: r.avatar,
                channelType: r.channelType,
                allowedTags: r.allowedTags,
                tagPermissions: r.tagPermissions,
                adminUuid: r.adminUuid,
                members: r.members
            }
        ]);
        fs.writeFileSync(ROOMS_DB_PATH, JSON.stringify(serializableMap, null, 2), 'utf8');
    } catch (e) {}
}

const rooms = loadRooms();

function getLogFilePath(targetId) {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const dir = path.join(__dirname, 'chat_logs', year, month);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${targetId}.json`);
}

function getDirectLogKey(uuidA, uuidB) {
    const sorted = [uuidA, uuidB].sort();
    return `direct_${sorted[0]}_${sorted[1]}`;
}

function appendLogToFile(targetId, logEntry) {
    try {
        const filePath = getLogFilePath(targetId);
        let logs = [];
        if (fs.existsSync(filePath)) {
            try { logs = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { logs = []; }
        }
        logs.push(logEntry);
        fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf8');
    } catch (e) {}
}

function getLogsFromFile(targetId) {
    try {
        const filePath = getLogFilePath(targetId);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function updateMessageReadStatusInFile(targetId, readerUuid, readerName) {
    try {
        const filePath = getLogFilePath(targetId);
        if (fs.existsSync(filePath)) {
            let logs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            let updated = false;
            logs.forEach(item => {
                if (!item.readBy) item.readBy = {};
                if (item.senderUuid !== readerUuid && !item.readBy[readerUuid]) {
                    item.readBy[readerUuid] = readerName;
                    updated = true;
                }
            });
            if (updated) {
                fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf8');
            }
            return logs;
        }
    } catch (e) {}
    return null;
}

function deleteLogFromFile(targetId, timestamp, content) {
    try {
        const filePath = getLogFilePath(targetId);
        if (fs.existsSync(filePath)) {
            let logs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            logs = logs.filter(item => {
                if (timestamp && item.time) {
                    return item.time !== timestamp;
                }
                return item.content !== content;
            });
            fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf8');
        }
    } catch (e) {}
}

wss.on('connection', (ws, req) => {
    let currentUuid = null;
    let peerData = null;

    const remoteIp = req.socket.remoteAddress;
    const isLocalHost = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'REGISTER') {
                currentUuid = data.uuid && data.uuid.length === 8 ? data.uuid : Math.random().toString(36).substring(2, 10);
                
                if (connectedPeers.has(currentUuid)) {
                    const oldPeer = connectedPeers.get(currentUuid);
                    try { oldPeer.ws.close(); } catch(e) {}
                }

                let userInfo = allKnownUsers.get(currentUuid);
                const isFirstUserInSystem = allKnownUsers.size === 0;

                if (!userInfo) {
                    const shouldBeAdmin = isFirstUserInSystem || isLocalHost;
                    userInfo = { 
                        uuid: currentUuid, 
                        name: shouldBeAdmin ? 'HostAdmin (№1)' : `User_${currentUuid.substring(0, 4)}`, 
                        tag: shouldBeAdmin ? 'Админ' : 'Посетитель', // Базово все новые - Посетители
                        isAdmin: shouldBeAdmin, 
                        bans: { text: false, images: false, links: false, mic: false, listen: false } 
                    };
                    allKnownUsers.set(currentUuid, userInfo);
                    saveAllUsers();
                } else if (isLocalHost && !userInfo.isAdmin) {
                    userInfo.isAdmin = true;
                    saveAllUsers();
                }

                peerData = { 
                    ws, 
                    name: userInfo.name, 
                    tag: userInfo.tag || 'Посетитель',
                    isAdmin: userInfo.isAdmin, 
                    rooms: new Set(['general', 'visitors_lobby']), 
                    bans: userInfo.bans || { text: false, images: false, links: false, mic: false, listen: false },
                    micActive: false,
                    listenActive: true,
                    currentVoiceChannel: null
                };
                
                connectedPeers.set(currentUuid, peerData);
                
                rooms.forEach((room, rId) => {
                    if (!room.members.includes(currentUuid)) {
                        room.members.push(currentUuid);
                    }
                    peerData.rooms.add(rId);
                });
                saveRooms();

                ws.send(JSON.stringify({
                    type: 'INIT',
                    uuid: currentUuid,
                    isAdmin: peerData.isAdmin,
                    rooms: getAvailableRoomsForUser(currentUuid)
                }));

                broadcastUserList();
                broadcastRoomList();
                return;
            }

            if (!currentUuid || !peerData) return;

            if (data.type === 'UPDATE_STATUS') {
                if (typeof data.micActive === 'boolean') peerData.micActive = data.micActive;
                if (typeof data.listenActive === 'boolean') peerData.listenActive = data.listenActive;
                broadcastUserList();
            }

            if (data.type === 'JOIN_VOICE_CHANNEL') {
                peerData.currentVoiceChannel = data.roomId;
                broadcastUserList();
                return;
            }

            if (data.type === 'LEAVE_VOICE_CHANNEL') {
                peerData.currentVoiceChannel = null;
                broadcastUserList();
                return;
            }

            // Управление звонками (Вызов -> Установка связи)
            if (data.type === 'CALL_REQUEST') {
                const target = connectedPeers.get(data.targetUuid);
                if (target && target.ws.readyState === ws.OPEN) {
                    target.ws.send(JSON.stringify({ type: 'INCOMING_CALL', senderUuid: currentUuid, senderName: peerData.name }));
                }
                return;
            }

            if (data.type === 'CALL_ACCEPT') {
                const target = connectedPeers.get(data.targetUuid);
                if (target && target.ws.readyState === ws.OPEN) {
                    target.ws.send(JSON.stringify({ type: 'CALL_ACCEPTED', senderUuid: currentUuid }));
                }
                peerData.currentVoiceChannel = `direct_${currentUuid}`;
                if (target) target.currentVoiceChannel = `direct_${currentUuid}`;
                broadcastUserList();
                return;
            }

            if (data.type === 'CALL_REJECT' || data.type === 'CALL_END') {
                const target = connectedPeers.get(data.targetUuid);
                if (target && target.ws.readyState === ws.OPEN) {
                    target.ws.send(JSON.stringify({ type: 'CALL_ENDED', senderUuid: currentUuid }));
                }
                peerData.currentVoiceChannel = null;
                if (target) target.currentVoiceChannel = null;
                broadcastUserList();
                return;
            }

            if (data.type === 'SET_USER_TAG') {
                if (!peerData.isAdmin) {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Назначать теги могут только администраторы.' }));
                }
                const targetKnown = allKnownUsers.get(data.targetUuid);
                const targetPeer = connectedPeers.get(data.targetUuid);
                const newTag = (data.tag || '').trim().substring(0, 20);

                // Запрещаем менять тег главному HostAdmin (№1) не-владельцам или случайно
                if (targetKnown && targetKnown.name === 'HostAdmin (№1)' && currentUuid !== data.targetUuid) {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Нельзя изменять тег основного оператора.' }));
                }

                if (targetKnown) {
                    targetKnown.tag = newTag;
                    saveAllUsers();
                }
                if (targetPeer) {
                    targetPeer.tag = newTag;
                }
                broadcastUserList();
                return;
            }

            if (data.type === 'TYPING') {
                const target = connectedPeers.get(data.targetUuid);
                if (target && target.ws.readyState === ws.OPEN) {
                    target.ws.send(JSON.stringify({ type: 'TYPING', senderUuid: currentUuid }));
                }
                return;
            }

            if (data.type === 'MARK_READ') {
                let logKey = '';
                if (data.targetId.startsWith('room_') || data.targetId === 'general' || data.targetId === 'visitors_lobby') {
                    logKey = `room_${data.targetId}`;
                } else {
                    logKey = getDirectLogKey(currentUuid, data.targetId);
                }

                updateMessageReadStatusInFile(logKey, currentUuid, peerData.name);

                if (data.targetId.startsWith('room_') || data.targetId === 'general' || data.targetId === 'visitors_lobby') {
                    const roomId = data.targetId.replace('room_', '');
                    broadcastToRoom(roomId, { type: 'MSG_READ_NOTIFY', targetId: data.targetId, readerUuid: currentUuid, readerName: peerData.name });
                } else {
                    const target = connectedPeers.get(data.targetId);
                    if (target && target.ws.readyState === ws.OPEN) {
                        target.ws.send(JSON.stringify({ type: 'MSG_READ_NOTIFY', targetId: currentUuid, readerUuid: currentUuid, readerName: peerData.name }));
                    }
                }
                return;
            }

            if (data.type === 'GET_HISTORY') {
                let logKey = '';
                if (data.targetId.startsWith('room_') || data.targetId === 'general' || data.targetId === 'visitors_lobby') {
                    logKey = `room_${data.targetId}`;
                } else {
                    logKey = getDirectLogKey(currentUuid, data.targetId);
                }

                const history = getLogsFromFile(logKey);
                ws.send(JSON.stringify({
                    type: 'HISTORY_RESPONSE',
                    targetId: data.targetId,
                    history: history
                }));
                return;
            }

            if (data.type === 'ADMIN_AUTH' && data.password === '9898') {
                peerData.isAdmin = true;
                const u = allKnownUsers.get(currentUuid);
                if (u) { u.isAdmin = true; saveAllUsers(); }
                ws.send(JSON.stringify({ type: 'ADMIN_AUTH_SUCCESS' }));
                broadcastUserList();
            }

            if (data.type === 'MAKE_ADMIN' && peerData.isAdmin) {
                const target = connectedPeers.get(data.targetUuid);
                const targetKnown = allKnownUsers.get(data.targetUuid);
                if (targetKnown) { targetKnown.isAdmin = true; saveAllUsers(); }
                if (target) {
                    target.isAdmin = true;
                    target.ws.send(JSON.stringify({ type: 'ADMIN_AUTH_SUCCESS' }));
                }
                broadcastUserList();
                return;
            }

            // Новый функционал: снятие с должности админа (кроме главного HostAdmin №1)
            if (data.type === 'REMOVE_ADMIN' && peerData.isAdmin) {
                const targetKnown = allKnownUsers.get(data.targetUuid);
                if (targetKnown && targetKnown.name === 'HostAdmin (№1)') {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Нельзя снять с должности основного оператора (HostAdmin №1).' }));
                }
                if (targetKnown) {
                    targetKnown.isAdmin = false;
                    saveAllUsers();
                }
                const target = connectedPeers.get(data.targetUuid);
                if (target) {
                    target.isAdmin = false;
                    target.ws.send(JSON.stringify({ type: 'ADMIN_REVOKED', message: 'Ваши права администратора были сняты.' }));
                }
                broadcastUserList();
                return;
            }

            if (data.type === 'CREATE_ROOM') {
                if (data.adminPassword === '9898' || peerData.isAdmin) {
                    peerData.isAdmin = true;
                    const u = allKnownUsers.get(currentUuid);
                    if (u) { u.isAdmin = true; saveAllUsers(); }

                    const roomId = 'room_' + Math.random().toString(36).substring(2, 8);
                    const allUuids = Array.from(allKnownUsers.keys());
                    if (!allUuids.includes(currentUuid)) allUuids.push(currentUuid);

                    const newRoom = {
                        id: roomId,
                        name: data.name || 'Комната',
                        description: data.description || '',
                        avatar: data.avatar || '',
                        channelType: data.channelType || 'text',
                        allowedTags: data.allowedTags || [],
                        tagPermissions: data.tagPermissions || {},
                        adminUuid: currentUuid,
                        members: allUuids
                    };

                    rooms.set(roomId, newRoom);
                    saveRooms();

                    allUuids.forEach(uuid => {
                        const peer = connectedPeers.get(uuid);
                        if (peer) {
                            peer.rooms.add(roomId);
                            sendRoomListToUser(uuid);
                        }
                    });

                    broadcastRoomList();
                    broadcastUserList();
                    ws.send(JSON.stringify({ type: 'ROOM_CREATED_SUCCESS', roomId }));
                }
            }

            if (data.type === 'UPDATE_ROOM_SETTINGS') {
                const room = rooms.get(data.roomId);
                if (room && (room.adminUuid === currentUuid || peerData.isAdmin)) {
                    if (typeof data.name === 'string') room.name = data.name;
                    if (typeof data.description === 'string') room.description = data.description;
                    if (typeof data.avatar === 'string') room.avatar = data.avatar;
                    if (Array.isArray(data.allowedTags)) room.allowedTags = data.allowedTags;
                    if (data.tagPermissions) room.tagPermissions = data.tagPermissions;
                    saveRooms();
                    broadcastRoomList();
                }
            }

            if (data.type === 'ADD_TO_ROOM') {
                const room = rooms.get(data.roomId);
                if (room && (room.adminUuid === currentUuid || peerData.isAdmin)) {
                    if (!room.members.includes(data.targetUuid)) room.members.push(data.targetUuid);
                    saveRooms();
                    const target = connectedPeers.get(data.targetUuid);
                    if (target) {
                        target.rooms.add(data.roomId);
                        sendRoomListToUser(data.targetUuid);
                    }
                    broadcastRoomList();
                }
            }

            if (data.type === 'KICK_FROM_ROOM' && peerData.isAdmin) {
                const room = rooms.get(data.roomId);
                if (room && room.id !== 'general' && room.id !== 'visitors_lobby') {
                    rooms.delete(data.roomId);
                    saveRooms();
                    room.members.forEach(uuid => {
                        const target = connectedPeers.get(uuid);
                        if (target) {
                            target.rooms.delete(data.roomId);
                            sendRoomListToUser(uuid);
                            target.ws.send(JSON.stringify({ type: 'KICKED_FROM_ROOM', roomId: data.roomId }));
                        }
                    });
                    broadcastRoomList();
                }
            }

            if (data.type === 'KICK_USER_FROM_ROOM') {
                const room = rooms.get(data.roomId);
                if (room && (peerData.isAdmin || room.adminUuid === currentUuid)) {
                    room.members = room.members.filter(id => id !== data.targetUuid);
                    saveRooms();
                    const target = connectedPeers.get(data.targetUuid);
                    if (target) {
                        target.rooms.delete(data.roomId);
                        sendRoomListToUser(data.targetUuid);
                        target.ws.send(JSON.stringify({ type: 'KICKED_FROM_ROOM', roomId: data.roomId }));
                    }
                    broadcastRoomList();
                }
            }

            if (data.type === 'TOGGLE_BAN' && peerData.isAdmin) {
                const targetKnown = allKnownUsers.get(data.targetUuid);
                if (targetKnown && targetKnown.name === 'HostAdmin (№1)') {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Нельзя применять ограничения к основному оператору.' }));
                }
                if (targetKnown) {
                    if (!targetKnown.bans) targetKnown.bans = { text: false, images: false, links: false, mic: false, listen: false };
                    const banKey = data.banType; 
                    if (banKey in targetKnown.bans) {
                        targetKnown.bans[banKey] = !targetKnown.bans[banKey];
                        saveAllUsers();
                    }
                }
                const target = connectedPeers.get(data.targetUuid);
                if (target) {
                    target.bans = targetKnown.bans;
                    target.ws.send(JSON.stringify({ type: 'SERVER_BANS_UPDATED', bans: target.bans }));
                }
                broadcastUserList();
                return;
            }

            // Удаление участника с программы
            if (data.type === 'KICK_USER_FROM_PROGRAM' && peerData.isAdmin) {
                const targetUuid = data.targetUuid;
                const targetKnown = allKnownUsers.get(targetUuid);
                
                if (targetKnown && targetKnown.name === 'HostAdmin (№1)') {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Нельзя удалить из программы основного оператора.' }));
                }

                // Закрываем соединение если он онлайн
                const targetPeer = connectedPeers.get(targetUuid);
                if (targetPeer && targetPeer.ws.readyState === ws.OPEN) {
                    targetPeer.ws.send(JSON.stringify({ type: 'KICKED_FROM_PROGRAM', message: 'Вы были удалены из программы администратором.' }));
                    try { targetPeer.ws.close(); } catch(e) {}
                }

                // Удаляем из базы известных пользователей
                allKnownUsers.delete(targetUuid);
                saveAllUsers();

                // Удаляем из активных подключений
                connectedPeers.delete(targetUuid);

                // Удаляем из всех комнат
                rooms.forEach((room) => {
                    room.members = room.members.filter(id => id !== targetUuid);
                });
                saveRooms();

                broadcastUserList();
                broadcastRoomList();
                return;
            }

            if (data.type === 'DIRECT_CHAT') {
                // Если пользователь посетитель, он может писать только админу
                const targetKnown = allKnownUsers.get(data.targetUuid);
                if (peerData.tag === 'Посетитель' && targetKnown && !targetKnown.isAdmin) {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Посетители могут писать только администратору.' }));
                }

                if (peerData.bans.text || (data.isImage && peerData.bans.images)) {
                    return ws.send(JSON.stringify({ type: 'ERROR', message: 'Действие заблокировано администратором.' }));
                }
                const logEntry = { 
                    time: data.time || new Date().toISOString(), 
                    senderUuid: currentUuid, 
                    senderName: peerData.name, 
                    content: data.content, 
                    isImage: data.isImage,
                    readBy: {}
                };
                
                const logKey = getDirectLogKey(currentUuid, data.targetUuid);
                appendLogToFile(logKey, logEntry);
                
                const target = connectedPeers.get(data.targetUuid);
                if (target && target.ws.readyState === ws.OPEN) {
                    target.ws.send(JSON.stringify({ 
                        type: 'DIRECT_CHAT', 
                        senderUuid: currentUuid, 
                        content: data.content, 
                        isImage: data.isImage,
                        time: logEntry.time,
                        senderName: peerData.name,
                        readBy: {}
                    }));
                }
            }

            if (data.type === 'ROOM_CHAT') {
                const room = rooms.get(data.roomId);
                if (room && (room.members.includes(currentUuid) || room.id === 'general' || room.id === 'visitors_lobby')) {
                    // Проверка разрешений для тегов в группе
                    if (room.tagPermissions && room.tagPermissions[peerData.tag]) {
                        const perm = room.tagPermissions[peerData.tag];
                        if (perm.canWrite === false && !peerData.isAdmin) {
                            return ws.send(JSON.stringify({ type: 'ERROR', message: 'Ваш тег не имеет прав писать в этот канал.' }));
                        }
                    }

                    if (peerData.bans.text || (data.isImage && peerData.bans.images)) {
                        return ws.send(JSON.stringify({ type: 'ERROR', message: 'Действие заблокировано администратором.' }));
                    }

                    const logEntry = { 
                        time: data.time || new Date().toISOString(), 
                        senderUuid: currentUuid, 
                        senderName: peerData.name, 
                        content: data.content, 
                        isImage: data.isImage,
                        readBy: {}
                    };
                    appendLogToFile(`room_${data.roomId}`, logEntry);
                    broadcastToRoom(data.roomId, { 
                        type: 'ROOM_CHAT', 
                        roomId: data.roomId, 
                        senderUuid: currentUuid, 
                        senderName: peerData.name,
                        content: data.content, 
                        isImage: data.isImage,
                        time: logEntry.time,
                        readBy: {}
                    });
                }
            }

            if (data.type === 'DELETE_MSG') {
                let logKey = '';
                if (data.targetId.startsWith('room_') || data.targetId === 'general' || data.targetId === 'visitors_lobby') {
                    logKey = `room_${data.targetId}`;
                } else {
                    logKey = getDirectLogKey(currentUuid, data.targetId);
                }
                
                deleteLogFromFile(logKey, data.timestamp, data.content);

                if (data.targetId.startsWith('room_') || data.targetId === 'general' || data.targetId === 'visitors_lobby') {
                    const roomId = data.targetId.replace('room_', '');
                    broadcastToRoom(roomId, { type: 'MSG_DELETED', timestamp: data.timestamp, content: data.content, targetId: data.targetId });
                } else {
                    ws.send(JSON.stringify({ type: 'MSG_DELETED', timestamp: data.timestamp, content: data.content, targetId: data.targetId }));
                    const target = connectedPeers.get(data.targetId);
                    if (target && target.ws.readyState === ws.OPEN) {
                        target.ws.send(JSON.stringify({ type: 'MSG_DELETED', timestamp: data.timestamp, content: data.content, targetId: currentUuid }));
                    }
                }
            }

            if (['RTC_OFFER', 'RTC_ANSWER', 'RTC_ICE'].includes(data.type)) {
                const target = connectedPeers.get(data.targetUuid);
                if (target && target.ws.readyState === ws.OPEN && !peerData.bans.mic) {
                    data.senderUuid = currentUuid;
                    target.ws.send(JSON.stringify(data));
                }
            }
        } catch (e) {
            console.error("[MsgErr]", e);
        }
    });

    ws.on('close', () => {
        if (currentUuid) {
            connectedPeers.delete(currentUuid);
            broadcastUserList();
        }
    });
});

function broadcastUserList() {
    const users = Array.from(allKnownUsers.values()).map(u => {
        const peer = connectedPeers.get(u.uuid);
        return {
            uuid: u.uuid,
            name: u.name,
            tag: u.tag || 'Посетитель',
            isAdmin: u.isAdmin,
            bans: u.bans || { text: false, images: false, links: false, mic: false, listen: false },
            online: !!peer,
            micActive: peer ? peer.micActive : false,
            listenActive: peer ? peer.listenActive : true,
            currentVoiceChannel: peer ? peer.currentVoiceChannel : null
        };
    });
    const msg = JSON.stringify({ type: 'USER_LIST', users });
    connectedPeers.forEach(p => { if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg); });
}

function broadcastRoomList() {
    connectedPeers.forEach((peer, uuid) => {
        sendRoomListToUser(uuid);
    });
}

function sendRoomListToUser(uuid) {
    const peer = connectedPeers.get(uuid);
    if (peer && peer.ws.readyState === peer.ws.OPEN) {
        peer.ws.send(JSON.stringify({ type: 'ROOM_LIST', rooms: getAvailableRoomsForUser(uuid) }));
    }
}

function getAvailableRoomsForUser(uuid) {
    const peer = connectedPeers.get(uuid);
    const list = [];
    rooms.forEach((room) => {
        if (room.id === 'general' || room.id === 'visitors_lobby' || room.members.includes(uuid) || (peer && peer.isAdmin)) {
            list.push({ 
                id: room.id, 
                name: room.name, 
                description: room.description || '',
                avatar: room.avatar || '',
                channelType: room.channelType || 'text',
                allowedTags: room.allowedTags || [],
                tagPermissions: room.tagPermissions || {},
                adminUuid: room.adminUuid,
                members: room.members,
                isMember: room.members.includes(uuid), 
                isAdmin: room.adminUuid === uuid || (peer && peer.isAdmin) 
            });
        }
    });
    return list;
}

function broadcastToRoom(roomId, data) {
    const room = rooms.get(roomId);
    if (!room) return;
    const msg = JSON.stringify(data);
    const recipients = roomId === 'general' || roomId === 'visitors_lobby' ? Array.from(connectedPeers.keys()) : room.members;
    recipients.forEach(uuid => {
        const peer = connectedPeers.get(uuid);
        if (peer && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(msg);
    });
}

server.listen(8080, '0.0.0.0', () => {
    console.log('\n==================================================');
    console.log(' [Сервер v0.1.3 Pro: Теги, Лобби, Звонки ГС] ');
    console.log('==================================================\n');
});