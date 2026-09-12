import express from 'express';
import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from "discord.js";

// Servidor Web para o UptimeRobot
const app = express();
app.use(express.static('public'));
app.get('/download-zip', (req, res) => {
  res.download('./public/bot.zip');
});



app.get('/', (req, res) => {
  res.send('Bot Status: Online');
});

app.listen(3000, () => {
  console.log('Web server running on port 3000');
});




const required = ["TOKEN", "CLIENT_ID"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required before starting the bot.`);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const sessions = new Map();
const proposals = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

const customIds = {
  member: "trade:member",
  offer: "trade:offer",
  request: "trade:request",
  send: "trade:send",
  cancel: "trade:cancel",
};

function manageableRoles(member, guild) {
  const botMember = guild.members.me;
  if (!botMember) return [];
  return member.roles.cache
    .filter(
      (role) =>
        role.id !== guild.id &&
        !role.managed &&
        role.position < botMember.roles.highest.position,
    )
    .sort((a, b) => b.position - a.position)
    .first(25);
}

function roleMenu(customId, placeholder, roles) {
  const options = roles.map((role) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(role.name.slice(0, 100))
      .setValue(role.id)
      .setDescription(`Role position ${role.position}`.slice(0, 100)),
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options),
  );
}

function actionButtons(proposalId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade:accept:${proposalId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`trade:decline:${proposalId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function proposalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSession(userId) {
  const session = sessions.get(userId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(userId);
    return null;
  }
  return session;
}

function getProposal(id) {
  const proposal = proposals.get(id);
  if (!proposal || proposal.expiresAt < Date.now()) {
    proposals.delete(id);
    return null;
  }
  return proposal;
}

async function handleRoleAutocomplete(interaction) {
  try {
    if (!interaction.guild) {
      await interaction.respond([]);
      return;
    }

    const focusedValue = interaction.options
      .getFocused()
      .trim()
      .toLowerCase();
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const roles = manageableRoles(member, interaction.guild)
      .filter((role) => role.name.toLowerCase().startsWith(focusedValue))
      .slice(0, 25)
      .map((role) => ({
        name: role.name,
        value: role.id,
      }));

    await interaction.respond(roles);
  } catch (error) {
    console.error("Role autocomplete failed.", error);
    try {
      await interaction.respond([]);
    } catch {
      // The autocomplete interaction may have expired while roles were loading.
    }
  }
}

async function replyError(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) {
      console.warn("Discord interaction expired before an error response could be sent.");
      return;
    }
    console.error("Could not send interaction error response.", error);
  }
}

async function startTrade(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Run `/trade` inside a server where the bot is installed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const proposer = await interaction.guild.members.fetch(interaction.user.id);
  const availableRoles = manageableRoles(proposer, interaction.guild);

  if (availableRoles.length === 0) {
    await interaction.editReply({
      content:
        "You do not have any roles that the bot can manage. Make sure the bot's highest role is above your roles in the server role list.",
    });
    return;
  }

  const offeredRoleId = interaction.options.getString("offered_role");
  let offeredRole = null;

  if (offeredRoleId) {
    offeredRole = interaction.guild.roles.cache.get(offeredRoleId);
    if (!offeredRole || !availableRoles.some((role) => role.id === offeredRole.id)) {
      await interaction.editReply({
        content:
          "The selected role is not available to trade. Please select a role you currently have that is below the bot's highest role.",
      });
      return;
    }
  }

  sessions.set(interaction.user.id, {
    guildId: interaction.guild.id,
    proposerId: interaction.user.id,
    proposerName: proposer.displayName,
    offerRoleId: offeredRole ? offeredRole.id : null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  const memberMenu = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customIds.member)
      .setPlaceholder("Choose a member")
      .setMinValues(1)
      .setMaxValues(1),
  );

  const replyContent = offeredRole
    ? `You offer **${offeredRole.name}**. Choose the member you want to trade with.`
    : "Choose the member you want to trade with.";

  await interaction.editReply({
    content: replyContent,
    components: [memberMenu],
    flags: MessageFlags.Ephemeral,
  });
}


    

    

  


  

