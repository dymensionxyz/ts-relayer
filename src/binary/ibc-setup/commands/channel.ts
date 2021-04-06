import path from 'path';

import { Order } from '../../../codec/ibc/core/channel/v1/channel';
import { Link } from '../../../lib/link';
import { registryFile } from '../../constants';
import { Logger } from '../../create-logger';
import { loadAndValidateApp } from '../../utils/load-and-validate-app';
import { loadAndValidateRegistry } from '../../utils/load-and-validate-registry';
import { resolveOption } from '../../utils/options/resolve-option';
import { resolveHomeOption } from '../../utils/options/shared/resolve-home-option';
import { resolveKeyFileOption } from '../../utils/options/shared/resolve-key-file-option';
import { resolveMnemonicOption } from '../../utils/options/shared/resolve-mnemonic-option';
import { signingClient } from '../../utils/signing-client';

export type Flags = {
  readonly interactive: boolean;
  readonly ordered: boolean;
  readonly mnemonic?: string;
  readonly keyFile?: string;
  readonly home?: string;
  readonly src?: string;
  readonly dest?: string;
  readonly srcConnection?: string;
  readonly destConnection?: string;
  readonly srcPort?: string;
  readonly destPort?: string;
  readonly version?: string;
};

export type Options = {
  readonly home: string;
  readonly mnemonic: string;
  readonly src: string;
  readonly dest: string;
  readonly srcConnection: string;
  readonly destConnection: string;
  readonly srcPort: string;
  readonly destPort: string;
  readonly version: string;
  readonly ordered: boolean;
};

export async function channel(flags: Flags, logger: Logger) {
  const home = resolveHomeOption({ homeFlag: flags.home });
  const app = loadAndValidateApp(home);

  const keyFile = resolveKeyFileOption({ keyFileFlag: flags.keyFile, app });
  const mnemonic = await resolveMnemonicOption({
    interactiveFlag: flags.interactive,
    mnemonicFlag: flags.mnemonic,
    keyFile: keyFile,
    app,
  });
  const src = resolveOption('src', { required: true })(
    flags.src,
    app?.src,
    process.env.RELAYER_SRC
  );
  const dest = resolveOption('dest', { required: true })(
    flags.dest,
    app?.dest,
    process.env.RELAYER_DEST
  );
  const srcConnection = resolveOption('srcConnection', { required: true })(
    flags.srcConnection,
    app?.srcConnection,
    process.env.RELAYER_SRC_CONNECTION
  );
  const destConnection = resolveOption('destConnection', { required: true })(
    flags.destConnection,
    app?.destConnection,
    process.env.RELAYER_DEST_CONNECTION
  );
  const srcPort = resolveOption('srcPort', { required: true })(
    flags.srcPort,
    process.env.RELAYER_SRC_PORT
  );
  const destPort = resolveOption('destPort', { required: true })(
    flags.destPort,
    process.env.RELAYER_DEST_PORT
  );
  const version =
    resolveOption('version')(flags.version, process.env.RELAYER_VERSION) ??
    'ics20-1';

  const options: Options = {
    home,
    mnemonic,
    src,
    dest,
    srcConnection,
    destConnection,
    srcPort,
    destPort,
    version,
    ordered: flags.ordered,
  };

  await run(options, logger);
}

export async function run(options: Options, logger: Logger) {
  const registryFilePath = path.join(options.home, registryFile);
  const registry = loadAndValidateRegistry(registryFilePath);
  const srcChain = registry.chains[options.src];
  if (!srcChain) {
    throw new Error(`src channel "${options.src}" not found in registry`);
  }
  const destChain = registry.chains[options.dest];
  if (!destChain) {
    throw new Error(`dest channel "${options.dest}" not found in registry`);
  }

  const nodeA = await signingClient(
    srcChain,
    options.mnemonic,
    logger.child({ label: srcChain.chain_id })
  );
  const nodeB = await signingClient(
    destChain,
    options.mnemonic,
    logger.child({ label: destChain.chain_id })
  );

  const link = await Link.createWithExistingConnections(
    nodeA,
    nodeB,
    options.srcConnection,
    options.destConnection,
    logger
  );

  const ordering = options.ordered
    ? Order.ORDER_ORDERED
    : Order.ORDER_UNORDERED;

  const channel = await link.createChannel(
    'A',
    options.srcPort,
    options.destPort,
    ordering,
    options.version
  );

  console.log(
    `Created channels for connections [${link.endA.chainId()}, ${
      link.endA.connectionID
    }] <=> [${link.endA.chainId()}, ${link.endA.connectionID}]: ${
      channel.src.channelId
    } (${channel.src.portId}) => ${channel.dest.channelId} (${
      channel.dest.portId
    })`
  );
}
