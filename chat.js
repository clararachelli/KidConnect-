const Paho = require("paho-mqtt");
const readline = require("readline");
const GroupManager = require("./GroupManager");
const { readLog, writeLog } = require('./logHandler');

const BROKER_URL = "ws://localhost:8083/mqtt";
const TOPIC_USERS_ROOT = "USERS";
const TOPIC_GROUPS_ROOT = "GROUPS";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ''
});

let currentPromptStr = "";
let activeChatId = null;
let isAsking = false;

function displayMessage(message) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    console.log(message);

    process.stdout.write(currentPromptStr);
    if (rl.line) {
        process.stdout.write(rl.line);
    }
}

function question(promptText) {
    currentPromptStr = promptText;
    isAsking = true;

    return new Promise((resolve) => {
        rl.question(promptText, (answer) => {
            isAsking = false;
            currentPromptStr = "";
            resolve(answer.trim());
        });
    });
}

async function main() {
    console.clear();
    const userId = await question("Digite seu ID de usuário: ");

    const MY_USER_TOPIC = `${TOPIC_USERS_ROOT}/${userId}`;
    const ID_Control = `${userId}_Control`;

    const lastWill = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
    lastWill.destinationName = MY_USER_TOPIC;
    lastWill.qos = 1;
    lastWill.retained = true;

    const client = new Paho.Client(BROKER_URL, String(userId));
    const userStatusMap = new Map();

    const requestsArray = [];
    const chatHistory = new Map();

    function publish(topic, obj, retain = false) {
        try {
            const msg = new Paho.Message(JSON.stringify(obj));
            msg.destinationName = topic;
            msg.qos = 1;
            msg.retained = retain;
            client.send(msg);
        } catch (e) { console.error(e); }
    }

    const groupManager = new GroupManager(userId, publish, question, displayMessage);

    client.onConnectionLost = (resp) => {
        if (resp.errorCode !== 0) displayMessage(`[SISTEMA] Conexão perdida: ${resp.errorMessage}`);
    };

    client.onMessageArrived = (msg) => {
        const topic = msg.destinationName;
        const payload = msg.payloadString;
        if (!payload) return;

        try {
            const data = JSON.parse(payload);

            if (chatHistory.has(topic)) {
                chatHistory.get(topic).push(data);
                if (activeChatId === topic && data.sender !== userId) {
                    displayMessage(`[${data.sender}]: ${data.text}`);
                }
            }

            if (topic === ID_Control) {
                if (data.messageMode === 'private') {
                    writeLog(`Solicitacao de privado recebida: ${data.sender}`);

                    if (!requestsArray.find((request) => request.sender === data.sender && request.type === 'private')) {
                        requestsArray.push({ type: 'private', sender: data.sender, timestamp: Date.now() });
                        displayMessage(`\n[SOLICITAÇÃO] ${data.sender} quer conversar.`);
                    }
                }
                else if (data.messageMode === 'chatConfirmation') {
                    writeLog(`Solicitacao aceita por: ${data.sender}. Tópico: ${data.chatId}`);

                    if (!chatHistory.has(data.chatId)) {
                        chatHistory.set(data.chatId, []);
                        client.subscribe(data.chatId);
                        displayMessage(`\n[INFO] Chat iniciado: ${data.chatId}`);
                    }
                }
                else if (data.messageMode === 'groupJoinRequest') {
                    writeLog(`Solicitacao de grupo recebida de: ${data.sender} para entrar em: ${data.groupName}`);

                    requestsArray.push({
                        type: 'group',
                        sender: data.sender,
                        groupName: data.groupName,
                        timestamp: Date.now()
                    });
                    displayMessage(`\n[SOLICITAÇÃO] ${data.sender} quer entrar no grupo '${data.groupName}'.`);
                }
            }

            if (topic.startsWith(TOPIC_USERS_ROOT) && data.user) userStatusMap.set(data.user, data.status);

            if (topic.startsWith(TOPIC_GROUPS_ROOT)) {
                groupManager.updateGroupLocalState(data);

                if (data.members?.includes(userId)) {
                    const groupChatTopic = `GROUP_CHAT/${data.groupName}`;
                    if (!chatHistory.has(groupChatTopic)) {
                        chatHistory.set(groupChatTopic, []);
                        client.subscribe(groupChatTopic);
                    }
                }
            }

        } catch (e) {}
    };

    client.connect({
        willMessage: lastWill,
        cleanSession: false,
        onSuccess: async () => {
            displayMessage(`[SISTEMA] Conectado como: ${userId}`);
            client.subscribe(`${TOPIC_USERS_ROOT}/+`);
            client.subscribe(`${TOPIC_GROUPS_ROOT}/+`);
            client.subscribe(ID_Control);
            publish(MY_USER_TOPIC, { user: userId, status: "online" }, true);

            groupManager.groupsMap.forEach(group => {
                if(group.members.includes(userId)) {
                    const topic = `GROUP_CHAT/${group.groupName}`;
                    if(!chatHistory.has(topic)) chatHistory.set(topic, []);
                    client.subscribe(topic);
                }
            });

            process.on("SIGINT", () => {
                const msg = new Paho.Message(JSON.stringify({ user: userId, status: "offline" }));
                msg.destinationName = MY_USER_TOPIC;
                msg.qos = 1;
                msg.retained = true;
                client.send(msg);
                setTimeout(() => { client.disconnect(); process.exit(0); }, 500);
            });

            await menuLoop();
        },
        onFailure: (err) => { console.error("Falha ao conectar:", err.errorMessage); process.exit(1); }
    });

    async function enterChatMode(chatId) {
        activeChatId = chatId;
        console.clear();

        let chatName = chatId;

        if (chatId.startsWith(TOPIC_GROUPS_ROOT)) {
            chatName = chatId.split('/')[1];
        }
        else {
            const splitChatId = chatId.split('_');

            chatName = splitChatId[0] === userId ? splitChatId[1] : splitChatId[0];
        }

        console.log(`=== CHAT: ${chatName} ===`);
        console.log("Digite '/sair' para voltar.\n");

        const history = chatHistory.get(chatId) || [];
        history.forEach(msg => {
            const label = (msg.sender === userId) ? "Você" : msg.sender;
            console.log(`[${label}]: ${msg.text}`);
        });

        let inChat = true;
        while (inChat) {
            const text = await question("> ");
            if (text === '/sair') {
                inChat = false;
                activeChatId = null;
                console.log("Saindo...");
                break;
            }
            if (text) {
                const msgPayload = { sender: userId, text: text, timestamp: Date.now() };
                publish(chatId, msgPayload, false);
                console.log(`[Você]: ${text}`);
                chatHistory.get(chatId).push(msgPayload);
            }
        }
    }

    async function manageRequests() {
        if (requestsArray.length === 0) {
            console.log("Nenhuma solicitação pendente.");
            return;
        }
        console.log("\n--- Solicitações ---");
        requestsArray.forEach((req, idx) => {
            if (req.type === 'private') {
                console.log(`${idx+1}. [PRIVADO] De: ${req.sender}`);
            } else {
                console.log(`${idx+1}. [GRUPO] De: ${req.sender} para entrar em '${req.groupName}'`);
            }
        });

        const sel = await question("Número para aceitar (ou V): ");
        if (sel.toUpperCase() === 'V') return;

        const idx = parseInt(sel) - 1;
        if (idx >= 0 && idx < requestsArray.length) {
            const req = requestsArray[idx];

            if (req.type === 'private') {
                const chatId = `${req.sender}_${userId}_${req.timestamp}`;
                publish(`${req.sender}_Control`, { sender: userId, messageMode: 'chatConfirmation', chatId: chatId });
                if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
                client.subscribe(chatId);
                console.log(`[SUCESSO] Chat Privado criado: ${chatId}`);
            }
            else if (req.type === 'group') {
                groupManager.addMemberToGroup(req.groupName, req.sender);
            }

            requestsArray.splice(idx, 1);
        }
    }

    async function listActiveChats() {
        if (chatHistory.size === 0) {
            console.log("Nenhuma conversa ativa.");
            return null;
        }
        console.log("\n--- Conversas Ativas (Privadas e Grupos) ---");
        const chats = Array.from(chatHistory.keys());

        chats.forEach((chat, index) => {
            let displayName;
            if (chat.startsWith("GROUP_CHAT/")) {
                displayName = `[GRUPO] ${chat.replace("GROUP_CHAT/", "")}`;
            }
            else {
                const splitChatId = chat.split("_");
                displayName = `[PRIVADO] ${splitChatId[0] === userId ? splitChatId[1] : splitChatId[0]}`;
            }

            console.log(`${index + 1}. ${displayName}`);
        });

        const chat = await question("Escolha o número (ou V): ");
        if (chat.toUpperCase() === 'V') return null;
        const chatIndex = parseInt(chat) - 1;
        return (chatIndex >= 0 && chatIndex < chats.length) ? chats[chatIndex] : null;
    }

    async function showLogs() {
        console.log("\n--- Logs do Sistema ---");
        const content = readLog();
        console.log(content ? content : "nehnhum log encontrado");
        console.log("---------------------------------------------");
        await question("Pressione ENTER para voltar...");
    }

    async function menuLoop() {
        while (true) {
            console.log("\n=== KIDCONNECT MQTT ===");
            console.log("1. Enviar solicitacao de conversa");
            console.log("2. Listar usuarios");
            console.log("3. Solicitações Pendentes (Privadas e Grupos)");
            console.log("4. Grupos (Listar / Criar / Entrar)");
            console.log("5. ENTRAR EM CONVERSA (Chat)");
            console.log("6. Exibir Logs (Depuração)");
            console.log("0. Sair");

            const option = await question("Opção: ");

            switch (option) {
                case "1":
                    const target = await question("ID Alvo: ");
                    if (target !== userId) {
                        publish(`${target}_Control`, { sender: userId, messageMode: "private" });
                        console.log("Solicitação enviada.");
                    }
                    break;
                case "2":
                    console.log("\n--- Usuários ---");
                    for (const [u, s] of userStatusMap.entries()) console.log(`> [${s}] ${u}`);
                    break;
                case "3":
                    await manageRequests();
                    break;
                case "4":
                    await groupSubMenu();
                    break;
                case "5":
                    const chat = await listActiveChats();
                    if (chat) await enterChatMode(chat);
                    break;
                case "6":
                    await showLogs();
                    break;
                case "0":
                    process.emit("SIGINT");
                    return;
                default: console.log("Opção inválida.");
            }
        }
    }

    async function groupSubMenu() {
        console.log("\n--- Menu Grupos ---");
        console.log("1. Criar Grupo");
        console.log("2. Listar / Solicitar Entrada");
        console.log("V. Voltar");
        const op = await question("Opção: ");
        if (op === '1') await groupManager.createGroup();
        else if (op === '2') await groupManager.listGroups();
    }
}

main().catch(console.error);