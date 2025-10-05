const Paho = require("paho-mqtt");
const readline = require("readline");

const userId = readline.question("Digite seu ID de usuário: ");
const mosquitto = "ws://localhost:8083/mqtt";
const client = new Paho.Client(mosquitto, String(userId));

const TOPIC_USERS = "USERS";
const TOPIC_GRUPS = "GROUPS";
const ID_Control = `${userId}_Control`;

client.onConnectionLost = (resp) => {
    // acredito que a atualizacao do offline possa ser feita aqui caso o terminal seja fechado sem ctrl c
};

client.onMessageArrived = (msg) => {
    const data = JSON.parse(msg.payloadString);

    if (msg.destinationName === TOPIC_USERS) {
        try {
            console.log(`${data.user} está ${data.status}`);
        } catch {
            console.log("Mensagem inválida:", msg.payloadString);
        }
    }

    if (msg.destinationName === ID_Control) {
        console.log(`Solitacao de mensagem recebida`);
    }

};

client.connect({
    onSuccess: () => {
        console.log(`Conectado como ${userId}`);
        client.subscribe(TOPIC_USERS);
        client.subscribe(ID_Control);

        publish(TOPIC_USERS, { user: userId, status: "online" });

        process.on("SIGINT", () => {
            publish(TOPIC_USERS, { user: userId, status: "offline" });
            console.log(`\n${userId} saiu`);
            client.disconnect();
            process.exit(0);
        });

        const action = readline.question("Menu KidConnect \n1 - Solicitar Conversa\nDigite sua opcao: ");

        const actionObject = {
            1: 'request_chat'
        };

        if (actionObject[action] === 'request_chat') {
            const username = readline.question("Informe o username do usuario: ");
            publish(`${username}_Control`, { requesterUsername: userId, messageMode: "private" });
        }
    },
    onFailure: (err) => {
        console.error("Falha ao conectar:", err.errorMessage);
    }
});

function publish(topic, obj) {
    const msg = new Paho.Message(JSON.stringify(obj));
    msg.destinationName = topic;
    client.send(msg);
}
