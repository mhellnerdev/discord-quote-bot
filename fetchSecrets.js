const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

async function getSecrets() {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
    const command = new GetSecretValueCommand({ SecretId: "discord-bot-secrets" });

    try {
        const data = await client.send(command);
        if (data.SecretString) {
            const secrets = JSON.parse(data.SecretString);
            process.env.DISCORD_TOKEN = secrets.DISCORD_TOKEN;
            process.env.AWS_REGION = secrets.AWS_REGION;
            process.env.TOPIC_ARN = secrets.TOPIC_ARN;
            process.env.DYNAMODB_TABLE = secrets.DYNAMODB_TABLE;
        }
    } catch (err) {
        console.error("Error fetching secrets:", err);
        throw err;
    }
}

module.exports = { getSecrets };

