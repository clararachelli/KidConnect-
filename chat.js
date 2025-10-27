const Paho = require("paho-mqtt");
const readline = require("readline");
const { readLog, writeLog } = require('./logHandler');
const GroupManager = require("./GroupManager");
const ever = true;

async function displayLog() {
    const logContent = readLog();

    if (logContent.startsWith('[INFO]') || logContent.startsWith('[ERRO]')) {
        displayMessage(logContent);
    } else {
        console.log("\n--- Conteúdo do Log de Depuração ---");
        console.log(logContent.trim());
        console.log("-------------------------------------\n");
    }
}

const userInput = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let currentPrompt = "";
let isWaitingInput = false;

function displayMessage(message) {
    if (isWaitingInput) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);

        console.log(message);

        process.stdout.write(currentPrompt);

        if (userInput.line) {
            process.stdout.write(userInput.line);
        }

        return;
    }

    console.log(message);
}

function question(prompt) {
    currentPrompt = prompt;
    isWaitingInput = true;

    return new Promise((resolve) => {
        userInput.question(prompt, (answer) => {
            isWaitingInput = false;
            currentPrompt = "";

            resolve(answer);
        });
    });
}

async function main() {
    const userId = await question("Digite seu ID de usuário: ");

    const lastWill = new Paho.Message(JSON.stringify({ user: userId }));
    lastWill.destinationName = 'LAST_WILL';
    lastWill.qos = 1;

    const mosquitto = "ws://localhost:8083/mqtt";
    const client = new Paho.Client(mosquitto, String(userId)) ;

    const TOPIC_USERS = "USERS";
    const TOPIC_GROUPS = "GROUPS";
    const TOPIC_SYNC_REQUEST = "SYNC_REQUEST";
    const ID_Control = `${userId}_Control`;

    const userStatusMap = new Map();
    const conversationRequestsArray = [];

    client.onConnectionLost = () => {
        displayMessage("[INFO] Conexão perdida.");
    };

    client.onMessageArrived = async (msg) => {
        const topic = msg.destinationName;
        const payload = msg.payloadString;

        try {
            const data = JSON.parse(payload);

            if (topic === TOPIC_USERS) {
                if (data.user && data.status) {
                    userStatusMap.set(data.user, data.status);
                }
            }

            if (topic === TOPIC_SYNC_REQUEST) {
                if (data.requester && data.requester !== userId) {
                    publish(TOPIC_USERS, { user: userId, status: "online" });
                }
            }

            if (topic === 'LAST_WILL') {
                // notificar usuarios em conversas privadas?
                if (userId !== data.user) {
                    publish(TOPIC_USERS, { user: data.user, status: "offline" });
                }
            }

            if (topic === ID_Control) {
                if (topic === ID_Control) {
                    if (data.messageMode === 'private') {
                        writeLog(`SOLICITACAO RECEBIDA: De ${data.sender} para ${ID_Control}`);
                        const existingRequest = conversationRequestsArray.find(req => req.sender === data.sender);

                        if (!existingRequest) {
                            conversationRequestsArray.push({
                                sender: data.sender,
                                timestamp: Date.now()
                            });
                            displayMessage(`\n[SOLICITAÇÃO] Nova conversa pendente de ${data.sender}.`);
                        } else {
                            displayMessage(`\n[INFO] Solicitação ja foi enviada e aguarda confirmacao`);
                        }

                        return;
                    }

                    if (data.messageMode === 'chatConfirmation') {
                        writeLog(`SOLICITACAO CONFIRMADA: Topico gerado ${data.chatId}`);

                        displayMessage(`\n[INFO] Conversa iniciada com ${data.sender} no chat ${data.chatId}`);
                        client.subscribe(data.chatId);
                    }
                }
            }

        } catch {
            displayMessage("\n[ERRO] Mensagem inválida: " + payload);
        }
    };

    client.connect({
        willMessage: lastWill,
        cleanSession: false,
        onSuccess: async () => {
            displayMessage(`[INFO] Conectado como ${userId}`);
            client.subscribe(TOPIC_USERS);
            client.subscribe('LAST_WILL');
            client.subscribe(TOPIC_SYNC_REQUEST);
            client.subscribe(ID_Control);

            publish(TOPIC_USERS, { user: userId, status: "online" });

            publish(TOPIC_SYNC_REQUEST, { requester: userId });

            process.on("SIGINT", () => {
                publish(TOPIC_USERS, { user: userId, status: "offline" });
                displayMessage(`\n[INFO] ${userId} saiu`);
                client.disconnect();
                process.exit(0);
            });

            await menuLoop();
        },
        onFailure: (err) => {
            console.error("Falha ao conectar:", err.errorMessage);
        }
    });

    function publish(topic, obj, retain = false) {
        const msg = new Paho.Message(JSON.stringify(obj));
        msg.destinationName = topic;
        msg.qos = 1;
        msg.retained = retain;
        client.send(msg);
    }

    const groupManager = new GroupManager(
        userId,
        publish,
        question,
        displayMessage
    );

    async function manageRequests() {
        if (conversationRequestsArray.length === 0) {
            displayMessage("\n[INFO] Nenhuma solicitação de conversa pendente.");
            return;
        }

        const requestsArray = conversationRequestsArray;

        console.log("\n--- Solicitações Pendentes ---");
        requestsArray.forEach((reqData, index) => {
            console.log(`${index + 1} - De: ${reqData.sender} (Recebida em: ${new Date(reqData.timestamp).toLocaleTimeString()})`);
        });
        console.log("-----------------------------\n");

        const selection = String(await question("Digite o número da solicitação para ACEITAR, ou 'V' para voltar: "));

        if (selection.toUpperCase() === 'V') {
            return;
        }

        const index = parseInt(selection) - 1;

        if (index >= 0 && index < requestsArray.length) {
            const requestToAccept = requestsArray[index];
            const senderId = requestToAccept.sender;

            const chatId = `${senderId}_${userId}_${requestToAccept.timestamp}`;

            publish(`${senderId}_Control`, {
                sender: userId,
                messageMode: 'chatConfirmation',
                chatId: chatId
            });

            client.subscribe(chatId);

            displayMessage(`\n[INFO] Conversa aceita com ${senderId} na sala ${chatId}.`);

            conversationRequestsArray.splice(index, 1);
        } else {
            displayMessage("[INFO] Seleção inválida.");
        }
    }

    async function groupSubMenu() {
        console.log("\n--- Menu de Grupos ---");
        console.log("1 - Criar Novo Grupo");
        console.log("2 - Listar Grupos Cadastrados");
        console.log("V - Voltar\n");

        const option = await question("Digite sua opção: ");

        if (option === '1') {
            await groupManager.createGroup();
        } else if (option === '2') {
            groupManager.listGroups();
        } else if (option.toUpperCase() !== 'V') {
            displayMessage("Opção inválida.");
        }
    }

    async function menuLoop() {
        for(;ever;) {
            console.log("\nMenu KidConnect");
            console.log("1 - Solicitar conversa");
            console.log("2 - Listar usuários");
            console.log("3 - Sair");
            console.log("4 - Gerenciar solicitações de conversa");
            console.log("5 - Exibir log de depuração");
            console.log("6 - Gerenciar Grupos\n");

            const option = await question("Digite sua opção: ");

            if (option === "1") {
                const username = await question("Informe o username do usuário: ");
                publish(`${username}_Control`, { sender: userId, messageMode: "private" });
                displayMessage("[INFO] Solicitação enviada.");
            }

            else if (option === "2") {
                console.log("\nUsuários Conhecidos");
                for (const [user, status] of userStatusMap.entries()) {

                    if (user !== userId) {
                        console.log(`${user}: ${status}`);

                        continue;
                    }

                    console.log(`${userId}: usuario atual`)
                }
                console.log("\n");
            }

            else if (option === "3") {
                publish(TOPIC_USERS, { user: userId, status: "offline" });
                displayMessage(`${userId} saiu.`);
                client.disconnect();
                process.exit(0);
            }

            if (option === "4") {
                await manageRequests();
            }

            else if (option === "5") {
                await displayLog();
            }

            else if (option === "6") {
                await groupSubMenu();
            }

            else {
                displayMessage("Opção inválida.");
            }
        }
    }
}

main().then();