async function handleMemberSelection(interaction) {
  const session = getSession(interaction.user.id);
  if (!session || !interaction.guild) {
    await replyError(interaction, "This trade session expired. Run `/trade` again.");
    return;
  }

  const targetId = interaction.values[0];
  if (targetId === interaction.user.id) {
    await replyError(interaction, "Choose another member for the exchange.");
    return;
  }

  const [proposer, target] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    interaction.guild.members.fetch(targetId),
  ]);
  const roles = manageableRoles(proposer, interaction.guild);
  if (roles.length === 0) {
    await replyError(
      interaction,
      "You do not have a role that this bot can trade. The bot must be above the role in the server role list.",
    );
    return;
  }

  session.targetId = target.id;
  session.targetName = target.displayName;
  session.proposerName = proposer.displayName;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(interaction.user.id, session);

  if (session.offerRoleId) {
    const offerRole = roles.find((role) => role.id === session.offerRoleId);
    const requestRoles = manageableRoles(target, interaction.guild).filter(
      (role) => role.id !== session.offerRoleId,
    );
    if (!offerRole) {
      await replyError(
        interaction,
        "That offered role is no longer available to trade.",
      );
      return;
    }
    if (requestRoles.length === 0) {
      await replyError(
        interaction,
        "That member does not have a different manageable role to request.",
      );
      return;
    }

    await interaction.update({
      content: `Trading with **${target.displayName}**. You offer **${offerRole.name}**. Choose the role you want.`,
      components: [
        roleMenu(customIds.request, "Choose the role you want", requestRoles),
      ],
    });
    return;
  }

  await interaction.update({
    content: `Trading with **${target.displayName}**. Choose the role you offer.`,
    components: [
      roleMenu(customIds.offer, "Choose the role you offer", roles),
    ],
  });
}

async function handleOfferSelection(interaction) {
  const session = getSession(interaction.user.id);
  if (!session || !interaction.guild) {
    await replyError(interaction, "This trade session expired. Run `/trade` again.");
    return;
  }

  const proposer = await interaction.guild.members.fetch(interaction.user.id);
  const roles = manageableRoles(proposer, interaction.guild);
  if (!roles.some((role) => role.id === interaction.values[0])) {
    await replyError(interaction, "That role is no longer available to trade.");
    return;
  }

  session.offerRoleId = interaction.values[0];
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(interaction.user.id, session);

  const target = await interaction.guild.members.fetch(session.targetId);
  const requestRoles = manageableRoles(target, interaction.guild).filter(
    (role) => role.id !== session.offerRoleId,
  );
  if (requestRoles.length === 0) {
    await replyError(
      interaction,
      "That member does not have a different manageable role to request.",
    );
    return;
  }

  await interaction.update({
    content: `You offer **${roles.find((role) => role.id === session.offerRoleId)?.name}**. Now choose the role you want.`,
    components: [
      roleMenu(customIds.request, "Choose the role you want", requestRoles),
    ],
  });
}

