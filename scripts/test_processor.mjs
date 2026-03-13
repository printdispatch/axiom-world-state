/**
 * Standalone processor test script.
 * Run with: node scripts/test_processor.mjs
 * (requires `pnpm build` first)
 */

import { SixLayerProcessor } from '../dist/src/engine/six_layer_processor.js';
import { gmailMessageToSignal } from '../dist/src/signals/adapters/gmail_adapter.js';

const processor = new SixLayerProcessor();

// Test 1: Client email with invoice
console.log('\n=== TEST 1: Client email with invoice ===');
const clientSignal = gmailMessageToSignal({
  id: 'test-client-001',
  threadId: 'thread-001',
  internalDate: '2026-03-12T09:15:00.000Z',
  from: 'sarah.chen@vertexdesign.co',
  to: 'bob@printdispatch.com',
  subject: 'Brand Identity Package — Final Files + Invoice #2024-089',
  bodyText: `Hi Bob,\n\nFinal brand identity package for Meridian Coffee Co attached.\nInvoice #2024-089 for $4,200 due April 11, 2026.\n\nPlease confirm everything looks good.\n\nBest,\nSarah Chen`,
  accountAddress: 'bob@printdispatch.com'
}, 'test');

let start = Date.now();
const result1 = await processor.process(clientSignal);
console.log(`Completed in ${((Date.now() - start)/1000).toFixed(1)}s`);
console.log(`is_noise: ${result1.is_noise}`);
console.log(`L1 facts: ${result1.layer_1.raw_facts.length}`);
console.log(`L2 entities: ${result1.layer_2.entity_candidates.map(e => e.label).join(', ')}`);
console.log(`L4 obligations: ${result1.layer_4.new_obligations.map(o => o.title).join(', ')}`);
console.log(`L6 actions:`);
result1.layer_6.proposed_actions.forEach(a => {
  console.log(`  [${a.rank}] ${a.kind}: ${a.description} (risk: ${a.risk}, approval: ${a.requires_approval})`);
});

// Test 2: Spam email
console.log('\n=== TEST 2: Spam email ===');
const spamSignal = gmailMessageToSignal({
  id: 'test-spam-001',
  threadId: 'thread-spam',
  internalDate: '2026-03-12T08:00:00.000Z',
  from: 'deals@shopnow-promo.com',
  to: 'bob@printdispatch.com',
  subject: '🔥 FLASH SALE: 70% OFF Everything — Today Only!!!',
  bodyText: `DON'T MISS OUT! 70% OFF all products — use code FLASH70 at checkout. Sale ends TONIGHT.`,
  accountAddress: 'bob@printdispatch.com'
}, 'test');

start = Date.now();
const result2 = await processor.process(spamSignal);
console.log(`Completed in ${((Date.now() - start)/1000).toFixed(1)}s`);
console.log(`is_noise: ${result2.is_noise}`);
console.log(`noise_reason: ${result2.layer_1.noise_reason}`);

console.log('\n✅ All tests complete');
