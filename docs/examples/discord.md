## Build Discord SDK

### Generate SDK

```bash
npx @sdk-it/cli@latest \
  --spec https://raw.githubusercontent.com/discord/discord-api-spec/refs/heads/main/specs/openapi.json \
  --output ./discord \
  --name Discord \
  --mode full
```

### Create and configure Client

```ts
import { Discord } from './discord';

const discord = new Discord({
  baseUrl: 'https://discord.com/api/v10',
  Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
});
```

### Get Current Bot User

```ts
const [result, error] = await discord.request('GET /users/@me', {});

if (!error) {
  console.log(`Bot User: ${result.username}#${result.discriminator}`);
  console.log(`ID: ${result.id}`);
  console.log(`Avatar: ${result.avatar}`);
} else {
  console.error(error);
}
```

### Get Guild Information

```ts
const [result, error] = await discord.request('GET /guilds/{guild_id}', {
  guild_id: '123456789012345678',
});

if (!error) {
  console.log(`Guild: ${result.name}`);
  console.log(`Member Count: ${result.approximate_member_count}`);
  console.log(`Icon: ${result.icon}`);
  console.log(`Owner ID: ${result.owner_id}`);
} else {
  console.error(error);
}
```

### Get Guild Channels

```ts
const [result, error] = await discord.request(
  'GET /guilds/{guild_id}/channels',
  {
    guild_id: '123456789012345678',
  },
);

if (!error) {
  console.log(`Total channels: ${result.length}`);
  for (const channel of result) {
    console.log(`- ${channel.name} (${channel.type}): ${channel.id}`);
  }
} else {
  console.error(error);
}
```

### Send Message to Channel

```ts
const [result, error] = await discord.request(
  'POST /channels/{channel_id}/messages',
  {
    channel_id: '123456789012345678',
    content: 'Hello from SDK-IT!',
    embeds: [
      {
        title: 'SDK-IT Discord Example',
        description:
          'This message was sent using a type-safe Discord client generated with SDK-IT',
        color: 0x3498db,
        fields: [
          {
            name: 'Documentation',
            value:
              '[Discord Developer Portal](https://discord.com/developers/docs)',
          },
        ],
      },
    ],
  },
);

if (!error) {
  console.log(`Message sent successfully! ID: ${result.id}`);
} else {
  console.error(error);
}
```

### Create Channel Invite

```ts
const [result, error] = await discord.request(
  'POST /channels/{channel_id}/invites',
  {
    channel_id: '123456789012345678',
    max_age: 86400, // 24 hours
    max_uses: 5,
    temporary: false,
    unique: true,
  },
);

if (!error) {
  console.log(`Invite created: https://discord.gg/${result.code}`);
  console.log(`- Expires at: ${result.expires_at}`);
  console.log(`- Max uses: ${result.max_uses}`);
} else {
  console.error(error);
}
```

### Edit Guild Role

```ts
const [result, error] = await discord.request(
  'PATCH /guilds/{guild_id}/roles/{role_id}',
  {
    guild_id: '123456789012345678',
    role_id: '123456789012345678',
    name: 'New Role Name',
    color: 0xff0000, // Red
    permissions: '1073741824', // Permissions integer
    hoist: true, // Display role separately in the sidebar
    mentionable: true,
  },
);

if (!error) {
  console.log(`Role updated: ${result.name}`);
  console.log(`- Color: ${result.color.toString(16)}`);
  console.log(`- Position: ${result.position}`);
} else {
  console.error(error);
}
```
