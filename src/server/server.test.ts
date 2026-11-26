import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { hashPassword, verifyPassword } from './auth';
import { classifyTarget } from './engine';
import { compareProvenance, extractPushImmediates, type BuiltContract } from './provenance';
import { parseForgeTestOutput, pocUsesFork, validatePocSource } from './replay';
import { decodeAbiString, parseEip1167 } from './rpc';
import { extractFunction, sanitizeFoundryConfig, validateRepoUrl, WorkspaceError } from './workspace';

test('extractPushImmediates skips PUSH data: bytes inside a PUSH32 are not read as PUSH4', () => {
  // PUSH32 <0x63 aabbccdd ...> then PUSH4 0x12345678 then PUSH1 0x01
  const push32Data = '63aabbccdd'.padEnd(64, '0');
  const code = `0x7f${push32Data}631234567860015b`;
  const { push4, short } = extractPushImmediates(code);
  assert.deepEqual([...push4], ['12345678']);
  assert.equal(push4.has('aabbccdd'), false);
  assert.equal(short.has('00000001'), true);
});

const vault: BuiltContract = {
  name: 'Vault',
  sourcePath: 'src/Vault.sol',
  selectors: ['b6b55f25', '2e1a7d4d'],
  signatures: { b6b55f25: 'deposit(uint256)', '2e1a7d4d': 'withdraw(uint256)' },
};
const other: BuiltContract = { name: 'Other', sourcePath: 'src/Other.sol', selectors: ['deadbeef'], signatures: {} };

test('compareProvenance: matched when every ABI selector is in the deployed dispatcher', () => {
  const code = '0x63b6b55f25632e1a7d4d';
  const r = compareProvenance('0xA', '0xA', 1, code, [other, vault]);
  assert.equal(r.status, 'matched');
  assert.equal(r.bestMatch?.contract, 'Vault');
});

test('compareProvenance: diverged names the repo function the deployed code lacks', () => {
  const r = compareProvenance('0xA', '0xA', 1, '0x63b6b55f25', [vault]);
  assert.equal(r.status, 'diverged');
  assert.deepEqual(r.bestMatch?.missingSelectors, ['withdraw(uint256)']);
});

test('compareProvenance: empty code is no_code; unrelated code is no_match', () => {
  assert.equal(compareProvenance('0xA', '0xA', 1, '0x', [vault]).status, 'no_code');
  assert.equal(compareProvenance('0xA', '0xA', 1, '0x6311111111', [vault]).status, 'no_match');
});

test('parseForgeTestOutput reads suite result lines', () => {
  const ok = 'Ran 1 test for test/polymorphe/X.t.sol:PoC\n[PASS] test_x() (gas: 1234)\nSuite result: ok. 1 passed; 0 failed; 0 skipped; finished in 1ms';
  assert.deepEqual(parseForgeTestOutput(ok, 0), { compileFailed: false, testsPassed: 1, testsFailed: 0 });
  const fail = '[FAIL: revert] test_x() (gas: 1)\nSuite result: FAILED. 0 passed; 1 failed; 0 skipped';
  assert.deepEqual(parseForgeTestOutput(fail, 1), { compileFailed: false, testsPassed: 0, testsFailed: 1 });
  const compile = 'Compiling 2 files with Solc 0.8.26\nError (7576): Undeclared identifier.\nError: Compiler run failed:';
  assert.equal(parseForgeTestOutput(compile, 1).compileFailed, true);
  assert.equal(parseForgeTestOutput('No tests match the provided pattern', 0).testsPassed, 0);
});

test('validatePocSource demands a complete Solidity file with a test function', () => {
  assert.throws(() => validatePocSource('contract X { function test_a() public {} }'), WorkspaceError);
  assert.throws(() => validatePocSource('pragma solidity ^0.8.0; contract X {}'), WorkspaceError);
  assert.ok(validatePocSource('pragma solidity ^0.8.0; contract X { function test_a() public {} }'));
  assert.equal(pocUsesFork('vm.createSelectFork(vm.envString("FORK_RPC_URL"));'), true);
  assert.equal(pocUsesFork('function test_a() public {}'), false);
});

