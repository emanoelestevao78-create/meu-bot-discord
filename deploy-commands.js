import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Bot online!'));
app.listen(process.env.PORT || 3000);

import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const required = ["TOKEN", "CLIENT_ID"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required before deploying commands.`);
  }
}

const trade1Command = new SlashCommandBuilder()
  .setName("trade")
  .setDescription("Start a role exchange proposal with another member.")
  .addStringOption((option) =>
    option
      .setName("offered_role")
      .setDescription("Select the role you want to offer")
      .setRequired(true)
      .setAutocomplete(true),
  );

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

try {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: [tradeCommand.toJSON()],
  });
  console.log("Registered /trade globally.");
} catch (error) {
  console.error("Could not register /trade.", error);
  process.exitCode = 1;
}
