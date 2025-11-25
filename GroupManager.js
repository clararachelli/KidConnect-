class GroupManager {
    constructor(userId, publish, questionFn, displayMessage) {
        this.userId = userId;
        this.publish = publish;
        this.question = questionFn; // Recebe a função wrapper do main
        this.displayMessage = displayMessage;

        this.groupsMap = new Map();
        this.TOPIC_ROOT = "GROUPS";
    }

    updateGroupLocalState(groupData) {
        if (!groupData || !groupData.groupName) return;
        this.groupsMap.set(groupData.groupName, groupData);
    }

    async createGroup() {
        // Usa a função question passada pelo main
        const groupName = await this.question("Nome do novo grupo (sem espaços): ");

        if (!groupName || groupName.includes(" ")) {
            this.displayMessage("[ERRO] Nome inválido.");
            return;
        }

        if (this.groupsMap.has(groupName)) {
            this.displayMessage(`[ERRO] O grupo '${groupName}' já existe.`);
            return;
        }

        const newGroup = {
            groupName: groupName,
            leader: this.userId,
            members: [this.userId]
        };

        const topic = `${this.TOPIC_ROOT}/${groupName}`;
        this.publish(topic, newGroup, true);
        this.displayMessage(`[SUCESSO] Grupo '${groupName}' criado.`);
    }

    listGroups() {
        if (this.groupsMap.size === 0) {
            console.log("\n(Nenhum grupo encontrado)");
            return;
        }
        console.log("\n=== Grupos Disponíveis ===");
        this.groupsMap.forEach((group, name) => {
            console.log(`- ${name} (Líder: ${group.leader}) [${group.members.length} membros]`);
        });
        console.log("==========================\n");
    }
}

module.exports = GroupManager;