test('ABI string decoding and EIP-1167 detection', () => {
  const enc =
    '0x' +
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '0000000000000000000000000000000000000000000000000000000000000009' +
    Buffer.from('ETH / USD').toString('hex').padEnd(64, '0');
  assert.equal(decodeAbiString(enc), 'ETH / USD');
  const impl = 'bebebebebebebebebebebebebebebebebebebebe';
  assert.equal(parseEip1167(`0x363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`), `0x${impl}`);
  assert.equal(parseEip1167('0x6080604052'), null);
});

test('scrypt password hashing round-trips and rejects wrong passwords', () => {
  const h = hashPassword('correct horse battery staple');
  assert.match(h, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery staple', h), true);
  assert.equal(verifyPassword('correct horse battery stapl', h), false);
  assert.notEqual(hashPassword('same'), hashPassword('same'), 'salted');
});

test('sanitizeFoundryConfig neutralises ffi, solc binary paths, fs_permissions and escaping remappings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-toml-'));
  fs.writeFileSync(
    path.join(dir, 'foundry.toml'),
    `[profile.default]
src = "contracts"
ffi = true
solc = "./bin/evil-solc"
fs_permissions = [{ access = "read-write", path = "/" }]
allow_paths = ["/home"]
remappings = ["ok/=lib/ok/", "bad/=/etc/"]

[profile.ci]
ffi = true
`
  );
  fs.writeFileSync(path.join(dir, 'remappings.txt'), 'a/=lib/a/\nb/=../../outside/\n');
  const { changes, layout } = sanitizeFoundryConfig(dir);
  const doc = parseToml(fs.readFileSync(path.join(dir, 'foundry.toml'), 'utf8')) as {
    profile: Record<string, Record<string, unknown>>;
  };
  assert.equal(doc.profile.default.ffi, false);
  assert.equal(doc.profile.ci.ffi, false);
  assert.equal(doc.profile.default.solc, undefined);
  assert.equal(doc.profile.default.allow_paths, undefined);
  assert.deepEqual(doc.profile.default.fs_permissions, [{ access: 'read', path: './' }]);
  assert.deepEqual(doc.profile.default.remappings, ['ok/=lib/ok/']);
  assert.equal(fs.readFileSync(path.join(dir, 'remappings.txt'), 'utf8').includes('outside'), false);
  assert.equal(layout.src, 'contracts');
  assert.ok(changes.length >= 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sanitizeFoundryConfig refuses a project whose src escapes the workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-toml-'));
  fs.writeFileSync(path.join(dir, 'foundry.toml'), '[profile.default]\nsrc = "/home/user"\n');
  assert.throws(() => sanitizeFoundryConfig(dir), WorkspaceError);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('validateRepoUrl: https only, no credentials, GitHub normalised', () => {
  assert.equal(validateRepoUrl('https://github.com/foo/bar/tree/main'), 'https://github.com/foo/bar.git');
  assert.throws(() => validateRepoUrl('git@github.com:foo/bar.git'));
  assert.throws(() => validateRepoUrl('file:///etc'));
  assert.throws(() => validateRepoUrl('https://user:tok@github.com/foo/bar'));
});

test('classifyTarget infers nothing about a program beyond its kind', () => {
  const p = classifyTarget('https://immunefi.com/bug-bounty/paused-strata-arb/');
  assert.equal(p.targetKind, 'program');
  assert.equal(Object.keys(p).sort().join(','), 'programName,scopeKind,targetKind');
  const r = classifyTarget(`https://github.com/foo/bar/tree/${'c'.repeat(40)}`);
  assert.equal(r.targetKind, 'repo');
  assert.equal(r.pinnedCommit, 'c'.repeat(40));
  assert.equal(classifyTarget('/tmp/x').targetKind, 'local');
  assert.throws(() => classifyTarget('ftp://x'));
});

test('extractFunction returns the declaration line and the full body', () => {
  const src = 'contract A {\n  function f(uint a) external {\n    if (a > 0) { x = 1; }\n  }\n  function g() external;\n}';
  const f = extractFunction(src, 'f')!;
  assert.equal(f.line, 2);
  assert.match(f.body, /x = 1; }\n  }$/);
  assert.equal(extractFunction(src, 'g')!.body, 'function g() external;');
  assert.equal(extractFunction(src, 'h'), null);
});
