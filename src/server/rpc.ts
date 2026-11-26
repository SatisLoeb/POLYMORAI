import type { AddressMeasurement, ChainSetting, OnchainMeasurement } from '../types';

const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const EIP1967_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const SEL_IMPLEMENTATION = '0x5c60da1b'; // implementation()
const SEL_LATEST_ROUND = '0xfeaf968c'; // latestRoundData()
const SEL_DECIMALS = '0x313ce567'; // decimals()
const SEL_DESCRIPTION = '0x7284e416'; // description()
const FEED_MAX_AGE_S = 26 * 3600;

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class RpcError extends Error {}

export class RpcClient {
  private id = 0;

  constructor(private url: string, private timeoutMs = 15_000) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new RpcError('URL RPC invalide.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new RpcError('Le RPC doit être en http(s).');
    }
  }

  async call<T = string>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new RpcError(`${method}: ${body.error.message ?? 'erreur RPC'}`);
    if (body.result === undefined) throw new RpcError(`${method}: réponse vide`);
    return body.result;
  }

  async chainId(): Promise<number> {
    return Number(BigInt(await this.call('eth_chainId', [])));
  }

  async blockNumber(): Promise<number> {
    return Number(BigInt(await this.call('eth_blockNumber', [])));
  }

  getCode(address: string, block: string): Promise<string> {
    return this.call('eth_getCode', [address, block]);
  }

  async getBalance(address: string, block: string): Promise<bigint> {
    return BigInt(await this.call('eth_getBalance', [address, block]));
  }

  getStorageAt(address: string, slot: string, block: string): Promise<string> {
    return this.call('eth_getStorageAt', [address, slot, block]);
  }

  ethCall(to: string, data: string, block: string): Promise<string> {
    return this.call('eth_call', [{ to, data }, block]);
  }
}

export function hexBlock(n: number): string {
  return `0x${n.toString(16)}`;
}

function wordToAddress(word: string): string | null {
  const hex = word.replace(/^0x/, '').padStart(64, '0');
  const addr = `0x${hex.slice(24)}`;
  return /^0x0{40}$/.test(addr) ? null : addr;
}

export function codeByteLength(code: string): number {
  const hex = code.replace(/^0x/, '');
  return hex.length / 2;
}

/** EIP-1167 minimal proxy: 363d3d373d3d3d363d73<20 bytes>5af43d82803e903d91602b57fd5bf3 */
export function parseEip1167(code: string): string | null {
  const m = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  return m ? `0x${m[1]}` : null;
}

