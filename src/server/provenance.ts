import type { ProvenanceResult } from '../types';

export interface BuiltContract {
  name: string;
  sourcePath: string;
  /** 4-byte selectors (lowercase hex, no 0x) from forge's methodIdentifiers. */
  selectors: string[];
  /** signature by selector, for readable "missing" lists. */
  signatures: Record<string, string>;
}

/**
 * Collect PUSH1..PUSH4 immediates from runtime bytecode, skipping PUSH data correctly
 * so data bytes are never misread as opcodes. Solidity dispatchers compare the selector
 * with PUSH4 (or a shorter PUSH when the selector has leading zero bytes).
 */
export function extractPushImmediates(code: string): { push4: Set<string>; short: Set<string> } {
  const hex = code.replace(/^0x/, '').toLowerCase();
  const push4 = new Set<string>();
  const short = new Set<string>();
  let i = 0;
  const n = hex.length / 2;
  while (i < n) {
    const op = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (op >= 0x60 && op <= 0x7f) {
      const size = op - 0x5f;
      const data = hex.slice((i + 1) * 2, (i + 1 + size) * 2);
      if (size === 4 && data.length === 8) push4.add(data);
      else if (size < 4 && data.length === size * 2) short.add(data.padStart(8, '0'));
      i += 1 + size;
    } else {
      i += 1;
    }
  }
  return { push4, short };
}

function selectorPresent(sel: string, imm: { push4: Set<string>; short: Set<string> }): boolean {
  if (imm.push4.has(sel)) return true;
  return sel.startsWith('00') && imm.short.has(sel);
}

/**
 * Find the built contract whose ABI best explains the deployed bytecode, and report the
 * repo selectors that the deployed code does NOT contain (= HEAD ≠ deployed; rule 11).
 */
export function compareProvenance(
  address: string,
  comparedAddress: string,
  blockNumber: number,
  deployedCode: string,
  contracts: BuiltContract[]
): ProvenanceResult {
  const hex = deployedCode.replace(/^0x/, '');
  if (hex.length === 0) {
    return { address, comparedAddress, blockNumber, status: 'no_code' };
  }
  const imm = extractPushImmediates(deployedCode);

  let best: { c: BuiltContract; matched: number; missing: string[]; ratio: number } | null = null;
  for (const c of contracts) {
    if (c.selectors.length === 0) continue;
    const missing = c.selectors.filter((s) => !selectorPresent(s, imm));
    const matched = c.selectors.length - missing.length;
    const ratio = matched / c.selectors.length;
    if (
      !best ||
      ratio > best.ratio ||
      (ratio === best.ratio && matched > best.matched)
    ) {
      best = { c, matched, missing, ratio };
    }
  }

  if (!best || best.ratio < 0.5) {
    return {
      address,
      comparedAddress,
      blockNumber,
      status: 'no_match',
      bestMatch: best
        ? {
            contract: best.c.name,
            sourcePath: best.c.sourcePath,
            abiSelectors: best.c.selectors.length,
            matchedSelectors: best.matched,
            missingSelectors: best.missing.map((s) => best!.c.signatures[s] ?? `0x${s}`),
          }
        : undefined,
    };
  }

  return {
    address,
    comparedAddress,
    blockNumber,
    status: best.missing.length === 0 ? 'matched' : 'diverged',
    bestMatch: {
      contract: best.c.name,
      sourcePath: best.c.sourcePath,
      abiSelectors: best.c.selectors.length,
      matchedSelectors: best.matched,
      missingSelectors: best.missing.map((s) => best!.c.signatures[s] ?? `0x${s}`),
    },
  };
}