async function handleRequestSelection(interaction) {
  const session = getSession(interaction.user.id);
  if (!session || !interaction.guild) {
    await replyError(interaction, "This trade session expired. Run `/trade` again.");
    return;
  }

  session.requestRoleId = interaction.values[0];
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(interaction.user.id, session);

  const offerRole = interaction.guild.roles.cache.get(session.offerRoleId);
  const requestRole = interaction.guild.roles.cache.get(session.requestRoleId);
  if (!offerRole || !requestRole) {
    await replyError(interaction, "One of those roles is no longer available.");
    return;
  }

  await interaction.update({
    content:
      `You offer **${offerRole.name}** to **${session.targetName}** and request **${requestRole.name}** in return.\n\nSend this proposal for their approval?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customIds.send)
          .setLabel("Send proposal")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customIds.cancel)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function sendProposal(interaction) {
  const session = getSession(interaction.user.id);
  if (!session || !interaction.guild) {
    await replyError(interaction, "This trade session expired. Run `/trade` again.");
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await replyError(interaction, "I cannot send a proposal in this channel.");
    return;
  }

  const offerRole = interaction.guild.roles.cache.get(session.offerRoleId);
  const requestRole = interaction.guild.roles.cache.get(session.requestRoleId);
  if (!offerRole || !requestRole) {
    await replyError(interaction, "One of the selected roles is no longer available.");
    return;
  }

  const id = proposalId();
  const proposal = {
    id,
    guildId: interaction.guild.id,
    proposerId: session.proposerId,
    proposerName: session.proposerName,
    targetId: session.targetId,
    targetName: session.targetName,
    offerRoleId: offerRole.id,
    offerRoleName: offerRole.name,
    requestRoleId: requestRole.id,
    requestRoleName: requestRole.name,
    expiresAt: Date.now() + PROPOSAL_TTL_MS,
  };
  proposals.set(id, proposal);
  sessions.delete(interaction.user.id);

  const message = await channel.send({
    content: `<@${proposal.targetId}> — **${proposal.proposerName}** sent you a role trade proposal.`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x70e3c4)
        .setTitle("Role exchange proposal")
        .setDescription(
          `**${proposal.proposerName}** offers <@&${proposal.offerRoleId}> and requests <@&${proposal.requestRoleId}> from **${proposal.targetName}**.`,
        )
        .setFooter({ text: "Both roles will be swapped automatically after acceptance." }),
    ],
    components: [actionButtons(id)],
  });
  proposal.messageId = message.id;

  await interaction.update({
    content: `Proposal sent to **${proposal.targetName}**. They have 24 hours to accept.`,
    components: [],
  });
}

async function acceptProposal(interaction, id) {
  const proposal = getProposal(id);
  if (!proposal || !interaction.guild) {
    await replyError(interaction, "This proposal expired or no longer exists.");
    return;
  }
  if (interaction.user.id !== proposal.targetId) {
    await replyError(interaction, "Only the requested member can accept this proposal.");
    return;
  }

  await interaction.deferUpdate();
  const guild = interaction.guild;
  const botMember = guild.members.me;
  const [proposer, target] = await Promise.all([
    guild.members.fetch(proposal.proposerId),
    guild.members.fetch(proposal.targetId),
  ]);
  const offerRole = guild.roles.cache.get(proposal.offerRoleId);
  const requestRole = guild.roles.cache.get(proposal.requestRoleId);

  if (!botMember || !offerRole || !requestRole) {
    await interaction.followUp({
      content: "The server roles changed, so this proposal cannot be completed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
    offerRole.position >= botMember.roles.highest.position ||
    requestRole.position >= botMember.roles.highest.position
  ) {
    await interaction.followUp({
      content:
        "I need Manage Roles permission and must be placed above both traded roles.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    !proposer.roles.cache.has(offerRole.id) ||
    !target.roles.cache.has(requestRole.id)
  ) {
    await interaction.followUp({
      content: "One member no longer has the role involved in this proposal.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await proposer.roles.remove(offerRole);
    await target.roles.add(offerRole);
    await target.roles.remove(requestRole);
    await proposer.roles.add(requestRole);
    proposals.delete(id);

    await interaction.message.edit({
      content: `Role trade completed: **${proposal.proposerName}** and **${proposal.targetName}** exchanged roles.`,
      embeds: [],
      components: [actionButtons(id, true)],
    });
  } catch (error) {
    console.error("Role trade failed.", error);
    await interaction.followUp({
      content:
        "The trade could not be completed. Check that the bot still has Manage Roles and sits above both roles.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function declineProposal(interaction, id) {
  const proposal = getProposal(id);
  if (!proposal || !interaction.guild) {
    await replyError(interaction, "This proposal expired or no longer exists.");
    return;
  }
  if (interaction.user.id !== proposal.targetId) {
    await replyError(interaction, "Only the requested member can decline this proposal.");
    return;
  }

  proposals.delete(id);
  await interaction.update({
    content: `Proposal declined by **${proposal.targetName}**.`,
    embeds: [],
    components: [actionButtons(id, true)],
  });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Roletrade bot online as ${readyClient.user.tag}.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete() && interaction.commandName === "trade") {
      await handleRoleAutocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === "trade") {
      await startTrade(interaction);
      return;
    }
    if (interaction.isUserSelectMenu() && interaction.customId === customIds.member) {
      await handleMemberSelection(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === customIds.offer) {
      await handleOfferSelection(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === customIds.request) {
      await handleRequestSelection(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === customIds.send) {
      await sendProposal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === customIds.cancel) {
      sessions.delete(interaction.user.id);
      await interaction.update({ content: "Trade proposal cancelled.", components: [] });
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("trade:accept:")) {
      await acceptProposal(interaction, interaction.customId.slice("trade:accept:".length));
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("trade:decline:")) {
      await declineProposal(interaction, interaction.customId.slice("trade:decline:".length));
    }
  } catch (error) {
    console.error("Interaction handling failed.", error);
    if (interaction.isRepliable()) {
      await replyError(interaction, "Something went wrong while handling this trade.");
    }
  }
});

await client.login(process.env.TOKEN);