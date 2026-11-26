/**
 * Executed end-to-end checks — real git, real forge (sandboxed with bwrap), real anvil.
 * Skipped when forge / anvil / bwrap are missing. Needs network once to download solc.
 *
 *   npm run test:integration
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateG0 } from '../core/doctrine';
import type { ChainSetting, Finding, ScanRun } from '../types';
import { buildScanRecord, classifyTarget, Engine } from './engine';
import { probeSandbox, runCommand, which } from './exec';
import { compareProvenance } from './provenance';
import { measureOnchain, RpcClient } from './rpc';
import { Store } from './store';
import { readArtifacts } from './workspace';

process.env.POLYMORPHE_GIT_ALLOW_PROTOCOL = 'https:file';

const VAULT_A = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(amount <= address(this).balance, "insufficient");
        balances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send");
    }

    function sweep(address to) external {
        payable(to).transfer(address(this).balance);
    }
}
`;
const VAULT_B = VAULT_A.replace('amount <= address(this).balance', 'amount <= balances[msg.sender]');

const FEEDS = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract MockFeed {
    function description() external pure returns (string memory) { return "ETH / USD"; }
    function decimals() external pure returns (uint8) { return 8; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 3000e8, block.timestamp, block.timestamp, 1);
    }
}

contract WrongFeed {
    function description() external pure returns (string memory) { return "BTC / USD"; }
}
`;

const OWN_TEST = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Vault} from "../src/Vault.sol";

contract VaultTest {
    receive() external payable {}
    function test_deposit_withdraw() public {
        Vault v = new Vault();
        v.deposit{value: 0}();
        v.withdraw(0);
    }
}
`;

const POC_HEADER = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Vault} from "../../src/Vault.sol";

interface Vm {
    function deal(address, uint256) external;
    function ffi(string[] calldata) external returns (bytes memory);
    function readFile(string calldata) external view returns (string memory);
}

contract Victim {
    function go(Vault v) external payable { v.deposit{value: msg.value}(); }
}
`;

const POC_STEAL = `${POC_HEADER}
contract PolyPoC {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    receive() external payable {}

    function test_steal() public {
        Vault v = new Vault();
        Victim victim = new Victim();
        vm.deal(address(this), 10 ether);
        victim.go{value: 10 ether}(v);
        v.withdraw(10 ether);
        require(address(v).balance == 0, "vault not drained");
        require(address(this).balance == 10 ether, "attacker not paid");
    }
}
`;

const POC_FAILS = `${POC_HEADER}
contract PolyPoC {
    function test_nope() public pure { require(false, "nope"); }
}
`;

const POC_COMPILE_ERROR = `${POC_HEADER}
contract PolyPoC {
    function test_x() public { undeclaredThing = 1; }
}
`;

const POC_FFI = `${POC_HEADER}
contract PolyPoC {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function test_ffi() public {
        string[] memory cmd = new string[](2);
        cmd[0] = "echo";
        cmd[1] = "pwned";
        vm.ffi(cmd);
    }
}
`;

const POC_READ_HOST = (file: string) => `${POC_HEADER}
contract PolyPoC {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function test_read() public view { vm.readFile("${file}"); }
}
`;

const KILL_TEST = `${POC_HEADER}
contract KillTest {
    function test_sweep_exists() public {
        Vault v = new Vault();
        v.sweep(address(this));
    }
    receive() external payable {}
}
`;

function sh(cwd: string, cmd: string, args: string[]) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
}

async function waitFor<T>(fn: () => Promise<T>, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() > until) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

const tools = ['forge', 'anvil', 'git', 'bwrap'].every((t) => which(t));

test('integration: sandboxed build, clean-room replays, fix-review, RPC measurement, provenance', { skip: !tools && 'forge/anvil/git/bwrap missing' }, async (t) => {
  assert.equal(await probeSandbox(), true, 'bwrap must be usable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polymorphe-it-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'test'), { recursive: true });
  // ffi = true on purpose: the pipeline must neutralise it.
  fs.writeFileSync(path.join(proj, 'foundry.toml'), '[profile.default]\nsrc = "src"\nout = "out"\ntest = "test"\nffi = true\nfs_permissions = [{ access = "read-write", path = "/" }]\n');
  fs.writeFileSync(path.join(proj, 'src', 'Vault.sol'), VAULT_A);
  fs.writeFileSync(path.join(proj, 'src', 'Feeds.sol'), FEEDS);
  fs.writeFileSync(path.join(proj, 'test', 'Vault.t.sol'), OWN_TEST);
  sh(proj, 'git', ['init', '-q']);
  sh(proj, 'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  sh(proj, 'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'A: buggy withdraw']);
  const commitA = sh(proj, 'git', ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(proj, 'src', 'Vault.sol'), VAULT_B);
  sh(proj, 'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'B: fix withdraw']);
  const commitB = sh(proj, 'git', ['rev-parse', 'HEAD']);
  sh(proj, 'git', ['checkout', '-q', commitA]);
  sh(proj, 'git', ['remote', 'add', 'origin', proj]);

  const store = new Store(path.join(root, 'data'));
  const engine = new Engine(store, () => undefined);

  const scan = buildScanRecord(proj, classifyTarget(proj), { chain: 'ethereum', surface: 'all', repoCount: 1, tokensLimit: 10_000 });
  store.state.scans.push(scan);
  engine.startPipeline(scan, { rebuild: true });
  await engine.idle();

  await t.test('build ran in the sandbox with ffi and fs_permissions neutralised', () => {
    assert.equal(scan.ingest.buildOk, true, scan.ingest.buildLog.slice(-3000));
    assert.equal(scan.ingest.sandbox, 'bwrap');
    assert.ok(scan.workspace?.commit.startsWith(commitA));
    assert.ok(scan.workspace!.sanitizedConfig.some((c) => c.includes('ffi')));
    assert.ok(scan.workspace!.sanitizedConfig.some((c) => c.includes('fs_permissions')));
    assert.equal(scan.g0.decision, 'go', 'lab mode, commit-anchored');
  });

  await t.test('Door A: sweep() is never named by the tests and touches value; deposit/withdraw are', () => {
    const names = scan.ingest.untestedMonetaryFunctions.map((f) => f.functionName);
    assert.ok(names.includes('sweep'));
    assert.ok(!names.includes('deposit') && !names.includes('withdraw'));
    const sweep = scan.ingest.untestedMonetaryFunctions.find((f) => f.functionName === 'sweep')!;
    assert.match(sweep.fileLine, /^src\/Vault\.sol:\d+$/);
    assert.match(sweep.reason, /transfer/);
  });

  const mkFinding = (id: string, pocSource: string): Finding => {
    const f: Finding = {
      id,
      scanId: scan.id,
      title: id,
      severity: 'high',
      status: 'replaying',
      source: 'human_from_poc',
      createdAt: new Date().toISOString(),
      summary: '',
      verbatimImpactLine: null,
      affectedFileLine: 'src/Vault.sol:11',
      affectedCode: '',
      pocFile: '',
      pocSource,
      pocReplayCommand: '',
      pocReplayTrace: '',
      cleanRoomVerified: false,
      disconfirmer: { status: 'not_run', ranAt: null, legitimateAlternativeTest: '', notes: '', canKillFinding: false },
      recommendation: '',
      fixReviews: [],
    };
    store.state.findings.push(f);
    engine.submitFindingReplay(scan, f);
    return f;
  };

  const steal = mkFinding('FND-STEAL', POC_STEAL);
  const fails = mkFinding('FND-FAILS', POC_FAILS);
  const broken = mkFinding('FND-BROKEN', POC_COMPILE_ERROR);
  const ffi = mkFinding('FND-FFI', POC_FFI);
  const readHost = mkFinding('FND-READ', POC_READ_HOST(path.join(os.homedir(), '.bashrc')));
  await engine.idle();

  await t.test('a working exploit passes twice and becomes a candidate', () => {
    const run = engine.run(steal.replayRunId)!;
    assert.deepEqual(run.exitCodes, [0, 0], run.output.slice(-3000));
    assert.equal(run.testsPassed, 1);
    assert.equal(steal.cleanRoomVerified, true);
    assert.equal(steal.status, 'candidate');
    assert.match(steal.pocReplayTrace, /\[PASS\] test_steal/);
  });

  await t.test('a failing PoC and a non-compiling PoC are never candidates', () => {
    assert.equal(fails.status, 'replay_failed');
    assert.equal(engine.run(fails.replayRunId)!.testsFailed, 1);
    assert.equal(broken.status, 'replay_failed');
    assert.equal(engine.run(broken.replayRunId)!.compileFailed, true);
    assert.equal(engine.run(broken.replayRunId)!.exitCodes.length, 1, 'compile failure is not repeated');
  });

  await t.test('FFI is off even though foundry.toml asked for it; host files are unreadable', () => {
    assert.equal(ffi.cleanRoomVerified, false);
    assert.match(engine.run(ffi.replayRunId)!.output, /ffi/i);
    assert.equal(readHost.cleanRoomVerified, false);
  });

  await t.test('the sandbox hides the operator home directory', async () => {
    const res = await runCommand({
      cmd: 'ls',
      args: [os.homedir()],
      cwd: proj,
      timeoutMs: 10_000,
      sandbox: { home: store.sandboxHome(), writable: [] },
    });
    assert.notEqual(res.exitCode, 0, res.output);
  });

  await t.test('R9: a kill test produces a passing run attached to the hypothesis', async () => {
    scan.hypotheses.push({
      id: 'hyp-1',
      scanId: scan.id,
      door: 'door_a_untested',
      title: 'sweep() is unguarded',
      targetFileLine: 'src/Vault.sol:19',
      targetVerified: true,
      outcome: 'in_progress',
      testRunIds: [],
      updatedAt: new Date().toISOString(),
    });
    const run = engine.submitHypothesisTest(scan, 'hyp-1', KILL_TEST);
    await engine.idle();
    assert.equal(run.passed, true, run.output.slice(-2000));
    assert.equal(run.subjectId, 'hyp-1');
    assert.deepEqual(scan.hypotheses[0].testRunIds, [run.id]);
  });

  await t.test('fix-review: PoC still passes on A, fails on B (fixed)', async () => {
    const onA = engine.submitFixReview(scan, steal, commitA, commitA);
    const onB = engine.submitFixReview(scan, steal, commitB, commitB);
    await engine.idle();
    assert.equal(onA.verdict, 'still_reproducible', onA.pocReplayOutput.slice(-2000));
    assert.equal(onB.verdict, 'fixed', onB.pocReplayOutput.slice(-2000));
    assert.equal(onB.headCommit, commitB);
  });

  await t.test('on-chain: native funds priced by a verified feed, proxies resolved, provenance compared', async (tt) => {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const anvil: ChildProcess = spawn(which('anvil')!, ['--port', String(port), '--silent'], { stdio: 'ignore' });
    tt.after(() => anvil.kill('SIGKILL'));
    const url = `http://127.0.0.1:${port}`;
    const rpc = new RpcClient(url);
    await waitFor(() => rpc.blockNumber());

    const projectDir = engine.projectDir(scan)!;
    const artifacts = readArtifacts(projectDir, scan.workspace!.layout);
    const code = (name: string) => {
      const file = path.join(projectDir, 'out', name === 'Vault' ? 'Vault.sol' : 'Feeds.sol', `${name}.json`);
      return JSON.parse(fs.readFileSync(file, 'utf8')).deployedBytecode.object as string;
    };
    const vault = '0x' + '11'.repeat(20);
    const patched = '0x' + '22'.repeat(20);
    const proxy = '0x' + '33'.repeat(20);
    const feed = '0x' + '44'.repeat(20);
    const wrongFeed = '0x' + '55'.repeat(20);
    const sweepSel = Object.entries(artifacts.find((a) => a.name === 'Vault')!.signatures).find(([, sig]) => sig === 'sweep(address)')![0];
    await rpc.call('anvil_setCode', [vault, code('Vault')]);
    await rpc.call('anvil_setCode', [patched, code('Vault').replace(`63${sweepSel}`, '63deadbeef')]);
    await rpc.call('anvil_setCode', [proxy, code('MockFeed')]);
    await rpc.call('anvil_setStorageAt', [
      proxy,
      '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      '0x' + vault.slice(2).padStart(64, '0'),
    ]);
    await rpc.call('anvil_setCode', [feed, code('MockFeed')]);
    await rpc.call('anvil_setCode', [wrongFeed, code('WrongFeed')]);
    await rpc.call('anvil_setBalance', [vault, '0x' + (100n * 10n ** 18n).toString(16)]);
    await rpc.call('evm_mine', []);

    const chain: ChainSetting = {
      chain: 'anvil',
      label: 'anvil',
      chainId: 31337,
      rpcUrl: url,
      rpcConfigured: true,
      nativeUsdFeed: feed,
      nativeUsdFeedDescription: 'ETH / USD',
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 100_000,
    };
    const m = await measureOnchain(chain, [vault, patched, proxy]);
    assert.deepEqual(m.errors, []);
    assert.equal(m.fundsLowerBoundUsd, 300_000, '100 ETH x 3000 USD');
    const px = m.addresses.find((a) => a.address === proxy)!;
    assert.equal(px.proxyKind, 'eip1967');
    assert.equal(px.implementation?.toLowerCase(), vault);

    const block = m.blockNumber;
    const prov = await Promise.all(
      m.addresses.map(async (a) => {
        const target = a.implementation ?? a.address;
        return compareProvenance(a.address, target, block, await rpc.getCode(target, `0x${block.toString(16)}`), artifacts);
      })
    );
    assert.equal(prov.find((p) => p.address === vault)!.status, 'matched');
    const div = prov.find((p) => p.address === patched)!;
    assert.equal(div.status, 'diverged');
    assert.deepEqual(div.bestMatch?.missingSelectors, ['sweep(address)']);
    assert.equal(prov.find((p) => p.address === proxy)!.status, 'matched', 'compared through the implementation');

    await assert.rejects(measureOnchain({ ...chain, chainId: 1 }, [vault]), /chainId=31337/);
    const wrong = await measureOnchain({ ...chain, nativeUsdFeed: wrongFeed }, [vault]);
    assert.equal(wrong.fundsLowerBoundUsd, null);
    assert.match(wrong.errors.join(' '), /BTC \/ USD/);

    // Full G0 on a deployed-scope program fed by this real measurement.
    const g0 = evaluateG0({
      targetKind: 'program',
      scopeKind: 'deployed',
      targetUrl: 'https://example.org/bounty',
      programScope: {
        attestedAt: new Date().toISOString(),
        attestedBy: 'admin',
        sourceUrl: 'https://example.org/bounty/scope',
        status: 'active',
        verbatimImpacts: ['Direct theft of any user funds'],
        maxBountyUsd: 50_000,
        listedAt: new Date().toISOString().slice(0, 10),
        knownIssues: [],
        scopeKind: 'deployed',
        chain: 'anvil',
        scopeAddresses: [vault, patched],
      },
      chain: 'anvil',
      rpcConfigured: true,
      onchain: m,
      fundsAttestation: null,
      minFundsAtRiskUsd: 100_000,
      provenance: prov,
      pinnedCommit: commitA,
      extraTombstones: [],
      now: new Date(),
    });
    assert.equal(g0.decision, 'go');
    assert.equal(g0.verdictLines.find((l) => l.id === 'L3')!.status, 'ok');
    assert.equal(g0.verdictLines.find((l) => l.id === 'L4')!.status, 'warn');
  });

  await t.test('state survives a restart (persisted store)', () => {
    const reloaded = new Store(path.join(root, 'data'));
    const s = reloaded.state.scans.find((x: ScanRun) => x.id === scan.id)!;
    assert.equal(s.ingest.buildOk, true);
    assert.equal(reloaded.state.findings.find((f) => f.id === 'FND-STEAL')!.cleanRoomVerified, true);
    assert.ok(reloaded.state.runs.length >= 8);
    assert.equal(fs.statSync(reloaded.file).mode & 0o777, 0o600);
  });

  fs.rmSync(root, { recursive: true, force: true });
});
