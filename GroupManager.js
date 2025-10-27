
class GroupManager {
    constructor(userId, publish, question, displayMessage) {
        this.userId = userId;
        this.publish = publish;
        this.question = question;
        this.displayMessage = displayMessage;

        this.groupsMap = new Map();

        this.TOPIC_GROUPS = "GROUPS";
    }

    publishGroupState(groupName) {
        const groupData = this.groupsMap.get(groupName);
        if (groupData) {
            this.publish(this.TOPIC_GROUPS, groupData, true);
        }
    }

    handleGroupStateMessage(data) {
        if (data.groupName && data.leader && data.members) {
            this.groupsMap.set(data.groupName, data);
        }
    }

    async createGroup() {
        const groupName = await this.question("Digite o nome do novo grupo: ");

        if (this.groupsMap.has(groupName)) {
            this.displayMessage(`\n[ERRO] O grupo '${groupName}' já existe localmente.`);
            return;
        }

        const newGroup = {
            groupName: groupName,
            leader: this.userId,
            members: [this.userId]
        };

        this.groupsMap.set(groupName, newGroup);

        this.publishGroupState(groupName);

        this.displayMessage(`\n[SUCESSO] Grupo '${groupName}' criado.`);
    }

    listGroups() {
        if (this.groupsMap.size === 0) {
            this.displayMessage("\nNenhum grupo encontrado.");
            return;
        }

        console.log("\n--- Grupos Cadastrados ---");
        this.groupsMap.forEach((group, name) => {
            const otherMembers = group.members.filter(m => m !== group.leader);
            const membersList = otherMembers.join(', ');

            console.log(`\nNome do Grupo: ${name}`);
            console.log(`  Líder: ${group.leader === this.userId ? "(Voce)" : group.leader}`);
            console.log(`  Demais Membros: ${membersList.length > 0 ? membersList : '[]'}`);
        });
        console.log("----------------------------\n");
    }
}

module.exports = GroupManager;