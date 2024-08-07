require("dotenv").config(); // Only needed for local testing with a .env file
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const { SNSClient, PublishCommand, SubscribeCommand } = require("@aws-sdk/client-sns");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const winston = require("winston");
const { getSecrets } = require("./fetchSecrets");

// Load secrets and start the bot
getSecrets().then(() => {
  // Configure AWS clients
  const snsClient = new SNSClient({ region: process.env.AWS_REGION });
  const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
  const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

  // Create a new Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages
    ],
    partials: ["CHANNEL"]
  });

  // Configure logger
  const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp}: ${level}: ${message}`;
      })
    ),
    transports: [new winston.transports.Console()],
  });

  // Helper function to get a random quote
  async function getQuote() {
    try {
      const response = await axios.get("https://zenquotes.io/api/random");
      const quote = response.data[0]["q"] + " -" + response.data[0]["a"];
      return quote;
    } catch (error) {
      logger.error("Error fetching quote:", error);
      throw error;
    }
  }

  // Function to publish a message to an AWS SNS topic
  async function publishMessage(phoneNumber, message) {
    const params = {
      PhoneNumber: phoneNumber,
      Message: message,
    };

    try {
      const command = new PublishCommand(params);
      const response = await snsClient.send(command);
      return response.MessageId;
    } catch (error) {
      logger.error("Could not publish to this phone number:", error);
      throw error;
    }
  }

  // Function to subscribe a phone number to an SNS topic
  async function subscribePhoneNumberToTopic(phoneNumber, topicArn) {
    const params = {
      Protocol: "sms",
      TopicArn: topicArn,
      Endpoint: phoneNumber,
    };

    try {
      const command = new SubscribeCommand(params);
      const response = await snsClient.send(command);
      return response.SubscriptionArn;
    } catch (error) {
      console.error("Error subscribing phone number:", error);
      throw error;
    }
  }

  // Function to get phone number from DynamoDB
  async function getPhoneNumber(userId) {
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { UserId: userId },
    };

    try {
      const command = new GetCommand(params);
      const response = await ddbDocClient.send(command);
      return response.Item ? response.Item.PhoneNumber : null;
    } catch (error) {
      logger.error("Could not get phone number from DynamoDB:", error);
      throw error;
    }
  }

  // Function to save phone number to DynamoDB
  async function savePhoneNumber(userId, phoneNumber) {
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        UserId: userId,
        PhoneNumber: phoneNumber,
      },
    };

    try {
      const command = new PutCommand(params);
      await ddbDocClient.send(command);
    } catch (error) {
      logger.error("Could not save phone number to DynamoDB:", error);
      throw error;
    }
  }

  // Function to delete phone number from DynamoDB
  async function deletePhoneNumber(userId) {
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { UserId: userId },
    };

    try {
      const command = new DeleteCommand(params);
      await ddbDocClient.send(command);
    } catch (error) {
      logger.error("Could not delete phone number from DynamoDB:", error);
      throw error;
    }
  }

  // Print logged-in message to console when bot is connected
  client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
  });

  // Watch for !inspire to execute sending message to Discord channel and publish to SNS topic to send SMS
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const msg = message.content;

    if (msg.startsWith("!inspire")) {
      try {
        const quote = await getQuote();
        await message.channel.send(quote);
        const phoneNumber = await getPhoneNumber(message.author.id);
        if (phoneNumber) {
          const messageId = await publishMessage(phoneNumber, quote);
          logger.info(`Message published to phone number ${phoneNumber} with message Id - ${messageId}`);
          await message.author.send("Your inspirational quote has been sent to your phone!");
        }
      } catch (error) {
        logger.error("Error handling !inspire command:", error);
        await message.author.send("Something went wrong while fetching your inspirational quote. Please try again later.");
      }
    }

    if (msg.startsWith("!subscribe")) {
      try {
        const dmChannel = await message.author.createDM();
        await dmChannel.send("Please reply with your phone number to subscribe to SMS notifications:");
        const filter = response => response.author.id === message.author.id;
        const collected = await dmChannel.awaitMessages({ filter, max: 1, time: 60000, errors: ["time"] });
        const phoneNumber = collected.first().content.trim();

        // Subscribe phone number to the SNS topic
        const topicArn = process.env.TOPIC_ARN;
        await subscribePhoneNumberToTopic(phoneNumber, topicArn);

        await dmChannel.send("Thank you! A confirmation message has been sent to your phone. Please reply to confirm your subscription.");

        // Save the phone number as pending subscription in DynamoDB
        await savePhoneNumber(message.author.id, `pending:${phoneNumber}`);

      } catch (error) {
        logger.error("Error handling !subscribe command:", error);
        await message.author.send("There was an error subscribing your phone number. Please try again.");
      }
    }

    if (msg.startsWith("!unsubscribe")) {
      try {
        const phoneNumber = await getPhoneNumber(message.author.id);
        if (phoneNumber) {
          await deletePhoneNumber(message.author.id);
          await message.author.send("Your phone number has been unsubscribed from SMS notifications.");
          logger.info(`Phone number ${phoneNumber} for user ${message.author.id} has been unsubscribed.`);
        } else {
          await message.author.send("You are not subscribed to SMS notifications.");
        }
      } catch (error) {
        logger.error("Error handling !unsubscribe command:", error);
        await message.author.send("There was an error unsubscribing your phone number. Please try again.");
      }
    }
  });

  // Run the client/bot passing in the Discord token
  client.login(process.env.DISCORD_TOKEN);
}).catch((err) => {
  console.error("Failed to load secrets and start the bot:", err);
});