/** Decode an ABI-encoded `string` return value. */
export function decodeAbiString(data: string): string {
  const hex = data.replace(/^0x/, '');
  if (hex.length < 128) throw new RpcError('Chaîne ABI tronquée.');
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`)) * 2;
  const len = Number(BigInt(`0x${hex.slice(offset, offset + 64)}`));
  const bytes = hex.slice(offset + 64, offset + 64 + len * 2);
  return Buffer.from(bytes, 'hex').toString('utf8');
}

/** Decode a signed int256 word. */
function decodeInt256(word: string): bigint {
  const v = BigInt(`0x${word}`);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

async function measureAddress(rpc: RpcClient, address: string, block: string): Promise<AddressMeasurement> {
  const [code, balance] = await Promise.all([rpc.getCode(address, block), rpc.getBalance(address, block)]);
  const m: AddressMeasurement = {
    address,
    codeSize: codeByteLength(code),
    proxyKind: 'none',
    nativeBalanceWei: balance.toString(),
  };
  if (m.codeSize === 0) return m;

  const minimal = parseEip1167(code);
  if (minimal) {
    m.proxyKind = 'eip1167';
    m.implementation = minimal;
  } else {
    const implWord = await rpc.getStorageAt(address, EIP1967_IMPL_SLOT, block);
    const impl = wordToAddress(implWord);
    if (impl) {
      m.proxyKind = 'eip1967';
      m.implementation = impl;
    } else {
      const beacon = wordToAddress(await rpc.getStorageAt(address, EIP1967_BEACON_SLOT, block));
      if (beacon) {
        m.proxyKind = 'eip1967_beacon';
        const ret = await rpc.ethCall(beacon, SEL_IMPLEMENTATION, block);
        m.implementation = wordToAddress(ret.replace(/^0x/, '').slice(0, 64)) ?? undefined;
      }
    }
  }
  if (m.implementation) {
    m.implementationCodeSize = codeByteLength(await rpc.getCode(m.implementation, block));
  }
  return m;
}

async function readNativeFeed(
  rpc: RpcClient,
  chain: ChainSetting,
  block: string,
  blockTimestamp: number
): Promise<NonNullable<OnchainMeasurement['nativeUsd']>> {
  const feed = chain.nativeUsdFeed;
  if (!ADDRESS_RE.test(feed)) throw new RpcError('Aucun feed natif/USD configuré pour cette chaîne.');
  const description = decodeAbiString(await rpc.ethCall(feed, SEL_DESCRIPTION, block));
  if (description !== chain.nativeUsdFeedDescription) {
    throw new RpcError(
      `Feed ${feed} : description()="${description}" ≠ "${chain.nativeUsdFeedDescription}" attendu — feed refusé.`
    );
  }
  const decimals = Number(BigInt(await rpc.ethCall(feed, SEL_DECIMALS, block)));
  const round = (await rpc.ethCall(feed, SEL_LATEST_ROUND, block)).replace(/^0x/, '');
  const answer = decodeInt256(round.slice(64, 128));
  const updatedAt = Number(BigInt(`0x${round.slice(192, 256)}`));
  if (answer <= 0n) throw new RpcError(`Feed ${feed} : réponse non positive.`);
  if (blockTimestamp - updatedAt > FEED_MAX_AGE_S) {
    throw new RpcError(`Feed ${feed} : dernière mise à jour il y a ${Math.round((blockTimestamp - updatedAt) / 3600)} h — périmé.`);
  }
  return { feed, description, answer: answer.toString(), decimals, updatedAt };
}

/**
 * Executed measurement of the scope addresses at the latest block.
 * The USD figure is a LOWER bound (native balances only); ERC-20 holdings are not counted,
 * so it may pass the threshold but must never be used to block (see doctrine L3).
 */
export async function measureOnchain(chain: ChainSetting, addresses: string[]): Promise<OnchainMeasurement> {
  const rpc = new RpcClient(chain.rpcUrl);
  const errors: string[] = [];
  const chainId = await rpc.chainId();
  if (chain.chainId !== null && chainId !== chain.chainId) {
    throw new RpcError(`Le RPC répond chainId=${chainId}, attendu ${chain.chainId} pour ${chain.chain}.`);
  }
  const blockNumber = await rpc.blockNumber();
  const block = hexBlock(blockNumber);
  const header = await rpc.call<{ timestamp: string }>('eth_getBlockByNumber', [block, false]);
  const blockTimestamp = Number(BigInt(header.timestamp));

  const valid = [...new Set(addresses.map((a) => a.trim()).filter((a) => ADDRESS_RE.test(a)))];
  for (const a of addresses) if (a.trim() && !ADDRESS_RE.test(a.trim())) errors.push(`Adresse invalide ignorée : ${a}`);

  const measured: AddressMeasurement[] = [];
  for (const address of valid) {
    try {
      measured.push(await measureAddress(rpc, address, block));
    } catch (err) {
      errors.push(`${address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let nativeUsd: OnchainMeasurement['nativeUsd'];
  let fundsLowerBoundUsd: number | null = null;
  if (measured.length > 0) {
    try {
      nativeUsd = await readNativeFeed(rpc, chain, block, blockTimestamp);
      const totalWei = measured.reduce((acc, m) => acc + BigInt(m.nativeBalanceWei), 0n);
      // USD = wei / 1e18 * answer / 10^decimals, computed in integer cents to avoid float drift.
      const cents = (totalWei * BigInt(nativeUsd.answer) * 100n) / (10n ** 18n * 10n ** BigInt(nativeUsd.decimals));
      fundsLowerBoundUsd = Number(cents) / 100;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    chain: chain.chain,
    expectedChainId: chain.chainId,
    chainId,
    blockNumber,
    measuredAt: new Date().toISOString(),
    addresses: measured,
    nativeUsd,
    fundsLowerBoundUsd,
    errors,
  };
}

/** Bytecode to compare for provenance: the implementation when the address is a proxy. */
export async function fetchComparableCode(
  chain: ChainSetting,
  m: AddressMeasurement,
  blockNumber: number
): Promise<{ comparedAddress: string; code: string }> {
  const rpc = new RpcClient(chain.rpcUrl);
  const target = m.implementation ?? m.address;
  return { comparedAddress: target, code: await rpc.getCode(target, hexBlock(blockNumber)) };
}
