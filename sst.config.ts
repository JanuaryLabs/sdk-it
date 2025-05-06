/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="./.sst/platform/config.d.ts" />
// import { all as pulumiAll } from '@pulumi/pulumi';

export default $config({
  app(input) {
    console.dir(input, { depth: Infinity });
    return {
      name: 'sdk-it',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'local',
      providers: {
        tls: true,
        hcloud: true,
        docker: true,
        command: true,
      },
    };
  },
  async run() {
    const { writeFileSync } = await import('node:fs');
    // const { all: pulumiAll } = await import('@pulumi/pulumi');
    const { homedir } = await import('node:os');
    const { join, resolve } = await import('node:path');
    // 1. Generate SSH keypair & register public key
    const privateKey = new tls.PrivateKey('SdkItPrivateKey', {
      algorithm: 'RSA',
      rsaBits: 4096,
    });
    const publicKey = new hcloud.SshKey('SdkItPublicKey', {
      publicKey: privateKey.publicKeyOpenssh,
    });

    // 2. Persist private key to ~/.ssh
    const sshKeyLocalPath = privateKey.privateKeyOpenssh.apply((key) => {
      const sshPath = join(homedir(), '.ssh', 'hetzner_id_ed25519');
      writeFileSync(sshPath, key, { mode: 0o600 });
      return resolve(sshPath);
    });

    // 3. Create a private VLAN
    const vlan = new hcloud.Network('private-vlan', {
      ipRange: '10.10.0.0/16',
      name: 'builder-vlan',
    });
    // 4. Define a Subnet
    const subnet = new hcloud.NetworkSubnet('private-subnet', {
      networkId: vlan.id,
      type: 'cloud',
      networkZone: 'eu-central', // covers FSN1, NBG1, HEL1 :contentReference[oaicite:4]{index=4}
      ipRange: '10.10.1.0/24', // must sit inside 10.10.0.0/16
    });

    // 4. Provision servers
    const builder = new hcloud.Server('builder', {
      image: 'docker-ce',
      serverType: 'ccx13',

      location: 'fsn1',
      sshKeys: [publicKey.id],
      userData: [
        '#!/bin/bash',
        'set -e', // bail on errors
        'apt-get update',
      ].join('\n'),
    });

    const app = new hcloud.Server('app', {
      image: 'docker-ce',
      serverType: 'cax11',
      location: 'fsn1',
      sshKeys: [publicKey.id],
      userData: [
        '#!/bin/bash',
        'set -e', // bail on errors
        'apt-get update',
        'DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io curl build-essential',
        'systemctl enable docker && systemctl start docker',

        // — install NVM & Node LTS —
        'export NVM_DIR="$HOME/.nvm"',
        'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash',
        'source "$NVM_DIR/nvm.sh"',
        'nvm install --lts',
        'nvm alias default lts/*',
        'nvm use default',

        // Clone the repo
        'git clone https://github.com/JanuaryLabs/sdk-it.git',
        'cd sdk-it',
        'npm install',
      ].join('\n'),
    });

    // 5. Attach both to VLAN
    const builderIp = '10.10.1.10';
    new hcloud.ServerNetwork('builder-net', {
      ip: builderIp,
      serverId: builder.id,
      networkId: vlan.id,
    });
    new hcloud.ServerNetwork('app-net', {
      ip: '10.10.1.20',
      serverId: app.id,
      networkId: vlan.id,
    });

    // 6. Firewalls
    new hcloud.Firewall('fw-builder', {
      applyTos: [{ server: builder.id }],
      rules: [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '22',
          sourceIps: ['10.10.0.0/16'],
        },
        {
          direction: 'in',
          protocol: 'tcp',
          port: '2375',
          sourceIps: ['10.10.0.0/16'],
        },
      ],
    });
    new hcloud.Firewall('fw-app', {
      applyTos: [{ server: app.id }],
      rules: [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '22',
          sourceIps: ['0.0.0.0/0'],
        },
        {
          direction: 'in',
          protocol: 'tcp',
          port: '80',
          sourceIps: ['0.0.0.0/0'],
        },
        {
          direction: 'in',
          protocol: 'tcp',
          port: '443',
          sourceIps: ['0.0.0.0/0'],
        },
        {
          direction: 'in',
          protocol: 'tcp',
          port: '2375',
          sourceIps: ['10.10.0.0/16'],
        },
      ],
    });

    // 8. Point app’s Docker context at builder’s daemon and make it default
    new command.remote.Command(
      'docker-context-builder',
      {
        create: [
          `docker context create builder --docker "host=tcp://${builderIp}:2375"`,
          // switch default to that context
          'docker context use builder',
        ].join('\n'),
        connection: {
          host: app.ipv4Address,
          user: 'root',
          privateKey: privateKey.privateKeyOpenssh,
        },
      },
      { dependsOn: [builder, app] },
    );
    // — enable TCP-2375 on builder via SSH jump through the app host, using systemd override —
    new command.remote.Command(
      'fix-docker-remote',
      {
        create: [
          // 1. Clean up old configs
          'rm -f /etc/docker/daemon.json',
          'rm -f /etc/systemd/system/docker.service.d/tcp.conf',
          'systemctl daemon-reload',

          // 2. Apply systemd override
          'mkdir -p /etc/systemd/system/docker.service.d',
          `cat << 'EOF' > /etc/systemd/system/docker.service.d/tcp.conf
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://0.0.0.0:2375
EOF`,

          // 3. Reload & restart
          'systemctl daemon-reload',
          'systemctl restart docker',
        ].join('\n'),
        connection: {
          host: builderIp, // e.g. "10.10.1.10"
          user: 'root',
          privateKey: privateKey.privateKeyOpenssh,
          proxy: {
            host: app.ipv4Address, // your app’s public IP
            user: 'root',
            privateKey: privateKey.privateKeyOpenssh,
          },
        },
      },
      { dependsOn: [builder, app] },
    );

    //9 . Remote Docker provider pointed at builder’s daemon
    new docker.Provider(
      'docker-remote',
      {
        host: `ssh://root@${builderIp}:22`,
        sshOpts: ['-i', sshKeyLocalPath, '-o', 'StrictHostKeyChecking=no'],
      },
      { dependsOn: [builder] },
    );
  },
});
